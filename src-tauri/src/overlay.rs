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
    let w = size.width as f64;
    let h = size.height as f64;
    let x = (wa.position.x as f64 + (wa.size.width as f64 - w) / 2.0).max(wa.position.x as f64);
    let y = (wa.position.y as f64 + (wa.size.height as f64 - h) / 2.0).max(wa.position.y as f64);
    win.set_position(PhysicalPosition::new(x, y))
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
    let w = size.width as i32;
    let h = size.height as i32;
    let cx = pos.x.clamp(min_x, (max_x - w).max(min_x));
    let cy = pos.y.clamp(min_y, (max_y - h).max(min_y));
    if cx == pos.x && cy == pos.y {
        None
    } else {
        Some(PhysicalPosition::new(cx, cy))
    }
}
