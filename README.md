<p align="center">
  <img src="src-tauri/icons/app-icon.png" alt="QuickSpot" width="160" />
</p>

<h1 align="center">QuickSpot</h1>

<p align="center">
  A Spotlight-style quick launcher for Windows, macOS, and Linux.
  <br />
  Press a global hotkey and a round overlay fades in with your actions orbiting a central hub.
  <br />
  <strong>⚠️ Status: work in progress — under construction.</strong>
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

- **Global hotkey** registered through the OS (Alt+Space on Windows,
  Option+Space via Carbon `RegisterEventHotKey` on macOS, X11 on Linux) —
  works from any app.
- **Cursor-aware placement** — re-centers on the work area of the monitor
  under the cursor on every open.
- **Drag grip** — move the overlay anywhere with the pill at its top;
  it can never be lost off-screen, and the next open re-centers it.
- **Crisp, accessible motion** — a fast 220 ms open, 150 ms close, restrained
  stagger, focus feedback, and reduced-motion support without chip collisions.
- **Three action kinds** — `url` (system default or a custom browser),
  `command` (through the platform shell), `app` (binary path or macOS
  bundle id). The settings panel adapts the input field to the kind and,
  for `app`, can browse your installed applications.
- **Unlimited actions** — add as many actions as you like from Settings;
  the overlay shows the first 8 matches for the current query.
- **Grouped, colored actions** — create small groups of actions in Settings,
  give each group a color, and the group's chips pick up the color as an
  accent (border, icon and fill). A curated palette tuned for the dark disc
  plus a validated custom hex keep every color readable.
- **Live filtering** — case-insensitive substring, config order preserved.
- **English & Spanish UI** — follows the system language by default; override
  it from Settings (gear button), persisted in the config file.
- **Tray menu** — Show / Reload config / Quit. Reload picks up config
  edits without restarting.
- **Single instance** — a second launch just brings the overlay back.

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
| `browser` | Optional: custom browser executable for URLs |
| `hint` | Optional: reserved for future use; ignored in v1 |
| `group` | Optional: id of the group this action belongs to |
| `groups` | Optional, top-level: `{ id, name, color }` buckets. A group's `color` is a `#rrggbb` hex that accents its actions' chips (border, icon and fill). Unknown or malformed groups are skipped; an action referencing a missing group just renders uncolored. The settings panel manages groups and colors (curated palette plus a validated custom hex) |
| `language` | Optional, top-level: `"system"`, `"en"`, or `"es"`. Missing = OS language; if the OS language isn't Spanish, English is used |

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
  Unicode backspace, the open/close state machine, and the full overlay UI
  (rendering, live filtering, keyboard, settings panel, app picker) in
  jsdom with the Tauri IPC mocked.
- **Backend** — `cargo test` (in `src-tauri/`): config parsing fallbacks,
  per-platform execution plans, app discovery, and the drag-clamp /
  monitor-centering math.

Both suites run on GitHub Actions for every push and pull request (see
`.github/workflows/ci.yml`): the frontend on Linux, the backend on Linux,
macOS and Windows — so the platform-specific branches (macOS bundle-id
routing, the Windows `cmd /c` shell, Linux `.desktop` parsing) are
exercised on their real platforms.

## License

[MIT](LICENSE) — © 2026 [Cayetano97](https://github.com/Cayetano97).
