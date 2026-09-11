# quickspot-mcp

MCP (Model Context Protocol) server to manage QuickSpot actions from any AI agent: OpenCode, Claude Code, Claude Desktop, Cursor, VS Code Copilot, Windsurf, Gemini CLI or Codex CLI.

It only edits `quickspot.config.json` with the **same validation rules as the Rust backend** (`src-tauri/src/config.rs`). It never executes actions. Local, no accounts, no network.

## Tools

| Tool | What it does |
| --- | --- |
| `list-actions` | List actions (index, name, type, value, group) |
| `get-config` | Dump the full config + resolved path |
| `create-action` | Create an action (`url`, `command`, `app`, `file`, `folder`, `sequence` of up to 5 steps) |
| `update-action` | Update by index or name (`null` clears `browser`/`hint`/`group`/`steps`) |
| `delete-action` | Delete by index or name |
| `move-action` | Reorder (order defines search ranking) |
| `list-groups` / `create-group` / `delete-group` | Manage `#rrggbb` color groups |
| `validate-config` | Validate without modifying (counts entries ignored by the backend) |

Read-only resource: `quickspot://config`.

> After every change, press `Cmd/Ctrl+R` in QuickSpot (or tray → Reload config). The app does not watch the file.

## Installation

**Option A — from a Release (recommended, no cloning):** download `quickspot.mcpb` (Claude Desktop: double-click or Settings → Extensions → Install) or `dist/index.js` and register it:

```sh
node /downloaded/path/quickspot-mcp.js            # asks before installing (opt-in)
node /downloaded/path/quickspot-mcp.js --yes      # agents/CI: no prompt
node /downloaded/path/quickspot-mcp.js --status   # verify
```

**Option B — from this repo (or for an AI to install it):** see [`INSTALL.md`](INSTALL.md) — one command, same on macOS, Windows and Linux.

## Development

```sh
npm ci && npm test && npm run build          # tests + self-contained bundle dist/index.js
QUICKSPOT_CONFIG=/tmp/qs.json node scripts/e2e-check.mjs   # stdio protocol smoke test
npm run pack-mcpb                             # build quickspot.mcpb for Claude Desktop
```
