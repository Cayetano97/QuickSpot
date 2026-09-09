//! Quickspot configuration: `quickspot.config.json` parsing with the exact
//! fallback semantics of the original (missing file / malformed JSON ->
//! built-in defaults; invalid items are skipped). There is no hard limit on
//! the number of actions; the overlay shows the first 8 matches.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionKind {
    Url,
    Command,
    App,
    /// Open a file with its OS default handler.
    File,
    /// Open a folder with the OS file manager.
    Folder,
    /// Run up to MAX_SEQUENCE_STEPS sub-actions in order (no nesting).
    Sequence,
}

/// Maximum steps a `sequence` action can hold. The editor caps at this, and
/// the backend truncates anything beyond it so a hand-edit can never blow up
/// execution.
pub const MAX_SEQUENCE_STEPS: usize = 5;

/// One step inside a `sequence` action. Intentionally minimal: a kind, a
/// value, and an optional per-URL browser override. Steps never nest
/// (`sequence` inside `sequence` is dropped on parse/sanitize/plan).
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceStep {
    pub kind: ActionKind,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub browser: Option<String>,
}

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub name: String,
    pub kind: ActionKind,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub browser: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    /// Id of the group this action belongs to, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// Sub-actions for `kind == Sequence`. `None`/empty for every other kind.
    /// `value` is unused for sequences (always normalized to `""` on save).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<SequenceStep>>,
}

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    pub color: String,
}

/// Accepts `#rrggbb` (6 hex digits); anything else is treated as absent,
/// so a malformed hand-edit can never break the UI.
fn valid_color(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 7
        && b[0] == b'#'
        && b[1..].iter().all(|c| c.is_ascii_hexdigit())
}

#[derive(Debug, PartialEq, Eq)]
pub enum ConfigError {
    Parse,
    Malformed,
}

/// The parsed config: the action list, the optional group definitions (a
/// group is just a named color bucket actions can reference), an optional
/// language override (`"system"` = follow the OS, or any BCP-47-ish code
/// such as `"en"` / `"es"` / `"fr"`; `None` = follow the OS), the dock hover
/// magnification flag (defaults to on), whether the action chips show
/// their kind icons (defaults to on), and an optional appearance override
/// (`None`/`"system"` = follow the OS: light OS -> light, dark OS -> dark;
/// `Some("light"|"dark"|"deep")` pins the variant, `deep` being the
/// pure-black OLED opt-in).
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct Config {
    pub actions: Vec<Action>,
    pub groups: Vec<Group>,
    pub language: Option<String>,
    pub magnify: bool,
    pub show_icons: bool,
    pub theme: Option<String>,
}

impl Config {
    pub fn with_defaults() -> Self {
        Config {
            actions: defaults(),
            groups: Vec::new(),
            language: None,
            magnify: true,
            show_icons: true,
            theme: None,
        }
    }
}

