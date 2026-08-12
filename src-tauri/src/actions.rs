//! Action execution. Everything is spawned from Rust with
//! `std::process::Command` (no JS shell, no tauri-plugin-shell); the
//! default-browser case goes through tauri-plugin-opener.

use std::process::{Command, Stdio};

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::config::{Action, ActionKind};

/// A pure, platform-agnostic description of how an action will run.
/// `plan` is what the tests exercise; `spawn` executes it.
#[derive(Debug, PartialEq, Eq)]
pub enum Execution {
    /// Open with the system default browser (via the opener plugin).
    UrlDefault(String),
    /// Launch `browser` with the URL as its only argument.
    UrlInBrowser { browser: String, url: String },
    /// Run through the platform shell.
    Shell { program: String, args: Vec<String> },
    /// Launch a binary directly.
    App { program: String, args: Vec<String> },
}

#[cfg(windows)]
const SHELL_PROGRAM: &str = "cmd";
#[cfg(windows)]
const SHELL_PREFIX: &[&str] = &["/c"];
#[cfg(not(windows))]
const SHELL_PROGRAM: &str = "sh";
#[cfg(not(windows))]
const SHELL_PREFIX: &[&str] = &["-c"];

/// Normalize a URL value so the OS opener always receives a scheme. A bare
/// hostname like `Google.es` would otherwise be treated as a file path by
/// `/usr/bin/open` (and fail). `host:port` dev links get `http://`.
fn normalize_url(value: &str) -> String {
    let v = value.trim();
    let has_scheme = v.contains("://")
        || v.starts_with("mailto:")
        || v.starts_with("tel:")
        || v.starts_with("data:")
        || v.starts_with("file:");
    if has_scheme {
        v.to_string()
    } else if is_host_port(v) {
        format!("http://{v}")
    } else {
        format!("https://{v}")
    }
}

/// `host:port` such as `localhost:3000` or `127.0.0.1:8080`.
fn is_host_port(v: &str) -> bool {
    match v.rfind(':') {
        Some(idx) if idx > 0 => {
            let port = &v[idx + 1..];
            !port.is_empty() && port.chars().all(|c| c.is_ascii_digit())
        }
        _ => false,
    }
}

