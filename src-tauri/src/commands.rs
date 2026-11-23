//! IPC commands exposed to the webview.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::actions;
use crate::apps;
use crate::config::{self, Action, Group};
use crate::overlay;
use crate::{AppState, DragFlag};

/// What the webview gets on boot and after every reload: the action list,
/// the group definitions, the language override (`null` = follow the OS
/// language), whether the dock hover magnification is enabled, whether
/// the action chips show their kind icons, the chip layout (`null` = the
/// petal ring, the default; `"pills"` = the classic orbit), the circle
/// size (`null`/`100` = the design size; `85..=125` = the launcher
/// composition zoomed by `size / 100`) and the appearance override
/// (`null` = follow the OS: light -> light, dark -> dark; `deep` is an
/// explicit opt-in pin).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPayload {
    pub actions: Vec<Action>,
    pub groups: Vec<Group>,
    pub language: Option<String>,
    pub magnify: bool,
    pub show_icons: bool,
    pub chip_layout: Option<String>,
    pub theme: Option<String>,
    pub circle_size: Option<u32>,
}

impl From<&config::Config> for ConfigPayload {
    fn from(c: &config::Config) -> Self {
        ConfigPayload {
            actions: c.actions.clone(),
            groups: c.groups.clone(),
            language: c.language.clone(),
            magnify: c.magnify,
            show_icons: c.show_icons,
            chip_layout: c.chip_layout.clone(),
            theme: c.theme.clone(),
            circle_size: c.circle_size,
        }
    }
}

/// The current config (serialized to the webview on boot).
#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> ConfigPayload {
    ConfigPayload::from(&*state.config.lock().unwrap())
}

/// Installed applications for the settings panel's app picker. The scan walks
/// the filesystem, so it runs on the blocking pool instead of stalling the
/// IPC/main thread while the picker opens.
#[tauri::command]
pub async fn list_apps() -> Result<Vec<apps::AppEntry>, String> {
    tauri::async_runtime::spawn_blocking(apps::list)
        .await
        .map_err(|e| e.to_string())
}

/// Run the action at `index` (detached) and close the overlay. The effect
/// fires while the close animation runs; nothing blocks on the process.
/// A failure to launch is returned to the webview so the user sees why
/// nothing happened (the overlay stays open).
/// Sequences are best-effort: every step runs in order without delay, a
/// failing step never stops the rest, and the overlay always closes (the
/// fan-out already happened, so staying open would be misleading).
#[tauri::command]
pub fn execute(app: AppHandle, state: State<'_, AppState>, index: usize) -> Result<(), String> {
    let action = state.config.lock().unwrap().actions.get(index).cloned();
    if let Some(action) = action {
        let is_sequence = action.kind == config::ActionKind::Sequence;
        if is_sequence {
            // Best-effort fan-out; individual step failures are logged in
            // `actions::spawn` and never block the close.
            let _ = actions::spawn(&app, &action);
            overlay::close(&app);
            return Ok(());
        }
        actions::spawn(&app, &action)?;
    }
    overlay::close(&app);
    Ok(())
}

/// Esc: close the overlay (the app stays alive in the tray).
#[tauri::command]
pub fn close_overlay(app: AppHandle) {
    overlay::close(&app);
}

/// Minimize-to-tray button: same close flow as Esc.
#[tauri::command]
pub fn hide_to_tray(app: AppHandle) {
    overlay::close(&app);
}

/// Called by the webview when the close animation has finished.
#[tauri::command]
pub fn on_overlay_closed(app: AppHandle) {
    overlay::on_closed(&app);
}

