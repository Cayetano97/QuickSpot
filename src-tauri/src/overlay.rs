//! Overlay window control: the Rust-side half of the open/close state
//! machine, cursor-monitor centering, click-through toggling, the
//! drag-clamp watchdog, and the OS-minimize reconcile.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

pub const WINDOW_LABEL: &str = "main";

const RECONCILE_INTERVAL: Duration = Duration::from_millis(100);
const CLAMP_INTERVAL: Duration = Duration::from_millis(33);
const CLAMP_STABLE_TIMEOUT: Duration = Duration::from_millis(400);

/// Rust-side phase. The visual animation lives in the webview; Rust only
/// tracks whether the OS window should be shown, hidden, or closing.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Hidden,
    Shown,
    Closing,
}

pub struct Overlay {
    phase: Mutex<Phase>,
}

impl Overlay {
    pub fn new() -> Self {
        Self {
            phase: Mutex::new(Phase::Hidden),
        }
    }

    fn get(&self) -> Phase {
        *self.phase.lock().unwrap()
    }

    fn set(&self, phase: Phase) {
        *self.phase.lock().unwrap() = phase;
    }

    /// Transition only when the phase matches `expected`.
    fn replace_if(&self, expected: Phase, next: Phase) -> bool {
        let mut guard = self.phase.lock().unwrap();
        if *guard == expected {
            *guard = next;
            true
        } else {
            false
        }
    }
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

/// Toggle the overlay: if shown (or animating open), close it; else open.
/// Pressing the hotkey mid-close interrupts and reopens cleanly.
pub fn toggle(app: &AppHandle) {
    let ov = app.state::<Overlay>();
    match ov.get() {
        Phase::Shown => {
            ov.set(Phase::Closing);
            emit(app, "overlay-close");
        }
        Phase::Hidden | Phase::Closing => open(app),
    }
}

/// Show the overlay centered on the work area of the monitor under the
/// cursor, then focus it for typing. Runs on EVERY open: the overlay never
/// remembers a dragged spot.
pub fn open(app: &AppHandle) {
    let Some(win) = window(app) else {
        return;
    };
    if let Err(e) = reposition_to_cursor_monitor(app, &win) {
        eprintln!("[quickspot] reposition: {e}");
    }
    // An OS-level minimize (Win+Down) has to be lifted before show.
    if win.is_minimized().unwrap_or(false) {
        let _ = win.unminimize();
    }
    // The webview needs pointer events while visible (drag, hover, clicks).
    let _ = win.set_ignore_cursor_events(false);
    let _ = win.show();
    let _ = win.set_focus();
    app.state::<Overlay>().set(Phase::Shown);
    emit(app, "overlay-open");
}

/// Start the close flow. The webview animates, then calls `on_closed`.
pub fn close(app: &AppHandle) {
    if app.state::<Overlay>().replace_if(Phase::Shown, Phase::Closing) {
        emit(app, "overlay-close");
    }
}

/// Fired by the webview when the close animation has finished. A stale
/// call (e.g. from an interrupted close) is ignored.
pub fn on_closed(app: &AppHandle) {
    if !app.state::<Overlay>().replace_if(Phase::Closing, Phase::Hidden) {
        return;
    }
    if let Some(win) = window(app) {
        // Fully click-through while hidden.
        let _ = win.set_ignore_cursor_events(true);
        let _ = win.hide();
    }
}

fn emit(app: &AppHandle, name: &str) {
    let _ = app.emit(name, ());
}

/// Center the window on the work area of the monitor containing the
/// cursor, in physical px (fall back to the primary monitor).
fn reposition_to_cursor_monitor(app: &AppHandle, win: &WebviewWindow) -> tauri::Result<()> {
    let cursor = app.cursor_position()?;
    let monitor = match app.monitor_from_point(cursor.x, cursor.y)? {
        Some(m) => m,
        None => app.primary_monitor()?.ok_or(tauri::Error::WindowNotFound)?,
    };
    let wa = monitor.work_area();
    let size = win.outer_size()?;
    let (x, y) = center_in_area(
        wa.position.x as f64,
        wa.position.y as f64,
        wa.size.width as f64,
        wa.size.height as f64,
        size.width as f64,
        size.height as f64,
    );
    win.set_position(PhysicalPosition::new(x, y))
}

/// Center a `win_w` x `win_h` window in a work area (pure math, tested).
/// An oversized window aligns to the area's top-left instead of going off
/// the top-left edge.
fn center_in_area(
    area_x: f64,
    area_y: f64,
    area_w: f64,
    area_h: f64,
    win_w: f64,
    win_h: f64,
) -> (f64, f64) {
    let x = (area_x + (area_w - win_w) / 2.0).max(area_x);
    let y = (area_y + (area_h - win_h) / 2.0).max(area_y);
    (x, y)
}

/// Background thread: while the overlay is shown, watch for an OS-level
/// minimize (Win+Down, taskbar, Cmd+M) and reconcile the model to hidden
/// so the next hotkey press opens instead of closing again.
pub fn spawn_reconcile(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(RECONCILE_INTERVAL);
        let reconciled = {
            let ov = app.state::<Overlay>();
            if ov.get() != Phase::Shown {
                continue;
            }
            let minimized = window(&app)
                .is_some_and(|w| w.is_minimized().unwrap_or(false));
            if minimized {
                ov.set(Phase::Hidden);
            }
            minimized
        };
        if reconciled {
            emit(&app, "overlay-close");
            if let Some(win) = window(&app) {
                let _ = win.set_ignore_cursor_events(true);
            }
        }
    });
}

