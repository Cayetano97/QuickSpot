//! QuickSpot: a Spotlight-style quick-action launcher built with Tauri v2.
//!
//! The app boots to the tray with the overlay window hidden. A global
//! hotkey (Alt+Space / Option+Space / Super+Space) toggles a round,
//! semi-frosted overlay centered on the monitor under the cursor, with the
//! matching configured actions orbiting a central hub.

mod actions;
mod apps;
mod commands;
mod config;
mod overlay;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Listener, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Managed application state (shared with commands).
pub struct AppState {
    pub config: Mutex<config::Config>,
    pub config_path: PathBuf,
}

/// Set while the grip is dragging; the clamp watchdog reads it.
pub struct DragFlag(pub Arc<AtomicBool>);

/// Seconds to wait after launch before pre-warming the hidden webview.
/// Deliberately placed after Windows' measured boot phase (the period where
/// it samples CPU/disk usage to rate startup impact), so the app is rated
/// Low instead of High, while the first hotkey press stays instant.
const PREWARM_DELAY_SECS: u64 = 15;

/// macOS: use a Login Item via AppleScript instead of a LaunchAgent plist.
/// Hand-dropped LaunchAgent plists are unreliable on modern macOS (silently
/// not loaded at login, never shown in System Settings -> Login Items, and
/// they point at the raw binary inside the bundle). Login Items launch the
/// .app through LaunchServices and are the supported mechanism.
#[cfg(target_os = "macos")]
fn autostart_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_autostart::Builder::new()
        .macos_launcher(tauri_plugin_autostart::MacosLauncher::AppleScript)
        .build()
}

#[cfg(not(target_os = "macos"))]
fn autostart_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_autostart::Builder::new().build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second launch focuses/shows the existing instance.
            overlay::open(app);
        }))
        .plugin(autostart_plugin())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed && *shortcut == hotkey() {
                        overlay::toggle(app);
                    }
                })
                .build(),
        )
        .manage(DragFlag(Arc::new(AtomicBool::new(false))))
        .setup(|app| {
            // Never show in the Dock / Cmd-Tab, even with the overlay open.
            //
            // In the installed .app the real work is done at bundle level by
            // `LSUIElement` (src-tauri/Info.plist), which macOS honours before
            // Launch Services ever creates a Dock slot. The runtime policy
            // here is the fallback for `tauri dev`, where the raw binary runs
            // with no Info.plist: without it the dev build would get a Dock
            // icon the moment it is activated.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Remove the legacy LaunchAgent plist written by earlier
            // autostart implementations; login items are used now, and a
            // stale plist would double-launch the app at login.
            #[cfg(target_os = "macos")]
            {
                if let Some(home) = std::env::var_os("HOME") {
                    let agents = std::path::PathBuf::from(home).join("Library/LaunchAgents");
                    for name in ["QuickSpot.plist", "quickspot.plist"] {
                        let _ = std::fs::remove_file(agents.join(name));
                    }
                }
            }

            // Config lives in the per-user config directory (outside the
            // repo, so a settings save never trips the dev server's
            // rebuild watcher, and the bundle dir stays unwritable-safe).
            // On first run the v1 working-directory file is migrated.
            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            let config_path = config_dir.join("quickspot.config.json");
            if !config_path.exists() {
                let legacy = std::env::current_dir()
                    .unwrap_or_default()
                    .join("quickspot.config.json");
                if legacy.is_file() {
                    let _ = std::fs::copy(&legacy, &config_path);
                }
            }
            // Read + parse exactly once on the launch path; never delays
            // first frame.
            let config = config::load_from(&config_path);
            app.manage(AppState {
                config: Mutex::new(config),
                config_path,
            });
            app.manage(overlay::Overlay::new());

            build_tray(app.handle())?;
            register_hotkey(app.handle());
            overlay::spawn_reconcile(app.handle().clone());

            // The webview's event listeners are registered once its boot
            // sequence completes; only then is it safe to show the overlay
            // and emit `overlay-open` (a lost emit would leave the overlay
            // invisible until the next hotkey press). The frontend emits
            // this right after `init()` finishes.
            let ready_app = app.handle().clone();
            app.listen("quickspot-webview-ready", move |_| {
                let ov = ready_app.state::<overlay::Overlay>();
                ov.mark_ready();
                if ov.take_pending_open() {
                    if let Some(win) = overlay::window(&ready_app) {
                        overlay::show_overlay(&ready_app, &win);
                    }
                }
            });

            // Boot-time startup impact: the window is created lazily so the
            // login autostart stays native-only (WebView2 process spawn is
            // the single big cost, and Windows rates it "High impact").
            // Warm the webview up shortly after launch so the first hotkey
            // press is as instant as before; this only matters for presses
            // within the first seconds of boot.
            let warm_app = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(PREWARM_DELAY_SECS));
                let _ = overlay::ensure_window(&warm_app);
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the overlay window hides to tray; never quits.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                overlay::close(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::list_apps,
            commands::execute,
            commands::close_overlay,
            commands::hide_to_tray,
            commands::on_overlay_closed,
            commands::reload_config,
            commands::save_config,
            commands::drag_start,
            commands::drag_end,
            commands::quit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// The global toggle chord per platform. Deliberately NOT Win+Space (the
/// OS reserves it for the language switcher). On macOS, Option+Space is the
/// default (Raycast-style): it does not collide with stock Spotlight
/// (Cmd+Space) and is registered system-wide via Carbon `RegisterEventHotKey`
/// (no accessibility permission needed for standard keys). A log line is
/// emitted when registration fails so the tray still works.
fn hotkey() -> Shortcut {
    #[cfg(target_os = "windows")]
    {
        Shortcut::new(Some(Modifiers::ALT), Code::Space)
    }
    #[cfg(target_os = "macos")]
    {
        Shortcut::new(Some(Modifiers::ALT), Code::Space)
    }
    #[cfg(target_os = "linux")]
    {
        Shortcut::new(Some(Modifiers::SUPER), Code::Space)
    }
}

fn register_hotkey(app: &AppHandle) {
    if let Err(e) = app.global_shortcut().register(hotkey()) {
        // Chord taken (e.g. Spotlight on macOS): log and continue — the
        // tray still works.
        eprintln!("[quickspot] global hotkey unavailable: {e}");
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Quickspot", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", "Reload config", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Quickspot", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &PredefinedMenuItem::separator(app)?,
            &reload,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    TrayIconBuilder::with_id("quickspot-tray")
        .title("QS")
        .tooltip("Quickspot")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => overlay::toggle(app),
            "reload" => commands::reload_config(app.clone()),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