/// The accepted `language` values: `"system"` (follow the OS) or any
/// BCP-47-ish code such as `"en"`, `"es"`, `"fr"`, `"zh-TW"`. The set of
/// codes is not hardcoded: the frontend ships one locale file per language
/// (`src/lib/locales/*.json`) and falls back to English for unknown codes,
/// so a new language only needs its locale file, not a Rust change.
pub fn valid_language(value: &str) -> bool {
    value == "system"
        || (!value.is_empty()
            && value.len() <= 64
            && value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
}

/// The accepted `theme` values: `"system"` (follow the OS), `"light"`,
/// `"dark"` (elevated gray) or `"deep"` (pure-black OLED). Anything else
/// falls back to system, so a hand-edit can never break the UI.
pub fn valid_theme(value: &str) -> bool {
    matches!(value, "system" | "light" | "dark" | "deep")
}

/// The three built-in defaults.
pub fn defaults() -> Vec<Action> {
    vec![
        Action {
            name: "QuickSpot".into(),
            kind: ActionKind::Url,
            value: "https://github.com/Cayetano97/QuickSpot".into(),
            browser: None,
            hint: None,
            group: None,
            steps: None,
        },
        Action {
            name: "YouTube".into(),
            kind: ActionKind::Url,
            value: "https://youtube.com".into(),
            browser: None,
            hint: None,
            group: None,
            steps: None,
        },
        Action {
            name: "Google".into(),
            kind: ActionKind::Url,
            value: "https://google.com".into(),
            browser: None,
            hint: None,
            group: None,
            steps: None,
        },
    ]
}

/// Parse one sequence step: kind must be a runnable leaf (url/command/app/
/// file/folder — never `sequence`), value must be present. Empty values are
/// kept here (the editor flags them) but dropped by `sanitize` and skipped
/// at execution time.
fn parse_sequence_step(item: &serde_json::Value) -> Option<SequenceStep> {
    let obj = item.as_object()?;
    let kind = match obj.get("kind").and_then(|v| v.as_str()) {
        Some("url") => ActionKind::Url,
        Some("command") => ActionKind::Command,
        Some("app") => ActionKind::App,
        Some("file") => ActionKind::File,
        Some("folder") => ActionKind::Folder,
        // No nesting: a hand-edited `sequence` inside `steps` is ignored.
        _ => return None,
    };
    let value = obj.get("value").and_then(|v| v.as_str())?;
    Some(SequenceStep {
        kind,
        value: value.to_string(),
        browser: obj.get("browser").and_then(|v| v.as_str()).map(str::to_string),
    })
}

/// Parse the `steps` array of a sequence action: keep valid leaf steps in
/// order, capped at MAX_SEQUENCE_STEPS.
fn parse_sequence_steps(root: &serde_json::Map<String, serde_json::Value>) -> Vec<SequenceStep> {
    let mut out = Vec::new();
    if let Some(list) = root.get("steps").and_then(|v| v.as_array()) {
        for item in list {
            if out.len() >= MAX_SEQUENCE_STEPS {
                break;
            }
            if let Some(step) = parse_sequence_step(item) {
                out.push(step);
            }
        }
    }
    out
}

/// Parse config text. Errors (parse failure or no `actions` array) return
/// `Err`; the caller falls back to defaults. Items missing
/// `name`/`kind` (or `value` for non-sequence kinds) or with an unknown
/// `kind` are skipped; a `sequence` with no valid `steps` is skipped too;
/// groups with a missing/blank id, name, or an invalid color are skipped too.
pub fn parse_config(text: &str) -> Result<Config, ConfigError> {
    let root: serde_json::Value =
        serde_json::from_str(text).map_err(|_| ConfigError::Parse)?;
    let items = root
        .get("actions")
        .and_then(|a| a.as_array())
        .ok_or(ConfigError::Malformed)?;
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let Some(name) = obj.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        if name.trim().is_empty() {
            continue;
        }
        let kind = match obj.get("kind").and_then(|v| v.as_str()) {
            Some("url") => ActionKind::Url,
            Some("command") => ActionKind::Command,
            Some("app") => ActionKind::App,
            Some("file") => ActionKind::File,
            Some("folder") => ActionKind::Folder,
            Some("sequence") => ActionKind::Sequence,
            _ => continue,
        };
        if kind == ActionKind::Sequence {
            let steps = parse_sequence_steps(obj);
            if steps.is_empty() {
                continue;
            }
            out.push(Action {
                name: name.to_string(),
                kind,
                // `value` is unused for sequences: normalize to "" so old
                // readers (and the TS model) keep a stable string field.
                value: String::new(),
                browser: None,
                hint: obj.get("hint").and_then(|v| v.as_str()).map(str::to_string),
                group: obj.get("group").and_then(|v| v.as_str()).map(str::to_string),
                steps: Some(steps),
            });
            continue;
        }
        let Some(value) = obj.get("value").and_then(|v| v.as_str()) else {
            continue;
        };
        out.push(Action {
            name: name.to_string(),
            kind,
            value: value.to_string(),
            browser: obj.get("browser").and_then(|v| v.as_str()).map(str::to_string),
            hint: obj.get("hint").and_then(|v| v.as_str()).map(str::to_string),
            group: obj.get("group").and_then(|v| v.as_str()).map(str::to_string),
            steps: None,
        });
    }
    let mut groups = Vec::new();
    if let Some(list) = root.get("groups").and_then(|a| a.as_array()) {
        for item in list {
            let Some(obj) = item.as_object() else {
                continue;
            };
            let (Some(id), Some(name), Some(color)) = (
                obj.get("id").and_then(|v| v.as_str()),
                obj.get("name").and_then(|v| v.as_str()),
                obj.get("color").and_then(|v| v.as_str()),
            ) else {
                continue;
            };
            let id = id.trim();
            let name = name.trim();
            if id.is_empty() || name.is_empty() || !valid_color(color.trim()) {
                continue;
            }
            groups.push(Group {
                id: id.to_string(),
                name: name.to_string(),
                color: color.trim().to_string(),
            });
        }
    }
    let language = match root.get("language").and_then(|v| v.as_str()) {
        Some(l) if valid_language(l) => Some(l.to_string()),
        _ => None,
    };
    let magnify = root.get("magnify").and_then(|v| v.as_bool()).unwrap_or(true);
    let show_icons = root.get("showIcons").and_then(|v| v.as_bool()).unwrap_or(true);
    let theme = match root.get("theme").and_then(|v| v.as_str()) {
        Some(t) if valid_theme(t) && t != "system" => Some(t.to_string()),
        _ => None,
    };
    Ok(Config {
        actions: out,
        groups,
        language,
        magnify,
        show_icons,
        theme,
    })
}