/// Arm the drag-clamp watchdog: while `dragging` is set, keep the window
/// fully inside the union of all monitors (the virtual screen). The
/// thread exits when the drag ends, or when the window stops moving for
/// CLAMP_STABLE_TIMEOUT (covers pointerups the webview never sees).
pub fn spawn_drag_clamp(app: AppHandle, dragging: std::sync::Arc<std::sync::atomic::AtomicBool>) {
    std::thread::spawn(move || {
        let mut last_pos: Option<PhysicalPosition<i32>> = None;
        let mut stable_since: Option<Instant> = None;
        while dragging.load(std::sync::atomic::Ordering::SeqCst) {
            let Some(win) = window(&app) else {
                break;
            };
            let pos = win.outer_position().ok();
            if let Some(pos) = pos {
                if let Some(clamped) = clamp_to_virtual_screen(&app, &win, pos) {
                    if clamped != pos {
                        let _ = win.set_position(clamped);
                    }
                }
            }
            if pos == last_pos {
                stable_since.get_or_insert_with(Instant::now);
                if stable_since.unwrap().elapsed() > CLAMP_STABLE_TIMEOUT {
                    break;
                }
            } else {
                stable_since = None;
            }
            last_pos = pos;
            std::thread::sleep(CLAMP_INTERVAL);
        }
        dragging.store(false, std::sync::atomic::Ordering::SeqCst);
    });
}

/// Clamp the window's top-left so the whole overlay stays inside the
/// virtual screen; returns None when no clamp is needed.
fn clamp_to_virtual_screen(
    app: &AppHandle,
    win: &WebviewWindow,
    pos: PhysicalPosition<i32>,
) -> Option<PhysicalPosition<i32>> {
    let monitors = app.available_monitors().ok()?;
    if monitors.is_empty() {
        return None;
    }
    let min_x = monitors.iter().map(|m| m.position().x).min()?;
    let min_y = monitors.iter().map(|m| m.position().y).min()?;
    let max_x = monitors
        .iter()
        .map(|m| m.position().x + m.size().width as i32)
        .max()?;
    let max_y = monitors
        .iter()
        .map(|m| m.position().y + m.size().height as i32)
        .max()?;
    let size = win.outer_size().ok()?;
    let (cx, cy) = clamp_pos(
        (min_x, min_y),
        (max_x, max_y),
        (pos.x, pos.y),
        (size.width as i32, size.height as i32),
    );
    if cx == pos.x && cy == pos.y {
        None
    } else {
        Some(PhysicalPosition::new(cx, cy))
    }
}

/// Keep a `size` window whose top-left is at `pos` inside the union rect
/// `min..max` of all monitors (pure math, tested). A window larger than
/// the screen clamps to the rect's top-left corner.
fn clamp_pos(
    min: (i32, i32),
    max: (i32, i32),
    pos: (i32, i32),
    size: (i32, i32),
) -> (i32, i32) {
    let cx = pos.0.clamp(min.0, (max.0 - size.0).max(min.0));
    let cy = pos.1.clamp(min.1, (max.1 - size.1).max(min.1));
    (cx, cy)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_keeps_a_fully_inside_window_unchanged() {
        assert_eq!(clamp_pos((0, 0), (1920, 1080), (100, 200), (520, 580)), (100, 200));
    }

    #[test]
    fn clamp_pulls_right_and_bottom_overflow_back_inside() {
        assert_eq!(clamp_pos((0, 0), (1920, 1080), (1600, 700), (520, 580)), (1400, 500));
    }

    #[test]
    fn clamp_pulls_negative_offsets_back_to_the_union_origin() {
        // Secondary monitor to the left of the primary: origins go negative.
        assert_eq!(clamp_pos((-1920, 0), (0, 1080), (-2000, 300), (520, 580)), (-1920, 300));
    }

    #[test]
    fn clamp_a_window_larger_than_the_screen_to_the_top_left_corner() {
        assert_eq!(clamp_pos((0, 0), (800, 600), (300, 200), (1000, 900)), (0, 0));
    }

    #[test]
    fn center_places_the_window_in_the_middle_of_the_work_area() {
        assert_eq!(
            center_in_area(0.0, 0.0, 1920.0, 1080.0, 520.0, 580.0),
            (700.0, 250.0)
        );
    }

    #[test]
    fn center_an_oversized_window_against_the_area_top_left() {
        assert_eq!(
            center_in_area(0.0, 0.0, 800.0, 600.0, 1000.0, 900.0),
            (0.0, 0.0)
        );
    }

    #[test]
    fn center_on_a_secondary_monitor_uses_its_own_origin() {
        assert_eq!(
            center_in_area(1920.0, 0.0, 1280.0, 1024.0, 520.0, 580.0),
            (2300.0, 222.0)
        );
    }
}
