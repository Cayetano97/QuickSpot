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
    /// Id of the group this action belongs to, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
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
/// language override (`"system"` | `"en"` | `"es"`; `None` = follow the OS
/// language), the dock hover magnification flag (defaults to on), and
/// whether the action chips show their kind icons (defaults to on).
#[derive(Debug, PartialEq, Eq, Clone)]
pub struct Config {
    pub actions: Vec<Action>,
    pub groups: Vec<Group>,
    pub language: Option<String>,
    pub magnify: bool,
    pub show_icons: bool,
}

impl Config {
    pub fn with_defaults() -> Self {
        Config {
            actions: defaults(),
            groups: Vec::new(),
            language: None,
            magnify: true,
            show_icons: true,
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
            group: None,
        },
        Action {
            name: "YouTube".into(),
            kind: ActionKind::Url,
            value: "https://youtube.com".into(),
            browser: None,
            hint: None,
            group: None,
        },
        Action {
            name: "Google".into(),
            kind: ActionKind::Url,
            value: "https://google.com".into(),
            browser: None,
            hint: None,
            group: None,
        },
    ]
}

/// Parse config text. Errors (parse failure or no `actions` array) return
/// `Err`; the caller falls back to defaults. Items missing
/// `name`/`kind`/`value` or with an unknown `kind` are skipped; groups with
/// a missing/blank id, name, or an invalid color are skipped too.
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
            group: obj.get("group").and_then(|v| v.as_str()).map(str::to_string),
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
    Ok(Config {
        actions: out,
        groups,
        language,
        magnify,
        show_icons,
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
/// dropped. `browser`/`hint`/`group` are kept as-is when present.
pub fn sanitize(actions: Vec<Action>) -> Vec<Action> {
    let mut out = Vec::with_capacity(actions.len());
    for mut a in actions {
        a.name = a.name.trim().to_string();
        a.value = a.value.trim().to_string();
        if a.name.is_empty() || a.value.is_empty() {
            continue;
        }
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
/// empty group list is omitted too.
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
            groups: Vec::new(),
            language: None,
            magnify: false,
            show_icons: true,
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
                },
            ],
            groups: vec![group("work", "Work", "#5e9eff")],
            language: None,
            magnify: true,
            show_icons: true,
        };
        save_to(&path, &config).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"groups\""));
        assert!(text.contains("\"group\": \"work\""));
        assert_eq!(load_from(&path), config);
        let _ = std::fs::remove_file(&path);
    }
}