/// Read + parse exactly once. Missing file or any parse error -> defaults.
pub fn load_from(path: &Path) -> Config {
    match std::fs::read_to_string(path) {
        Ok(text) => parse_config(&text).unwrap_or_else(|_| Config::with_defaults()),
        Err(_) => Config::with_defaults(),
    }
}

/// Lenient validation mirroring `parse_config`: empty names/values are
/// dropped (sequences need a name plus at least one non-empty leaf step and
/// are capped at MAX_SEQUENCE_STEPS; nesting is dropped).
/// `browser`/`hint`/`group` are kept as-is when present.
pub fn sanitize(actions: Vec<Action>) -> Vec<Action> {
    let mut out = Vec::with_capacity(actions.len());
    for mut a in actions {
        a.name = a.name.trim().to_string();
        if a.name.is_empty() {
            continue;
        }
        if a.kind == ActionKind::Sequence {
            let mut steps: Vec<SequenceStep> = a
                .steps
                .unwrap_or_default()
                .into_iter()
                .filter(|s| s.kind != ActionKind::Sequence)
                .map(|mut s| {
                    s.value = s.value.trim().to_string();
                    if let Some(b) = s.browser.take() {
                        let b = b.trim().to_string();
                        // Keep the per-URL browser override; drop blanks and
                        // overrides on non-URL steps where it makes no sense.
                        if s.kind == ActionKind::Url && !b.is_empty() {
                            s.browser = Some(b);
                        }
                    }
                    s
                })
                .filter(|s| !s.value.is_empty())
                .take(MAX_SEQUENCE_STEPS)
                .collect();
            if steps.is_empty() {
                continue;
            }
            // Defensive: `take` already caps, but never trust a hand-edit.
            steps.truncate(MAX_SEQUENCE_STEPS);
            a.value = String::new();
            a.browser = None;
            a.steps = Some(steps);
            match &a.group {
                Some(g) if g.trim().is_empty() => a.group = None,
                _ => {}
            }
            out.push(a);
            continue;
        }
        a.value = a.value.trim().to_string();
        if a.value.is_empty() {
            continue;
        }
        a.steps = None;
        match &a.group {
            Some(g) if g.trim().is_empty() => a.group = None,
            _ => {}
        }
        out.push(a);
    }
    out
}

/// Drop groups with a blank id/name or a non-`#rrggbb` color.
pub fn sanitize_groups(groups: Vec<Group>) -> Vec<Group> {
    groups
        .into_iter()
        .filter(|g| {
            let id = g.id.trim();
            let name = g.name.trim();
            !id.is_empty() && !name.is_empty() && valid_color(g.color.trim())
        })
        .map(|mut g| {
            g.id = g.id.trim().to_string();
            g.name = g.name.trim().to_string();
            g.color = g.color.trim().to_string();
            g
        })
        .collect()
}