pub fn plan(action: &Action) -> Execution {
    match action.kind {
        ActionKind::Url => {
            let url = normalize_url(&action.value);
            match &action.browser {
                Some(browser) => Execution::UrlInBrowser {
                    browser: browser.clone(),
                    url,
                },
                None => Execution::UrlDefault(url),
            }
        }
        ActionKind::Command => Execution::Shell {
            program: SHELL_PROGRAM.into(),
            args: SHELL_PREFIX
                .iter()
                .map(|s| s.to_string())
                .chain(std::iter::once(action.value.clone()))
                .collect(),
        },
        ActionKind::App => {
            #[cfg(target_os = "macos")]
            {
                // `value` may be a bundle id / app display name, a path to
                // an executable file, or a path to an `.app` bundle. Bundles
                // are directories; posix_spawn cannot exec one (EACCES), so
                // they must go through LaunchServices via `open`.
                let path = std::path::Path::new(&action.value);
                if path.is_dir() {
                    Execution::Shell {
                        program: "open".into(),
                        args: vec![action.value.clone()],
                    }
                } else if path.exists() {
                    Execution::App {
                        program: action.value.clone(),
                        args: vec![],
                    }
                } else {
                    Execution::Shell {
                        program: "open".into(),
                        args: vec!["-a".into(), action.value.clone()],
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                Execution::App {
                    program: action.value.clone(),
                    args: vec![],
                }
            }
        }
    }
}

/// Fire an action and forget: detached, no console window, never blocks.
pub fn spawn(app: &AppHandle, action: &Action) -> Result<(), String> {
    match plan(action) {
        Execution::UrlDefault(url) => app
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|e| e.to_string()),
        Execution::UrlInBrowser { browser, url } => {
            let mut cmd = Command::new(browser);
            cmd.arg(url);
            spawn_detached(&mut cmd)
        }
        Execution::Shell { program, args } => {
            let mut cmd = Command::new(program);
            cmd.args(args);
            spawn_detached(&mut cmd)
        }
        Execution::App { program, args } => {
            let mut cmd = Command::new(program);
            cmd.args(args);
            spawn_detached(&mut cmd)
        }
    }
}

fn spawn_detached(cmd: &mut Command) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: spawned processes must not flash a console.
        cmd.creation_flags(0x0800_0000);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn action(kind: ActionKind, value: &str, browser: Option<&str>) -> Action {
        Action {
            name: "t".into(),
            kind,
            value: value.into(),
            browser: browser.map(str::to_string),
            hint: None,
        }
    }

    #[test]
    fn url_without_browser_uses_the_default_opener() {
        let a = action(ActionKind::Url, "https://vercel.com", None);
        assert_eq!(plan(&a), Execution::UrlDefault("https://vercel.com".into()));
    }

    #[test]
    fn url_without_scheme_gets_https_prefix() {
        let a = action(ActionKind::Url, "Google.es", None);
        assert_eq!(plan(&a), Execution::UrlDefault("https://Google.es".into()));
    }

    #[test]
    fn url_without_scheme_is_normalized_when_a_browser_is_set() {
        let a = action(ActionKind::Url, "Google.es", Some("C:/browser.exe"));
        assert_eq!(
            plan(&a),
            Execution::UrlInBrowser {
                browser: "C:/browser.exe".into(),
                url: "https://Google.es".into(),
            }
        );
    }

    #[test]
    fn localhost_with_port_gets_http_prefix() {
        let a = action(ActionKind::Url, "localhost:3000", None);
        assert_eq!(plan(&a), Execution::UrlDefault("http://localhost:3000".into()));
    }

    #[test]
    fn scheme_like_values_are_left_alone() {
        let a = action(ActionKind::Url, "mailto:test@example.com", None);
        assert_eq!(
            plan(&a),
            Execution::UrlDefault("mailto:test@example.com".into())
        );
    }

    #[test]
    fn data_tel_and_file_schemes_are_left_alone() {
        for value in ["data:text/plain,hi", "tel:+34123456789", "file:///tmp/x"] {
            let a = action(ActionKind::Url, value, None);
            assert_eq!(plan(&a), Execution::UrlDefault(value.into()));
        }
    }

    #[test]
    fn ipv4_with_port_gets_http_prefix() {
        let a = action(ActionKind::Url, "127.0.0.1:8080", None);
        assert_eq!(
            plan(&a),
            Execution::UrlDefault("http://127.0.0.1:8080".into())
        );
    }

    #[test]
    fn a_non_numeric_port_is_not_a_port() {
        let a = action(ActionKind::Url, "example.com:abc", None);
        assert_eq!(
            plan(&a),
            Execution::UrlDefault("https://example.com:abc".into())
        );
    }

    #[test]
    fn a_trailing_colon_is_not_a_port() {
        let a = action(ActionKind::Url, "localhost:", None);
        assert_eq!(plan(&a), Execution::UrlDefault("https://localhost:".into()));
    }

    #[test]
    fn surrounding_whitespace_is_trimmed() {
        let a = action(ActionKind::Url, "  google.com  ", None);
        assert_eq!(plan(&a), Execution::UrlDefault("https://google.com".into()));
    }

    #[test]
    fn url_with_browser_launches_that_browser_with_the_url_as_only_arg() {
        let a = action(
            ActionKind::Url,
            "https://github.com",
            Some("C:/Program Files/Mozilla Firefox/firefox.exe"),
        );
        assert_eq!(
            plan(&a),
            Execution::UrlInBrowser {
                browser: "C:/Program Files/Mozilla Firefox/firefox.exe".into(),
                url: "https://github.com".into(),
            }
        );
    }

    #[test]
    fn command_runs_through_the_platform_shell() {
        let a = action(ActionKind::Command, "echo hello", None);
        match plan(&a) {
            Execution::Shell { program, args } => {
                #[cfg(windows)]
                {
                    assert_eq!(program, "cmd");
                    assert_eq!(args, vec!["/c", "echo hello"]);
                }
                #[cfg(not(windows))]
                {
                    assert_eq!(program, "sh");
                    assert_eq!(args, vec!["-c", "echo hello"]);
                }
            }
            other => panic!("unexpected plan: {other:?}"),
        }
    }

    #[test]
    fn app_launches_the_binary_directly() {
        // On macOS a non-path value is treated as a bundle id; use the
        // test binary's own path so the direct-launch branch is hit on
        // every platform.
        let path = std::env::current_exe().unwrap();
        let value = path.to_str().unwrap();
        let a = action(ActionKind::App, value, None);
        match plan(&a) {
            Execution::App { program, args } => {
                assert_eq!(program, value);
                assert!(args.is_empty());
            }
            other => panic!("unexpected plan: {other:?}"),
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_bundle_id_routes_through_open_la() {
        let a = action(ActionKind::App, "com.apple.Safari", None);
        assert_eq!(
            plan(&a),
            Execution::Shell {
                program: "open".into(),
                args: vec!["-a".into(), "com.apple.Safari".into()],
            }
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_app_bundle_path_routes_through_open() {
        let dir = std::env::temp_dir().join(format!("qs-bundle-{}.app", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let value = dir.to_str().unwrap().to_string();
        let a = action(ActionKind::App, &value, None);
        assert_eq!(
            plan(&a),
            Execution::Shell {
                program: "open".into(),
                args: vec![value],
            }
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_executable_file_path_spawns_directly() {
        let path = std::env::current_exe().unwrap();
        let value = path.to_str().unwrap();
        let a = action(ActionKind::App, value, None);
        match plan(&a) {
            Execution::App { program, args } => {
                assert_eq!(program, value);
                assert!(args.is_empty());
            }
            other => panic!("unexpected plan: {other:?}"),
        }
    }
}
