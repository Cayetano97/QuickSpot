# INSTALL — Install MCP

> Paste this to your AI along with the repo or the downloaded file:
> **"Install the QuickSpot MCP from `mcp-quickspot/INSTALL.md` for my system."**

## Case 1: from a Release (single file, no repo)

1. Download from the **Releases** tab: `quickspot.mcpb` (Claude Desktop only)
   or `quickspot-mcp.js` (every other client). Both need **Node.js 20+** on
   `PATH` (the `.mcpb` manifest launches `node`).
2. `.mcpb`: double-click it, or drag it onto Claude Desktop → Settings →
   Extensions → Install. Done.
3. `quickspot-mcp.js`: register it, then restart your AI client:
   ```sh
   node ~/Downloads/quickspot-mcp.js            # asks first, installs only on "y"
   node ~/Downloads/quickspot-mcp.js --yes      # agents / CI
   node ~/Downloads/quickspot-mcp.js --status   # verify
   ```
   The installer copies itself to a stable path (`~/.local/share/quickspot/mcp/`
   on macOS/Linux, `%LOCALAPPDATA%\QuickSpot\mcp\` on Windows) and registers
   every supported client it can. Nothing keeps living in `~/Downloads`.

## Case 2: from the repo (AI agent)

One command, identical on macOS, Windows and Linux (requires Node 20+; the
development test suite needs Node 22.12+ because of Vitest 5).
**It never installs without asking** — on a terminal it prompts `[y/N]`
(default: no); agents and CI pass `--yes`:

```sh
node mcp-quickspot/scripts/install.mjs             # asks first (human)
node mcp-quickspot/scripts/install.mjs --yes       # agent / CI (no prompt)
node mcp-quickspot/scripts/install.mjs --status
node mcp-quickspot/scripts/install.mjs --install --clients opencode,codex
node mcp-quickspot/scripts/install.mjs --install --clients cursor,vscode --dry-run
node mcp-quickspot/scripts/install.mjs --uninstall [--remove-files]
```

The script builds `dist/index.js` when missing or stale (on a fresh clone run
`npm ci` inside `mcp-quickspot/` first), then delegates to it.

## What `--install` does

1. Copies the server to the stable path above (never registers `~/Downloads`
   or the repo checkout). `--server PATH` instead registers an existing server
   file as-is; `--no-copy` registers the running file.
2. Registers `quickspot` in every supported client, merging — never deleting
   other servers, always with a `.bak` backup:

   | Client | Method |
   | --- | --- |
   | Claude Code | `claude mcp add --scope user quickspot -- …` |
   | OpenCode | `opencode mcp add --global quickspot -- …`, else `$XDG_CONFIG_HOME/opencode/opencode.json` (`mcp.servers`) |
   | Codex | `codex mcp add quickspot -- …`, else `$CODEX_HOME/config.toml` (`[mcp_servers.quickspot]`) |
   | Claude Desktop | `claude_desktop_config.json` (`~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows, `$XDG_CONFIG_HOME/Claude/` on Linux) |
   | Cursor | `~/.cursor/mcp.json` |
   | VS Code | native `~/.copilot/mcp-config.json` (`mcpServers`, `type: "stdio"`); the legacy user `mcp.json` (`servers`) is updated too when it already exists |
   | Windsurf | `~/.codeium/windsurf/mcp_config.json` |
   | Gemini CLI | `~/.gemini/settings.json` (user scope) |

3. It never needs the `quickspot.config.json` path: the server resolves it per
   OS itself (`QUICKSPOT_CONFIG` overrides it for tests). A legacy file in the
   current directory is copied to the per-user path (one-time migration), never
   edited in place.
4. The command exits non-zero if a requested client fails (broken JSON, failed
   CLI command). Optional clients whose CLI is simply absent are reported but do
   not fail the install.

## Verification

- `… --status` reports the real state for the file-based clients and checks
  `claude mcp get quickspot` when Claude Code is installed.
- `claude mcp list` / `opencode mcp list` / `codex mcp list` / `gemini mcp list`,
  or the green dot in Cursor → Settings → MCP.
- Functional test: asking *"list my QuickSpot actions"* must call `list-actions`.
- After creating/editing anything: tell the user to press `Cmd/Ctrl+R` in
  QuickSpot **before changing settings in the app**. The app does not watch the
  file, and it refuses a settings save when the file changed externally (so it
  cannot silently overwrite the MCP edit; it asks for a reload instead).

## Typical problems

- `ENOENT` in the client: the registered path moved, or Node was upgraded
  (Homebrew/nvm versioned paths) → re-run `--install`.
- Broken client JSON: the installer leaves that file **untouched**, reports the
  parse error and exits non-zero (fix the trailing comma or the duplicate key,
  retry).
- Refusal on a pipe (`exit 2`): re-run with `--yes`.
- A client reports `not found` for `claude`/`opencode`/`codex`: the CLI simply
  isn't installed; install it and re-run. OpenCode and Codex also get a file
  fallback automatically.
- `command` actions run a real shell (`sh -c` / `cmd /c`): the MCP only writes
  config, it never executes; the host asks approval on every mutation.
