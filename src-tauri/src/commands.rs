//! IPC commands exposed to the webview.

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
/// language), whether the dock hover magnification is enabled, and whether
/// the action chips show their kind icons.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPayload {
    pub actions: Vec<Action>,
    pub groups: Vec<Group>,
    pub language: Option<String>,
    pub magnify: bool,
    pub show_icons: bool,
}

impl From<&config::Config> for ConfigPayload {
    fn from(c: &config::Config) -> Self {
        ConfigPayload {
            actions: c.actions.clone(),
            groups: c.groups.clone(),
            language: c.language.clone(),
            magnify: c.magnify,
            show_icons: c.show_icons,
        }
    }
}

/// The current config (serialized to the webview on boot).
#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> ConfigPayload {
    ConfigPayload::from(&*state.config.lock().unwrap())
}

/// Installed applications for the settings panel's app picker.
#[tauri::command]
pub fn list_apps() -> Vec<apps::AppEntry> {
    apps::list()
}

/// Run the action at `index` (detached) and close the overlay. The effect
/// fires while the close animation runs; nothing blocks on the process.
/// A failure to launch is returned to the webview so the user sees why
/// nothing happened (the overlay stays open).
#[tauri::command]
pub fn execute(app: AppHandle, state: State<'_, AppState>, index: usize) -> Result<(), String> {
    let action = state.config.lock().unwrap().actions.get(index).cloned();
    if let Some(action) = action {
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

/// Re-read the config file and push the new list to the webview. The
/// webview re-filters with the current query, clamps the selection, and
/// re-localizes the UI.
#[tauri::command]
pub fn reload_config(app: AppHandle) {
    let state = app.state::<AppState>();
    let mut config = state.config.lock().unwrap();
    *config = config::load_from(&state.config_path);
    let payload = ConfigPayload::from(&*config);
    drop(config);
    let _ = app.emit("config-reloaded", payload);
}

/// Persist the settings panel's actions + groups + language + magnify +
/// showIcons toggles to the config file, then reload + broadcast (the
/// webview re-filters/re-localizes on the sanitized payload).
#[tauri::command]
pub fn save_config(
    app: AppHandle,
    actions: Vec<Action>,
    groups: Vec<Group>,
    language: Option<String>,
    magnify: bool,
    show_icons: bool,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let cfg = config::Config {
        actions,
        groups,
        language,
        magnify,
        show_icons,
    };
    config::save_to(&state.config_path, &cfg)?;
    reload_config(app);
    Ok(())
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
