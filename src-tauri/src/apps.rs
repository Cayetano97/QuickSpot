//! Installed-application discovery for the settings panel's app picker.
//! Best-effort per platform: `.app` bundles on macOS, `.exe` files in the
//! standard Program Files locations on Windows, and `.desktop` entries on
//! Linux. The returned `value` is what `actions::plan` can run.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    /// Display name shown in the picker (and suggested as the action name).
    pub name: String,
    /// Value to store in the action's `value` field.
    pub value: String,
}

#[cfg(target_os = "macos")]
mod platform {
    use super::AppEntry;
    use std::path::{Path, PathBuf};

    /// Standard system-wide locations for `.app` bundles.
    const APP_DIRS: &[&str] = &[
        "/Applications",
        "/System/Applications",
        "/System/Library/CoreServices/Applications",
    ];

    /// Recursively collect `.app` bundles, at most `depth` levels deep.
    fn scan_dir(dir: &Path, depth: usize, out: &mut Vec<AppEntry>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "app").unwrap_or(false) {
                if let Some(app) = app_entry(&path) {
                    out.push(app);
                }
            } else if depth > 0 && path.is_dir() {
                scan_dir(&path, depth - 1, out);
            }
        }
    }

    /// Build an entry for a `.app` bundle. The display name is the bundle
    /// folder name (e.g. "Visual Studio Code"), which matches what most
    /// apps report as their display name and is free of edge cases like
    /// hidden Unicode marks in `CFBundleDisplayName`.
    pub(crate) fn app_entry(path: &Path) -> Option<AppEntry> {
        let file_name = path.file_name()?.to_str()?;
        let name = file_name
            .strip_suffix(".app")
            .unwrap_or(file_name)
            .to_string();
        Some(AppEntry {
            name,
            value: path.to_string_lossy().into_owned(),
        })
    }

    pub fn list() -> Vec<AppEntry> {
        let mut out = Vec::new();
        for dir in APP_DIRS {
            scan_dir(Path::new(dir), 1, &mut out);
        }
        if let Some(home) = std::env::var_os("HOME") {
            let mut user = PathBuf::from(home);
            user.push("Applications");
            scan_dir(&user, 1, &mut out);
        }
        out.sort_by_key(|a| a.name.to_lowercase());
        out.dedup_by(|a, b| a.value == b.value);
        out
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::AppEntry;
    use std::path::{Path, PathBuf};

    fn base_dirs() -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Some(pf) = std::env::var_os("PROGRAMFILES") {
            out.push(PathBuf::from(pf));
        }
        if let Some(pf) = std::env::var_os("PROGRAMFILES(X86)") {
            out.push(PathBuf::from(pf));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            out.push(PathBuf::from(local).join("Programs"));
        }
        out
    }

    fn scan_dir(dir: &Path, depth: usize, out: &mut Vec<AppEntry>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if depth > 0 {
                    scan_dir(&path, depth - 1, out);
                }
            } else if path.extension().map(|e| e.eq_ignore_ascii_case("exe")).unwrap_or(false) {
                let name = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                if name.to_lowercase().contains("unins") || name.to_lowercase().contains("uninstall") {
                    continue;
                }
                out.push(AppEntry {
                    name,
                    value: path.to_string_lossy().into_owned(),
                });
                if out.len() >= 800 {
                    return;
                }
            }
        }
    }

    pub fn list() -> Vec<AppEntry> {
        let mut out = Vec::new();
        for dir in base_dirs() {
            scan_dir(&dir, 1, &mut out);
        }
        out.sort_by_key(|a| a.name.to_lowercase());
        out.dedup_by(|a, b| a.value == b.value);
        out
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::AppEntry;
    use std::path::{Path, PathBuf};

    fn scan_desktop_dir(dir: &Path, out: &mut Vec<AppEntry>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "desktop").unwrap_or(false) {
                if let Some(app) = parse_desktop(&path) {
                    out.push(app);
                }
            }
        }
    }

    fn parse_desktop(path: &Path) -> Option<AppEntry> {
        let text = std::fs::read_to_string(path).ok()?;
        let mut name = None;
        let mut exec = None;
        for line in text.lines() {
            let line = line.trim();
            if let Some(v) = line.strip_prefix("Name=") {
                if name.is_none() {
                    name = Some(v.to_string());
                }
            } else if let Some(v) = line.strip_prefix("Exec=") {
                exec = Some(v.to_string());
            }
        }
        let name = name?;
        let mut exec = exec?;
        // Strip desktop field codes (%U, %f, %i, %c, %k …).
        let mut i = 0;
        while i < exec.len() {
            if exec.as_bytes()[i] == b'%' && i + 1 < exec.len() {
                exec.remove(i + 1);
                exec.remove(i);
            } else {
                i += 1;
            }
        }
        let exec = exec.trim().to_string();
        if exec.is_empty() {
            return None;
        }
        Some(AppEntry { name, value: exec })
    }

    pub fn list() -> Vec<AppEntry> {
        let mut out = Vec::new();
        for dir in ["/usr/share/applications", "/usr/local/share/applications"] {
            scan_desktop_dir(Path::new(dir), &mut out);
        }
        if let Some(home) = std::env::var_os("HOME") {
            let mut user = PathBuf::from(home);
            user.push(".local/share/applications");
            scan_desktop_dir(&user, &mut out);
        }
        out.sort_by_key(|a| a.name.to_lowercase());
        out.dedup_by(|a, b| a.value == b.value);
        out
    }
}

/// Enumerate installed applications (best-effort per platform).
pub fn list() -> Vec<AppEntry> {
    platform::list()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_does_not_panic_and_is_sorted() {
        let apps = list();
        let names: Vec<&str> = apps.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, {
            let mut sorted = names.clone();
            sorted.sort_by_key(|n| n.to_lowercase());
            sorted
        });
        #[cfg(target_os = "macos")]
        {
            assert!(!apps.is_empty(), "macOS should find system applications");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_app_bundle_names_strip_the_extension() {
        use std::path::Path;
        let entry = platform::app_entry(Path::new("/Applications/Visual Studio Code.app")).unwrap();
        assert_eq!(entry.name, "Visual Studio Code");
        assert_eq!(entry.value, "/Applications/Visual Studio Code.app");
        let entry = platform::app_entry(Path::new("/System/Applications/Safari.app")).unwrap();
        assert_eq!(entry.name, "Safari");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_desktop_field_codes_are_stripped() {
        let dir = std::env::temp_dir().join(format!("qs-desktop-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("test.desktop"),
            "[Desktop Entry]\nName=My App\nExec=/usr/bin/myapp --flag %U %f\n",
        )
        .unwrap();
        let app = platform::parse_desktop(&dir.join("test.desktop")).unwrap();
        assert_eq!(app.name, "My App");
        assert_eq!(app.value, "/usr/bin/myapp --flag ");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