/// Write the config back to `path` as pretty JSON (camelCase, optional
/// fields omitted). `language: None` (system default) omits the field; so
/// does `magnify: true` or `showIcons: true`, since on is the default; an
/// empty group list is omitted too. `theme: None` (system) is omitted; only
/// an explicit `light`/`dark`/`deep` pin is written.
pub fn save_to(path: &Path, config: &Config) -> Result<(), String> {
    let mut root = serde_json::json!({ "actions": sanitize(config.actions.clone()) });
    if !config.groups.is_empty() {
        root["groups"] = serde_json::to_value(sanitize_groups(config.groups.clone()))
            .map_err(|e| e.to_string())?;
    }
    if let Some(lang) = &config.language {
        root["language"] = serde_json::Value::String(lang.clone());
    }
    if !config.magnify {
        root["magnify"] = serde_json::Value::Bool(false);
    }
    if !config.show_icons {
        root["showIcons"] = serde_json::Value::Bool(false);
    }
    if let Some(theme) = &config.theme {
        if valid_theme(theme) && theme != "system" {
            root["theme"] = serde_json::Value::String(theme.clone());
        }
    }
    let text = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempfile(content: &str) -> std::path::PathBuf {
        static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let mut path = std::env::temp_dir();
        path.push(format!(
            "quickspot-test-{}-{}.json",
            std::process::id(),
            n
        ));
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn default_config_loads_three_builtin_actions_when_no_file_exists() {
        let path = std::path::Path::new(
            "/quickspot-__no_such_file__.json",
        );
        let config = load_from(path);
        assert_eq!(config.actions.len(), 3);
        assert_eq!(config.actions[0].kind, ActionKind::Url);
        assert_eq!(config.actions[0].name, "QuickSpot");
        assert_eq!(config.language, None);
    }

    #[test]
    fn malformed_json_falls_back_to_defaults() {
        let path = tempfile("{ this is not json");
        assert_eq!(load_from(&path), Config::with_defaults());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn more_than_eight_actions_are_allowed() {
        let items: Vec<String> = (0..12)
            .map(|i| {
                format!(
                    r#"{{"name":"a{i}","kind":"url","value":"https://example.com/{i}"}}"#
                )
            })
            .collect();
        let path = tempfile(&format!(r#"{{"actions":[{}]}}"#, items.join(",")));
        let config = load_from(&path);
        assert_eq!(config.actions.len(), 12);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn items_missing_fields_or_with_unknown_kind_are_skipped() {
        let text = r#"{
            "actions": [
                { "name": "Vercel", "kind": "url", "value": "https://vercel.com" },
                { "name": "No value", "kind": "url" },
                { "kind": "url", "value": "https://no-name.example" },
                { "name": "Bad kind", "kind": "ftp", "value": "x" },
                { "name": "Chrome", "kind": "app", "value": "/usr/bin/chrome" },
                42
            ]
        }"#;
        let actions = parse_config(text).unwrap().actions;
        assert_eq!(actions.len(), 2);
        assert_eq!(actions[0].name, "Vercel");
        assert_eq!(actions[1].name, "Chrome");
        assert_eq!(actions[1].kind, ActionKind::App);
    }

    #[test]
    fn browser_override_is_parsed() {
        let text = r#"{
            "actions": [
                { "name": "GitHub in Firefox", "kind": "url", "value": "https://github.com",
                  "browser": "C:/Program Files/Mozilla Firefox/firefox.exe" }
            ]
        }"#;
        let actions = parse_config(text).unwrap().actions;
        assert_eq!(actions.len(), 1);
        assert_eq!(
            actions[0].browser.as_deref(),
            Some("C:/Program Files/Mozilla Firefox/firefox.exe")
        );
        assert_eq!(actions[0].hint, None);
    }

    #[test]
    fn hint_field_is_parsed_but_ignored_by_v1() {
        let text = r#"{
            "actions": [
                { "name": "GitHub", "kind": "url", "value": "https://github.com", "hint": "github" }
            ]
        }"#;
        let actions = parse_config(text).unwrap().actions;
        assert_eq!(actions[0].hint.as_deref(), Some("github"));
    }

    #[test]
    fn file_kind_is_parsed_for_files_and_folders() {
        let text = r#"{
            "actions": [
                { "name": "Notes", "kind": "file", "value": "/tmp/notes.txt" },
                { "name": "Projects", "kind": "folder", "value": "/Users/me/Projects" }
            ]
        }"#;
        let actions = parse_config(text).unwrap().actions;
        assert_eq!(actions.len(), 2);
        assert_eq!(actions[0].kind, ActionKind::File);
        assert_eq!(actions[0].value, "/tmp/notes.txt");
        assert_eq!(actions[1].kind, ActionKind::Folder);
        assert_eq!(actions[1].value, "/Users/me/Projects");
    }

    #[test]
    fn file_actions_round_trip_through_save_and_load() {
        let mut path = std::env::temp_dir();
        path.push(format!("quickspot-save-file-{}.json", std::process::id()));
        let original = Config {
            actions: vec![Action {
                name: "Downloads".into(),
                kind: ActionKind::File,
                value: "/home/me/Downloads".into(),
                browser: None,
                hint: None,
                group: None,
                steps: None,
            }],
            groups: Vec::new(),
            language: None,
            magnify: true,
            show_icons: true,
            theme: None,
        };
        save_to(&path, &original).unwrap();
        assert_eq!(load_from(&path), original);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn empty_actions_array_is_a_valid_empty_config() {
        let config = parse_config(r#"{"actions":[]}"#).unwrap();
        assert!(config.actions.is_empty());
        assert_eq!(config.language, None);
    }

    #[test]
    fn language_is_parsed_when_valid() {
        let config = parse_config(r#"{"language":"es","actions":[]}"#).unwrap();
        assert_eq!(config.language.as_deref(), Some("es"));
        let config = parse_config(r#"{"language":"system","actions":[]}"#).unwrap();
        assert_eq!(config.language.as_deref(), Some("system"));
        let config = parse_config(r#"{"language":"en","actions":[]}"#).unwrap();
        assert_eq!(config.language.as_deref(), Some("en"));
        let config = parse_config(r#"{"language":"fr","actions":[]}"#).unwrap();
        assert_eq!(config.language.as_deref(), Some("fr"));
        let config = parse_config(r#"{"language":"zh-TW","actions":[]}"#).unwrap();
        assert_eq!(config.language.as_deref(), Some("zh-TW"));
    }

    #[test]
    fn unknown_language_falls_back_to_system() {
        let config = parse_config(r#"{"language":"","actions":[]}"#).unwrap();
        assert_eq!(config.language, None);
        let config = parse_config(r#"{"language":"muy largo","actions":[]}"#).unwrap();
        assert_eq!(config.language, None);
    }

    #[test]
    fn magnify_defaults_to_true() {
        let config = parse_config(r#"{"actions":[]}"#).unwrap();
        assert!(config.magnify);
    }

    #[test]
    fn magnify_is_parsed_when_present() {
        let off = parse_config(r#"{"magnify":false,"actions":[]}"#).unwrap();
        assert!(!off.magnify);
        let on = parse_config(r#"{"magnify":true,"actions":[]}"#).unwrap();
        assert!(on.magnify);
    }

    #[test]
    fn magnify_is_written_only_when_disabled() {
        let mut path = std::env::temp_dir();
        path.push(format!("quickspot-save-magnify-{}.json", std::process::id()));
        let config = Config {
            actions: vec![action("Vercel", "https://vercel.com")],
            groups: Vec::new(),
            language: None,
            magnify: false,
            show_icons: true,
            theme: None,
        };
        save_to(&path, &config).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"magnify\": false"));
        assert_eq!(load_from(&path), config);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn show_icons_defaults_to_true() {
        let config = parse_config(r#"{"actions":[]}"#).unwrap();
        assert!(config.show_icons);
    }

    #[test]
    fn show_icons_is_parsed_when_present() {
        let off = parse_config(r#"{"showIcons":false,"actions":[]}"#).unwrap();
        assert!(!off.show_icons);
        let on = parse_config(r#"{"showIcons":true,"actions":[]}"#).unwrap();
        assert!(on.show_icons);
    }

    #[test]
    fn show_icons_is_written_only_when_disabled() {
        let mut path = std::env::temp_dir();
        path.push(format!("quickspot-save-icons-{}.json", std::process::id()));
        let config = Config {
            actions: vec![action("Vercel", "https://vercel.com")],
            groups: Vec::new(),
            language: None,
            magnify: true,
            show_icons: false,
            theme: None,
        };
        save_to(&path, &config).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"showIcons\": false"));
        assert_eq!(load_from(&path), config);
        let _ = std::fs::remove_file(&path);
    }

    fn action(name: &str, value: &str) -> Action {
        Action {
            name: name.into(),
            kind: ActionKind::Url,
            value: value.into(),
            browser: None,
            hint: None,
            group: None,
            steps: None,
        }
    }

    #[test]
    fn sanitize_trims_and_drops_empty_entries() {
        let cleaned = sanitize(vec![
            action("  Vercel  ", "  https://vercel.com  "),
            action("", "https://nope.example"),
            action("No value", "   "),
        ]);
        assert_eq!(cleaned.len(), 1);
        assert_eq!(cleaned[0].name, "Vercel");
        assert_eq!(cleaned[0].value, "https://vercel.com");
    }

    #[test]
    fn sanitize_keeps_more_than_eight_actions() {
        let many = (0..10).map(|i| action(&format!("a{i}"), &format!("v{i}"))).collect();
        assert_eq!(sanitize(many).len(), 10);
    }

    #[test]
    fn save_to_writes_a_file_that_loads_back() {
        let mut path = std::env::temp_dir();
        path.push(format!("quickspot-save-test-{}.json", std::process::id()));
        let original = Config {
            actions: vec![
                action("Vercel", "https://vercel.com"),
                action("GitHub", "https://github.com"),
            ],
            groups: Vec::new(),
            language: Some("es".into()),
            magnify: false,
            show_icons: false,
            theme: None,
        };
        save_to(&path, &original).unwrap();
        assert_eq!(load_from(&path), original);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn system_language_is_omitted_when_saving() {
        let mut path = std::env::temp_dir();
        path.push(format!("quickspot-save-lang-{}.json", std::process::id()));
        let config = Config {
            actions: vec![action("Vercel", "https://vercel.com")],
            groups: Vec::new(),
            language: None,
            magnify: true,
            show_icons: true,
            theme: None,
        };
        save_to(&path, &config).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("language"));
        assert_eq!(load_from(&path), config);
        let _ = std::fs::remove_file(&path);
    }

    fn group(id: &str, name: &str, color: &str) -> Group {
        Group {
            id: id.into(),
            name: name.into(),
            color: color.into(),
        }
    }

    #[test]
    fn groups_are_parsed_with_their_actions() {
        let text = r##"{
            "groups": [
                { "id": "work", "name": "Work", "color": "#5e9eff" },
                { "id": "social", "name": "Social", "color": "#ff9f0a" }
            ],
            "actions": [
                { "name": "Slack", "kind": "url", "value": "https://slack.com", "group": "work" },
                { "name": "Google", "kind": "url", "value": "https://google.com" }
            ]
        }"##;
        let config = parse_config(text).unwrap();
        assert_eq!(
            config.groups,
            vec![group("work", "Work", "#5e9eff"), group("social", "Social", "#ff9f0a")]
        );
        assert_eq!(config.actions[0].group.as_deref(), Some("work"));
        assert_eq!(config.actions[1].group, None);
    }

    #[test]
    fn missing_groups_array_defaults_to_empty() {
        let config = parse_config(r#"{"actions":[]}"#).unwrap();
        assert!(config.groups.is_empty());
    }

    #[test]
    fn groups_with_missing_fields_or_bad_colors_are_skipped() {
        let text = r##"{
            "groups": [
                { "id": "ok", "name": "Ok", "color": "#5e9eff" },
                { "id": "", "name": "No id", "color": "#5e9eff" },
                { "id": "noname", "color": "#5e9eff" },
                { "id": "badcolor", "name": "Bad color", "color": "5e9eff" },
                { "id": "short", "name": "Short", "color": "#5e9e" },
                { "id": "upper", "name": "Upper", "color": "#5E9EFF" },
                42
            ],
            "actions": []
        }"##;
        let config = parse_config(text).unwrap();
        assert_eq!(
            config.groups,
            vec![group("ok", "Ok", "#5e9eff"), group("upper", "Upper", "#5E9EFF")]
        );
    }

    #[test]
    fn action_group_referencing_an_unknown_id_is_kept_lenient() {
        let config = parse_config(
            r#"{"actions":[{"name":"Ghost","kind":"url","value":"https://x.dev","group":"nope"}]}"#,
        )
        .unwrap();
        assert_eq!(config.actions[0].group.as_deref(), Some("nope"));
        assert!(config.groups.is_empty());
    }

    #[test]
    fn sanitize_groups_trims_and_drops_invalid_entries() {
        let cleaned = sanitize_groups(vec![
            group("  work  ", "  Work  ", " #5e9eff "),
            group("", "Blank id", "#5e9eff"),
            group("noname", "   ", "#5e9eff"),
            group("badcolor", "Bad color", "red"),
            group("good", "Good", "#30d158"),
        ]);
        assert_eq!(cleaned.len(), 2);
        assert_eq!(cleaned[0], group("work", "Work", "#5e9eff"));
        assert_eq!(cleaned[1], group("good", "Good", "#30d158"));
    }

    #[test]
    fn save_to_writes_groups_only_when_present() {
        let mut path = std::env::temp_dir();
        path.push(format!("quickspot-save-groups-{}.json", std::process::id()));
        let config = Config {
            actions: vec![
                action("Slack", "https://slack.com"),
                Action {
                    name: "GitHub".into(),
                    kind: ActionKind::Url,
                    value: "https://github.com".into(),
                    browser: None,
                    hint: None,
                    group: Some("work".into()),
                    steps: None,
                },
            ],
            groups: vec![group("work", "Work", "#5e9eff")],
            language: None,
            magnify: true,
            show_icons: true,
            theme: None,
        };
        save_to(&path, &config).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"groups\""));
        assert!(text.contains("\"group\": \"work\""));
        assert_eq!(load_from(&path), config);
        let _ = std::fs::remove_file(&path);
    }

    fn seq_step(kind: ActionKind, value: &str) -> SequenceStep {
        SequenceStep {
            kind,
            value: value.into(),
            browser: None,
        }
    }

    #[test]
    fn sequence_is_parsed_with_its_steps_in_order() {
        let text = r#"{
            "actions": [
                { "name": "Morning", "kind": "sequence", "steps": [
                    { "kind": "folder", "value": "/tmp/Projects" },
                    { "kind": "url", "value": "https://example.com", "browser": "/usr/bin/firefox" }
                ] }
            ]
        }"#;
        let actions = parse_config(text).unwrap().actions;
        assert_eq!(actions.len(), 1);
        assert_eq!(actions[0].kind, ActionKind::Sequence);
        assert_eq!(actions[0].value, "");
        let steps = actions[0].steps.as_ref().unwrap();
        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0], seq_step(ActionKind::Folder, "/tmp/Projects"));
        assert_eq!(steps[1].kind, ActionKind::Url);
        assert_eq!(steps[1].value, "https://example.com");
        assert_eq!(steps[1].browser.as_deref(), Some("/usr/bin/firefox"));
    }

    #[test]
    fn sequence_without_valid_steps_is_skipped() {
        for text in [
            r#"{"actions":[{"name":"Empty","kind":"sequence","steps":[]}]}"#,
            r#"{"actions":[{"name":"NoSteps","kind":"sequence"}]}"#,
            r#"{"actions":[{"name":"NestedOnly","kind":"sequence","steps":[{"kind":"sequence","value":"x"}]}]}"#,
        ] {
            let config = parse_config(text).unwrap();
            assert!(config.actions.is_empty(), "{text}");
        }
    }

    #[test]
    fn sequence_steps_are_capped_at_five_and_nesting_dropped() {
        let items: Vec<String> = (0..8)
            .map(|i| format!(r#"{{"kind":"url","value":"https://example.com/{i}"}}"#))
            .collect();
        let text = format!(
            r#"{{"actions":[{{"name":"Big","kind":"sequence","steps":[{}]}}]}}"#,
            items.join(",")
        );
        let steps = parse_config(&text).unwrap().actions[0]
            .steps
            .clone()
            .unwrap();
        assert_eq!(steps.len(), MAX_SEQUENCE_STEPS);
    }

    #[test]
    fn sanitize_sequence_trims_drops_empty_caps_and_normalizes() {
        let a = Action {
            name: "  Morning  ".into(),
            kind: ActionKind::Sequence,
            value: "should-be-cleared".into(),
            browser: Some("/bin/x".into()),
            hint: None,
            group: Some("  ".into()),
            steps: Some(vec![
                seq_step(ActionKind::Url, "  https://a.dev  "),
                seq_step(ActionKind::Sequence, "nested"),
                seq_step(ActionKind::Command, "   "),
                seq_step(ActionKind::File, "/tmp/a.txt"),
                seq_step(ActionKind::Folder, "/tmp/b"),
                seq_step(ActionKind::Url, "https://c.dev"),
                seq_step(ActionKind::Url, "https://d.dev"),
            ]),
        };
        let cleaned = sanitize(vec![a]);
        assert_eq!(cleaned.len(), 1);
        assert_eq!(cleaned[0].name, "Morning");
        assert_eq!(cleaned[0].value, "");
        assert_eq!(cleaned[0].browser, None);
        assert_eq!(cleaned[0].group, None);
        let steps = cleaned[0].steps.as_ref().unwrap();
        assert_eq!(steps.len(), MAX_SEQUENCE_STEPS);
        assert_eq!(steps[0].value, "https://a.dev");
        assert_eq!(steps[1].value, "/tmp/a.txt");
    }

    #[test]
    fn sanitize_drops_sequences_without_runnable_steps() {
        let a = Action {
            name: "Bad".into(),
            kind: ActionKind::Sequence,
            value: String::new(),
            browser: None,
            hint: None,
            group: None,
            steps: Some(vec![seq_step(ActionKind::Url, "   ")]),
        };
        assert!(sanitize(vec![a]).is_empty());
    }

    #[test]
    fn sequence_round_trips_through_save_and_load() {
        let mut path = std::env::temp_dir();
        path.push(format!("quickspot-save-seq-{}.json", std::process::id()));
        let original = Config {
            actions: vec![Action {
                name: "Morning".into(),
                kind: ActionKind::Sequence,
                value: String::new(),
                browser: None,
                hint: None,
                group: Some("work".into()),
                steps: Some(vec![
                    seq_step(ActionKind::Folder, "/tmp/Projects"),
                    seq_step(ActionKind::Url, "https://example.com"),
                ]),
            }],
            groups: vec![group("work", "Work", "#5e9eff")],
            language: None,
            magnify: true,
            show_icons: true,
            theme: None,
        };
        save_to(&path, &original).unwrap();
        assert_eq!(load_from(&path), original);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn theme_defaults_to_system() {
        let config = parse_config(r#"{"actions":[]}"#).unwrap();
        assert_eq!(config.theme, None);
    }

    #[test]
    fn theme_is_parsed_when_valid() {
        let deep = parse_config(r#"{"theme":"deep","actions":[]}"#).unwrap();
        assert_eq!(deep.theme.as_deref(), Some("deep"));
        let dark = parse_config(r#"{"theme":"dark","actions":[]}"#).unwrap();
        assert_eq!(dark.theme.as_deref(), Some("dark"));
        let light = parse_config(r#"{"theme":"light","actions":[]}"#).unwrap();
        assert_eq!(light.theme.as_deref(), Some("light"));
    }

    #[test]
    fn theme_falls_back_to_system_when_unknown() {
        for text in [
            r#"{"theme":"system","actions":[]}"#,
            r#"{"theme":"sepia","actions":[]}"#,
            r#"{"theme":"","actions":[]}"#,
            r#"{"theme":42,"actions":[]}"#,
        ] {
            let config = parse_config(text).unwrap();
            assert_eq!(config.theme, None, "{text}");
        }
    }

    #[test]
    fn theme_is_written_only_when_pinned() {
        let mut path = std::env::temp_dir();
        path.push(format!("quickspot-save-theme-{}.json", std::process::id()));
        let config = Config {
            actions: vec![action("Vercel", "https://vercel.com")],
            groups: Vec::new(),
            language: None,
            magnify: true,
            show_icons: true,
            theme: Some("deep".into()),
        };
        save_to(&path, &config).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"theme\": \"deep\""));
        assert_eq!(load_from(&path), config);
        let _ = std::fs::remove_file(&path);

        let system = Config {
            theme: None,
            ..config
        };
        save_to(&path, &system).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("theme"));
        assert_eq!(load_from(&path), system);
        let _ = std::fs::remove_file(&path);
    }
}