fn fingerprint_bytes(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

/// Content fingerprint used to detect external edits between a reload and a
/// settings save. A missing/unreadable file is `None`.
pub fn config_fingerprint(path: &Path) -> Option<u64> {
    std::fs::read(path)
        .ok()
        .map(|bytes| fingerprint_bytes(&bytes))
}

/// Read the file once so the parsed config and its fingerprint always describe
/// the same bytes. Missing/unreadable/malformed files fall back to the
/// defaults, exactly like `config::load_from`.
pub fn load_config_with_fingerprint(path: &Path) -> (config::Config, Option<u64>) {
    match std::fs::read(path) {
        Ok(bytes) => {
            let fingerprint = fingerprint_bytes(&bytes);
            let parsed = std::str::from_utf8(&bytes)
                .ok()
                .and_then(|text| config::parse_config(text).ok())
                .unwrap_or_else(config::Config::with_defaults);
            (parsed, Some(fingerprint))
        }
        Err(_) => (config::Config::with_defaults(), None),
    }
}

/// Re-read the config file and push the new list to the webview. The
/// webview re-filters with the current query, clamps the selection, and
/// re-localizes the UI.
#[tauri::command]
pub fn reload_config(app: AppHandle) {
    let state = app.state::<AppState>();
    // Parse before taking the lock: a slow disk read must not make every
    // other config reader (the boot payload, execute) wait behind it.
    let (fresh, fingerprint) = load_config_with_fingerprint(&state.config_path);
    let payload = {
        let mut config = state.config.lock().unwrap();
        *config = fresh;
        ConfigPayload::from(&*config)
    };
    *state.config_fingerprint.lock().unwrap() = fingerprint;
    let _ = app.emit("config-reloaded", payload);
}

/// Persist the settings panel's actions + groups + language + magnify +
/// showIcons + chipLayout + theme toggles to the config file, then reload +
/// broadcast (the webview re-filters/re-localizes on the sanitized payload).
/// `chip_layout` is normalized here the same way the parser does: only a
/// known pin ("pills") survives. `circle_size` is clamped to the
/// window-fit range and snapped to the 5% slider grid; the design size
/// (100) is dropped, so the field is only written when it means something.
#[tauri::command]
pub fn save_config(
    app: AppHandle,
    actions: Vec<Action>,
    groups: Vec<Group>,
    language: Option<String>,
    magnify: bool,
    show_icons: bool,
    chip_layout: Option<String>,
    theme: Option<String>,
    circle_size: Option<u32>,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    // Refuse to overwrite an external edit (typically the MCP server) with
    // the settings panel's in-memory list. The user can reload and retry; the
    // webview already turns the Err into a visible save error.
    let current = config_fingerprint(&state.config_path);
    let expected = *state.config_fingerprint.lock().unwrap();
    if current != expected {
        return Err(
            "QuickSpot's config file changed on disk (for example, an MCP server edited it). \
             Press Cmd/Ctrl+R to reload, then save again."
                .to_string(),
        );
    }
    let cfg = config::Config {
        actions,
        groups,
        language,
        magnify,
        show_icons,
        chip_layout: chip_layout.filter(|c| config::valid_chip_layout(c) && c != "ring"),
        theme,
        circle_size: circle_size
            .map(|s| config::normalize_circle_size(s.into()))
            .filter(|s| *s != config::CIRCLE_SIZE_DEFAULT),
    };
    config::save_to(&state.config_path, &cfg)?;
    reload_config(app);
    Ok(())
}

/// Double-press on the grip: re-center the overlay on the work area of
/// the monitor under the cursor (same placement as every open). Failures
/// are logged: the frontend fires this while a button is still physically
/// held, so a silent error would be indistinguishable from "nothing
/// happens" (the Windows-only symptom this command once had).
#[tauri::command]
pub fn center_window(app: AppHandle) -> Result<(), String> {
    overlay::center_on_cursor_monitor(&app).map_err(|e| {
        let msg = e.to_string();
        eprintln!("[quickspot] center_window: {msg}");
        msg
    })
}

/// Start a native window drag from the grip and arm the clamp watchdog.
#[tauri::command]
pub fn drag_start(app: AppHandle) {
    let flag = Arc::clone(&app.state::<DragFlag>().0);
    if flag.swap(true, Ordering::SeqCst) {
        return; // already dragging
    }
    if let Some(win) = app.get_webview_window(overlay::WINDOW_LABEL) {
        let _ = win.start_dragging();
    }
    overlay::spawn_drag_clamp(app, flag);
}

/// End the grip drag (pointerup / window blur).
#[tauri::command]
pub fn drag_end(app: AppHandle) {
    app.state::<DragFlag>().0.store(false, Ordering::SeqCst);
}

/// Cmd/Ctrl+Q: quit the app from inside the overlay.
#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_detects_external_edits_and_missing_files() {
        let mut path = std::env::temp_dir();
        path.push(format!("quickspot-fingerprint-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        assert_eq!(config_fingerprint(&path), None);
        std::fs::write(&path, r#"{"actions":[]}"#).unwrap();
        let first = config_fingerprint(&path);
        assert!(first.is_some());
        std::fs::write(
            &path,
            r#"{"actions":[{"name":"A","kind":"url","value":"x"}]}"#,
        )
        .unwrap();
        let second = config_fingerprint(&path);
        assert!(second.is_some());
        assert_ne!(first, second);
        let (parsed, parsed_fp) = load_config_with_fingerprint(&path);
        assert_eq!(parsed.actions.len(), 1);
        assert_eq!(parsed.actions[0].name, "A");
        assert_eq!(parsed_fp, second);
        let _ = std::fs::remove_file(&path);
        assert_eq!(config_fingerprint(&path), None);
        let (missing, missing_fp) = load_config_with_fingerprint(&path);
        assert_eq!(missing.actions.len(), 3);
        assert_eq!(missing_fp, None);
    }
}
