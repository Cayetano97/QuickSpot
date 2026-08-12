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
}

#[derive(Debug, PartialEq, Eq)]
pub enum ConfigError {
    Parse,
    Malformed,
}

/// The parsed config: the action list, an optional language override
/// (`"system"` | `"en"` | `"es"`; `None` = follow the OS language), and the
/// dock hover magnification flag (defaults to on).
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct Config {
    pub actions: Vec<Action>,
    pub language: Option<String>,
    pub magnify: bool,
}

impl Config {
    pub fn with_defaults() -> Self {
        Config {
            actions: defaults(),
            language: None,
            magnify: true,
        }
    }
}

/// The accepted `language` values.
pub fn valid_language(value: &str) -> bool {
    matches!(value, "system" | "en" | "es")
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
        },
        Action {
            name: "YouTube".into(),
            kind: ActionKind::Url,
            value: "https://youtube.com".into(),
            browser: None,
            hint: None,
        },
        Action {
            name: "Google".into(),
            kind: ActionKind::Url,
            value: "https://google.com".into(),
            browser: None,
            hint: None,
        },
    ]
}

/// Parse config text. Errors (parse failure or no `actions` array) return
/// `Err`; the caller falls back to defaults. Items missing
/// `name`/`kind`/`value` or with an unknown `kind` are skipped.
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
        let (Some(name), Some(value)) = (
            obj.get("name").and_then(|v| v.as_str()),
            obj.get("value").and_then(|v| v.as_str()),
        ) else {
            continue;
        };
        if name.trim().is_empty() {
            continue;
        }
        let kind = match obj.get("kind").and_then(|v| v.as_str()) {
            Some("url") => ActionKind::Url,
            Some("command") => ActionKind::Command,
            Some("app") => ActionKind::App,
            _ => continue,
        };
        out.push(Action {
            name: name.to_string(),
            kind,
            value: value.to_string(),
            browser: obj.get("browser").and_then(|v| v.as_str()).map(str::to_string),
            hint: obj.get("hint").and_then(|v| v.as_str()).map(str::to_string),
        });
    }
    let language = match root.get("language").and_then(|v| v.as_str()) {
        Some(l) if valid_language(l) => Some(l.to_string()),
        _ => None,
    };
    let magnify = root.get("magnify").and_then(|v| v.as_bool()).unwrap_or(true);
    Ok(Config {
        actions: out,
        language,
        magnify,
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
/// dropped. `browser`/`hint` are kept as-is when present.
pub fn sanitize(actions: Vec<Action>) -> Vec<Action> {
    let mut out = Vec::with_capacity(actions.len());
    for mut a in actions {
        a.name = a.name.trim().to_string();
        a.value = a.value.trim().to_string();
        if a.name.is_empty() || a.value.is_empty() {
            continue;
        }
        out.push(a);
    }
    out
}

/// Write the config back to `path` as pretty JSON (camelCase, optional
/// fields omitted). `language: None` (system default) omits the field; so
/// does `magnify: true`, since on is the default.
pub fn save_to(path: &Path, config: &Config) -> Result<(), String> {
    let mut root = serde_json::json!({ "actions": sanitize(config.actions.clone()) });
    if let Some(lang) = &config.language {
        root["language"] = serde_json::Value::String(lang.clone());
    }
    if !config.magnify {
        root["magnify"] = serde_json::Value::Bool(false);
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
    }

    #[test]
    fn unknown_language_falls_back_to_system() {
        let config = parse_config(r#"{"language":"fr","actions":[]}"#).unwrap();
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
            language: None,
            magnify: false,
        };
        save_to(&path, &config).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"magnify\": false"));
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
            language: Some("es".into()),
            magnify: false,
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
            language: None,
            magnify: true,
        };
        save_to(&path, &config).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("language"));
        assert_eq!(load_from(&path), config);
        let _ = std::fs::remove_file(&path);
    }
}
