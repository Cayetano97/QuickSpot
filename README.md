<p align="center">
  <img src="src-tauri/icons/app-icon.png" alt="QuickSpot" width="160" />
</p>

<h1 align="center">QuickSpot</h1>

<p align="center">
  A Spotlight-style quick launcher for Windows, macOS, and Linux.
  <br />
  Press a global hotkey and a round overlay fades in with your actions orbiting a central hub.
  <br />
  <strong>Status: beta — under active development.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2.11-24C8D8?logo=tauri&logoColor=white" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/Rust-1.97-orange?logo=rust&logoColor=white" alt="Rust" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-888888" alt="Platforms" />
  <img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="License" />
</p>

---

QuickSpot lives quietly in your system tray. Hit the global hotkey and a
round, dark-gray overlay fades in at the center of the monitor under your
cursor — with matching actions orbiting a central hub. Type to filter,
use the arrow keys to move the selection, and press Enter to run.

## Hotkey

| Platform | Hotkey |
| --- | --- |
| Windows | `Alt + Space` |
| macOS | `Option + Space` |
| Linux | `Super + Space` (X11 best-effort) |

Inside the overlay:

| Key | Action |
| --- | --- |
| `Esc` | Close (does not quit) |
| `Enter` | Run the selected action and close |
| `Tab` / `Down` / `Up` | Move the selection (wraps around) |
| `Backspace` | Edit the query |
| `Cmd/Ctrl + R` | Reload the config |
| `Cmd/Ctrl + Q` | Quit |

## Features

- **Global hotkey** — open from anywhere: `Alt+Space`, `Option+Space`, `Super+Space`
- **Drag to move** — grab the top pill; it never gets lost off-screen
- **3 action kinds** — `url`, `command`, or `app`
- **Unlimited actions** — add as many as you want; shows the first 8 matches
- **Reorder** — Up/Down buttons in the panel; order also sets search ranking
- **Colored groups** — group actions and give each group a color
- **Live filtering** — type to filter instantly
- **Tray menu** — Show / Reload config / Quit

## Getting started

Prerequisites: [Node.js](https://nodejs.org) 20.19+ and the
[Rust](https://rustup.rs) stable toolchain with the platform Tauri
dependencies (Xcode CLT on macOS; webkit2gtk-4.1 + gtk3 on Linux).

```sh
npm install

# run the tests (frontend + backend)
npm test
cd src-tauri && cargo test && cd ..

# develop with hot reload (boots hidden in the tray)
npm run tauri dev
```

## Configuration

QuickSpot reads `quickspot.config.json` from the per-user config directory
(`~/Library/Application Support/dev.quickspot.app` on macOS,
`%APPDATA%\dev.quickspot.app` on Windows,
`$XDG_CONFIG_HOME/dev.quickspot.app` on Linux). On first run, a legacy
`quickspot.config.json` next to the binary is migrated automatically. If
the file is missing or malformed, it falls back to built-in defaults. There
is no limit on the number of actions; the overlay shows the first 8 matches
of the current query. Items missing `name`, `kind`, or `value` (or with an
unknown `kind`) are skipped.

```json
{
  "groups": [
    { "id": "work", "name": "Work", "color": "#5e9eff" }
  ],
  "actions": [
    { "name": "QuickSpot", "kind": "url", "value": "https://github.com/Cayetano97/QuickSpot" },
    { "name": "YouTube", "kind": "url", "value": "https://youtube.com" },
    { "name": "Slack", "kind": "url", "value": "https://slack.com", "group": "work" }
  ]
}
```

| Field | Description |
| --- | --- |
| `name` | Display label; matched case-insensitively by the filter |
| `kind` | `"url"`, `"command"`, or `"app"` |
| `value` | URL, shell command, or app path / bundle id |
| `browser` | Optional: custom browser executable for URLs. Set in the config file (not edited in the actions panel; a value there is preserved on save) |
| `hint` | Optional: reserved for future use |
| `group` | Optional: id of the group this action belongs to |
| `groups` | Optional, top-level: `{ id, name, color }` buckets. A group's `color` is a `#rrggbb` hex that accents its actions' chips (border, icon and fill). Unknown or malformed groups are skipped; an action referencing a missing group just renders uncolored. The actions panel manages groups and colors (curated palette plus a validated custom hex) |
| `language` | Optional, top-level: `"system"` (follow the OS language) or any BCP-47-ish code with a locale file — currently `"en"`, `"es"`. Unknown codes fall back to English |

## Project layout

```
QuickSpot/
  index.html                # overlay DOM
  src/                      # frontend (TypeScript + plain CSS)
    main.ts                 # UI wiring, IPC, animation render loop
    lib/                    # constants, easings, state machine, model
  src-tauri/                # Rust backend
    src/
      lib.rs                # app wiring: tray, hotkey, lifecycle
      overlay.rs            # window control, centering, drag clamp
      config.rs             # JSON config parsing
      actions.rs            # action execution
      apps.rs               # installed-app discovery (app picker)
      commands.rs           # IPC commands
  quickspot.config.json     # legacy/dev template; the app's config lives
                            # in the per-user config dir (see Configuration)
```

## Testing

- **Frontend** — `npm test` (Vitest): filter semantics, selection wrapping,
  Unicode backspace, the open/close state machine, locale parity (every
  language has the same keys, placeholders and translator credits as
  English), and the full overlay UI (rendering, live filtering, keyboard,
  settings panel, app picker) in jsdom with the Tauri IPC mocked.
- **Backend** — `cargo test` (in `src-tauri/`): config parsing fallbacks,
  per-platform execution plans, app discovery, and the drag-clamp /
  monitor-centering math.

Both suites run on GitHub Actions for every push and pull request (see
`.github/workflows/ci.yml`): the frontend on Linux, the backend on Linux,
macOS and Windows — so the platform-specific branches (macOS bundle-id
routing, the Windows `cmd /c` shell, Linux `.desktop` parsing) are
exercised on their real platforms.

## Translations

Each language is a single file in `src/lib/locales/` (`en.json`, `es.json`, …).
The app loads every file in that folder at startup, so adding a language is
just a PR with one new file — no code changes.

To add a language:

1. Copy `src/lib/locales/en.json` to `src/lib/locales/<code>.json` (e.g. `fr.json`).
2. Translate every value, leaving the `{var}` placeholders untouched.
3. Set the `_meta` block — the language's native name (shown in the settings
   selector) and your GitHub username(s) so the app can thank you in the
   settings panel:
   ```json
   { "_meta": { "label": "Français", "translators": ["your-username"] }, "placeholder": "Rechercher…" }
   ```
4. Run `npm test` — it checks that every locale has exactly the keys English
   has, that no placeholders were lost or added

## Updates

QuickSpot self-updates from GitHub Releases. When a new release is
published, a subtle blue pill appears at the bottom of the overlay
(`Update to v0.3.0`); clicking it downloads the new version, installs it
and relaunches into it.

## License

[MIT](LICENSE) — © 2026 [Cayetano97](https://github.com/Cayetano97).
