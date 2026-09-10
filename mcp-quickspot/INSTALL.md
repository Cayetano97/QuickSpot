# INSTALL — Install MCP

> Paste this to your AI along with the repo or the downloaded file:
> **"Install the QuickSpot MCP from `mcp-quickspot/INSTALL.md` for my system."**

## Case 1: from a Release (single file, no repo)

1. Download from the **Releases** tab: `quickspot.mcpb` (Claude Desktop only)
   or `quickspot-mcp.js` (every other client).
2. `.mcpb`: double-click it, or drag it onto Claude Desktop → Settings →
   Extensions → Install. Done.
3. `quickspot-mcp.js`: register it, then restart your AI client:
   ```sh
   node ~/Downloads/quickspot-mcp.js            # asks first, installs only on "y"
   node ~/Downloads/quickspot-mcp.js --status   # verify
   ```
   The installer copies itself to a stable path (`~/.local/share/quickspot/mcp/`
   on macOS/Linux, `%LOCALAPPDATA%\QuickSpot\mcp\` on Windows) and registers
   every client it finds. Nothing keeps living in `~/Downloads`.

## Case 2: from the repo (AI agent)

One command, identical on macOS, Windows and Linux (requires Node 20+).
**It never installs without asking** — on a terminal it prompts `[y/N]`
(default: no); agents and CI pass `--yes`:

```sh
node mcp-quickspot/scripts/install.mjs             # asks first (human)
node mcp-quickspot/scripts/install.mjs --yes       # agent / CI (no prompt)
node mcp-quickspot/scripts/install.mjs --status
node mcp-quickspot/scripts/install.mjs --install --clients opencode,codex
node mcp-quickspot/scripts/install.mjs --install --clients cursor,vscode --dry-run
node mcp-quickspot/scripts/install.mjs --uninstall
```

The script builds `dist/index.js` when missing or stale (on a fresh clone run
`npm ci` inside `mcp-quickspot/` first), then delegates to it.

## What `--install` does

1. Copies the server to the stable path above (never registers `~/Downloads`
   or the repo checkout).
2. Registers `quickspot` in every detected client, merging — never deleting
   other servers, always with a `.bak` backup:

   | Client | Method |
   | --- | --- |
   | Claude Code | `claude mcp add quickspot -- …` |
   | OpenCode | `opencode mcp add quickspot -- …`, else `~/.config/opencode/opencode.json` (`mcp.servers`) |
   | Codex | `codex mcp add quickspot -- …`, else `~/.codex/config.toml` (`[mcp_servers.quickspot]`) |
   | Claude Desktop | `claude_desktop_config.json` (`~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows, `~/.config/Claude/` on Linux) |
   | Cursor | `~/.cursor/mcp.json` |
   | VS Code | user `mcp.json` (note: `servers` key, not `mcpServers`) |
   | Windsurf | `~/.codeium/windsurf/mcp_config.json` |
   | Gemini CLI | `~/.gemini/settings.json` (user scope) |

3. It never needs the `quickspot.config.json` path: the server resolves it per
   OS itself (`QUICKSPOT_CONFIG` overrides it for tests).

## Verification

- `… --status` with each client `registered`.
- `claude mcp list` / `opencode mcp list` / `codex mcp list` / `gemini mcp list`,
  or the green dot in Cursor → Settings → MCP.
- Functional test: asking *"list my QuickSpot actions"* must call `list-actions`.
- After creating/editing anything: tell the user to press `Cmd/Ctrl+R` in
  QuickSpot (the app does not watch the file).

## Typical problems

- `ENOENT` in the client: the registered path moved → re-run `--install`.
- Broken client JSON: the installer aborts **without touching it** (fix the
  trailing comma, retry).
- Refusal on a pipe (`exit 2`): re-run with `--yes`.
- macOS Gatekeeper (unsigned Release binary): `xattr -d com.apple.quarantine <file>`,
  or use the `.mcpb`.
- `command` actions run a real shell (`sh -c` / `cmd /c`): the MCP only writes
  config, it never executes; the host asks approval on every mutation.
