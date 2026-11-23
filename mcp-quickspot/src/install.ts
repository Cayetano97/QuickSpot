/** Universal installer: registers the MCP server in every detected AI client.
 * Pure path/merge helpers are exported for tests; side effects live in
 * `install` / `status` / `uninstall`. Runs on macOS / Windows / Linux with
 * plain Node 20+ (no shell-specific scripts).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, platform } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";

export type ClientId =
  | "claude-desktop"
  | "claude-code"
  | "cursor"
  | "vscode"
  | "windsurf"
  | "opencode"
  | "gemini"
  | "codex";

export const CLIENTS: readonly ClientId[] = [
  "claude-desktop",
  "claude-code",
  "cursor",
  "vscode",
  "windsurf",
  "opencode",
  "gemini",
  "codex",
] as const;

/** Clients owned by their own CLI (`<cmd> mcp add/remove`) instead of a
 * hand-edited file. Their CLIs already know the right format/version. */
export type CliManagedId = "claude-code" | "opencode" | "codex";

const CLI_SPECS: Record<CliManagedId, { cmd: string }> = {
  "claude-code": { cmd: "claude" },
  opencode: { cmd: "opencode" },
  codex: { cmd: "codex" },
};

function isCliManaged(id: ClientId): id is CliManagedId {
  return id === "claude-code" || id === "opencode" || id === "codex";
}

export interface ServerEntry {
  command: string;
  args: string[];
  /** VS Code's `servers`/`mcpServers` formats require the transport type. */
  type?: "stdio";
}

export interface InstallOptions {
  /** Absolute path of the server JS to register. Defaults to the stable copy. */
  serverPath?: string;
  clients?: ClientId[];
  dryRun?: boolean;
  /** Skip self-copy, register the running file directly. */
  noCopy?: boolean;
  /** Node executable to register (defaults to a stable PATH resolution). */
  nodePath?: string;
}

export interface ClientResult {
  id: ClientId;
  file: string | null;
  updated: boolean;
  /** True for a real error (broken JSON, failed command), not for an
   * optional client whose CLI is simply absent. */
  failed: boolean;
  note: string;
}

export interface InstallResult {
  serverPath: string;
  copied: boolean;
  clients: ClientResult[];
}

/** Stable per-user home for the server copy (NOT Downloads, NOT a repo
 * checkout: both move or vanish and would break every client config). */
export function stableDir(home = homedir(), plat = platform()): string {
  if (plat === "win32") {
    const base = process.env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local");
    return join(base, "QuickSpot", "mcp");
  }
  if (process.env.XDG_DATA_HOME?.trim()) return join(process.env.XDG_DATA_HOME.trim(), "quickspot", "mcp");
  return join(home, ".local", "share", "quickspot", "mcp");
}

export function stableServerPath(home = homedir(), plat = platform()): string {
  return join(process.env.QUICKSPOT_MCP_DIR?.trim() || stableDir(home, plat), "index.js");
}

export interface OsPaths {
  home: string;
  plat: NodeJS.Platform;
  appdata: string;
  localappdata: string;
  xdgConfig: string;
}

export function currentOsPaths(): OsPaths {
  const home = homedir();
  return {
    home,
    plat: platform(),
    appdata: process.env.APPDATA?.trim() || join(home, "AppData", "Roaming"),
    localappdata: process.env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local"),
    xdgConfig: process.env.XDG_CONFIG_HOME?.trim() || join(home, ".config"),
  };
}

/** File-based client config locations. CLI-managed clients (claude-code,
 * opencode, codex) are registered via their own CLIs; opencode/codex also
 * have file fallbacks below for machines without the CLI on PATH. */
export function clientConfigFile(
  id: Exclude<ClientId, CliManagedId>,
  p = currentOsPaths(),
): string {
  const { home, plat, appdata, xdgConfig } = p;
  switch (id) {
    case "claude-desktop":
      if (plat === "darwin") return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      if (plat === "win32") return join(appdata, "Claude", "claude_desktop_config.json");
      return join(xdgConfig, "Claude", "claude_desktop_config.json");
    case "cursor":
      return join(home, ".cursor", "mcp.json");
    case "vscode":
      if (plat === "darwin") return join(home, "Library", "Application Support", "Code", "User", "mcp.json");
      if (plat === "win32") return join(appdata, "Code", "User", "mcp.json");
      return join(xdgConfig, "Code", "User", "mcp.json");
    case "windsurf":
      return join(home, ".codeium", "windsurf", "mcp_config.json");
    case "gemini":
      // Gemini CLI user scope: ~/.gemini/settings.json on every OS.
      return join(home, ".gemini", "settings.json");
  }
}

/** VS Code's native Copilot configuration (`mcpServers`, `type: "stdio"`).
 * This is the destination the current docs recommend; the editor-managed
 * user profile `mcp.json` is the deprecated Local-harness format. */
export function copilotConfigFile(p = currentOsPaths()): string {
  const base = process.env.COPILOT_HOME?.trim() || join(p.home, ".copilot");
  return join(base, "mcp-config.json");
}

/** OpenCode file fallback (v2 shape: `mcp.servers`). Global config lives at
 * `$XDG_CONFIG_HOME/opencode/opencode.json(c)` (default `~/.config/...`).
 * If only the JSONC file exists, target it rather than writing a shadow
 * JSON file that OpenCode may ignore; mergeOpenCode will report a clear
 * error if that file contains comments it cannot parse. */
export function opencodeConfigFile(p = currentOsPaths()): string {
  const base = p.xdgConfig?.trim() || join(p.home, ".config");
  const dir = join(base, "opencode");
  const json = join(dir, "opencode.json");
  const jsonc = join(dir, "opencode.jsonc");
  return !existsSync(json) && existsSync(jsonc) ? jsonc : json;
}

/** Codex file fallback: `$CODEX_HOME/config.toml` (default `~/.codex`). */
export function codexConfigFile(p = currentOsPaths()): string {
  const base = process.env.CODEX_HOME?.trim() || join(p.home, ".codex");
  return join(base, "config.toml");
}

/** VS Code's mcp.json uses `servers`; Gemini reuses the `mcpServers`
 * convention; every other JSON file uses `mcpServers`. */
export function configKeyFor(id: ClientId): "mcpServers" | "servers" {
  return id === "vscode" ? "servers" : "mcpServers";
}

/** Merge our entry into an existing client config text, preserving every
 * other server and every other top-level key. Throws on unparseable JSON
 * (never silently destroy a user's config). */
export function mergeConfig(existingText: string | null, key: string, entry: ServerEntry): string {
  let root: Record<string, unknown> = {};
  if (existingText !== null && existingText.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(existingText);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("root is not an object");
      }
      root = parsed as Record<string, unknown>;
    } catch (e) {
      throw new Error(`existing config is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const servers =
    root[key] && typeof root[key] === "object" && root[key] !== null && !Array.isArray(root[key])
      ? { ...(root[key] as Record<string, unknown>) }
      : {};
  servers["quickspot"] = entry;
  return JSON.stringify({ ...root, [key]: servers }, null, 2) + "\n";
}

/** Remove our entry; returns null when the file would be left without our
 * key change (caller skips the write). */
export function removeFromConfig(existingText: string, key: string): string | null {
  const root = JSON.parse(existingText) as Record<string, unknown>;
  const servers = root[key];
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return null;
  const rec = servers as Record<string, unknown>;
  if (!("quickspot" in rec)) return null;
  const next = { ...rec };
  delete next.quickspot;
  return JSON.stringify({ ...root, [key]: next }, null, 2) + "\n";
}

/** OpenCode entry (v2 shape: command is an array, servers live under
 * `mcp.servers`). See https://v2.opencode.ai/mcp-servers */
export interface OpenCodeEntry {
  type: "local";
  command: string[];
}

export function openCodeEntry(serverPath: string, nodeExe = process.execPath): OpenCodeEntry {
  return { type: "local", command: [nodeExe, serverPath] };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Merge our entry into OpenCode's global config using the v2 shape
 * (`mcp.servers.quickspot`). Existing v1-style entries directly under `mcp`
 * are preserved untouched. Throws on unparseable JSON. */
export function mergeOpenCode(existingText: string | null, entry: OpenCodeEntry): string {
  let root: Record<string, unknown> = {};
  if (existingText !== null && existingText.trim() !== "") {
    const parsed: unknown = JSON.parse(existingText);
    const rec = asRecord(parsed);
    if (!rec) throw new Error("existing config is not valid JSON: root is not an object");
    root = parsed as Record<string, unknown>;
  }
  const mcp = asRecord(root.mcp) ?? {};
  const servers = asRecord(mcp.servers) ?? {};
  return JSON.stringify({ ...root, mcp: { ...mcp, servers: { ...servers, quickspot: entry } } }, null, 2) + "\n";
}

/** Remove our entry from OpenCode's config; null when absent. Handles both
 * the v2 `mcp.servers.quickspot` shape and a legacy direct `mcp.quickspot`
 * entry left by older installs. */
export function removeOpenCode(existingText: string): string | null {
  const root = asRecord(JSON.parse(existingText));
  const mcp = root && asRecord(root.mcp);
  const servers = mcp && asRecord(mcp.servers);
  const hasV2 = !!servers && "quickspot" in servers;
  const hasV1 = !!mcp && "quickspot" in mcp;
  if (!root || (!hasV2 && !hasV1)) return null;
  const nextMcp: Record<string, unknown> = { ...mcp };
  if (hasV1) delete nextMcp.quickspot;
  if (hasV2) {
    const nextServers = { ...servers };
    delete nextServers.quickspot;
    nextMcp.servers = nextServers;
  }
  return JSON.stringify({ ...root, mcp: nextMcp }, null, 2) + "\n";
}

/** Codex entry for `~/.codex/config.toml` (`[mcp_servers.quickspot]`). */
export interface CodexEntry {
  command: string;
  args: string[];
}

export function codexEntry(serverPath: string, nodeExe = process.execPath): CodexEntry {
  return { command: nodeExe, args: [serverPath] };
}

/** TOML basic-string quoting (JSON escaping is a valid subset for paths). */
function tomlStr(s: string): string {
  return JSON.stringify(s);
}

const CODEX_SECTION = "[mcp_servers.quickspot]";

function codexSectionText(entry: CodexEntry): string {
  return `${CODEX_SECTION}\ncommand = ${tomlStr(entry.command)}\nargs = [${entry.args.map(tomlStr).join(", ")}]\n`;
}

/** Insert or replace our `[mcp_servers.quickspot]` table in Codex's
 * config.toml, preserving everything else byte-for-byte. */
export function upsertCodexToml(existingText: string | null, entry: CodexEntry): string {
  const section = codexSectionText(entry);
  if (!existingText || !existingText.trim()) {
    return `# managed by quickspot-mcp --install (backup in config.toml.bak)\n${section}`;
  }
  const lines = existingText.split("\n");
  const start = lines.findIndex((l) => /^\s*\[mcp_servers\.quickspot\]\s*$/.test(l));
  if (start < 0) {
    const sep = existingText.endsWith("\n") ? "" : "\n";
    return `${existingText}${sep}\n${section}`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[.*\]\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, start).join("\n");
  const after = lines.slice(end).join("\n");
  return `${before}${before.endsWith("\n") || before === "" ? "" : "\n"}${section}${after ? (after.startsWith("\n") ? after : "\n" + after) : ""}`;
}

/** Remove our table from Codex's config.toml; null when absent. */
export function removeCodexToml(existingText: string): string | null {
  const lines = existingText.split("\n");
  const start = lines.findIndex((l) => /^\s*\[mcp_servers\.quickspot\]\s*$/.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[.*\]\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

function writeWithBackup(file: string, text: string, dryRun: boolean): void {
  if (dryRun) return;
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) {
    try {
      copyFileSync(file, file + ".bak");
    } catch {
      // best-effort
    }
  }
  writeFileSync(file, text, "utf8");
}

function commandAvailable(cmd: string): boolean {
  const probe = platform() === "win32" ? "where" : "which";
  const r = spawnSync(probe, [cmd], { stdio: "ignore" });
  return r.status === 0;
}

/** Quote one argument for `cmd.exe /c` on Windows. Paths with spaces are the
 * common case; embedded double quotes are not expected in a Node path. */
function winQuote(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Run a client CLI. Windows CLI launchers are `.cmd` shims, which
 * `execFileSync` cannot execute directly, so go through `cmd.exe` there. */
function runCliCommand(cmd: string, args: string[], capture = false): { ok: boolean; stdout: string; error: string } {
  try {
    if (platform() === "win32") {
      const line = [cmd, ...args].map(winQuote).join(" ");
      const r = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", line], {
        encoding: "utf8",
        stdio: capture ? ["ignore", "pipe", "pipe"] : "ignore",
        timeout: 15000,
      });
      return {
        ok: r.status === 0,
        stdout: r.stdout ?? "",
        error: r.status === 0 ? "" : (r.stderr || r.error?.message || `exit ${r.status}`).trim(),
      };
    }
    const r = spawnSync(cmd, args, {
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "pipe"] : "ignore",
      timeout: 15000,
    });
    return {
      ok: r.status === 0,
      stdout: r.stdout ?? "",
      error: r.status === 0 ? "" : (r.stderr || r.error?.message || `exit ${r.status}`).trim(),
    };
  } catch (e) {
    return { ok: false, stdout: "", error: e instanceof Error ? e.message : String(e) };
  }
}

/** The add command differs per client: OpenCode defaults to *project* scope
 * and Claude Code to *local* scope, so both need an explicit user/global
 * flag for a machine-wide install. */
export function cliAddArgs(id: CliManagedId, entry: ServerEntry): string[] {
  const prefix =
    id === "opencode"
      ? ["mcp", "add", "--global", "quickspot", "--"]
      : id === "claude-code"
        ? ["mcp", "add", "--scope", "user", "quickspot", "--"]
        : ["mcp", "add", "quickspot", "--"];
  return [...prefix, entry.command, ...entry.args];
}

/** Register via the client's own CLI. Returns a manual fallback command when
 * the CLI is missing so the user/agent knows the exact next step. */
export function ensureCliManaged(
  id: CliManagedId,
  entry: ServerEntry,
  dryRun: boolean,
): { updated: boolean; failed: boolean; note: string } {
  const { cmd } = CLI_SPECS[id];
  const args = cliAddArgs(id, entry);
  if (!commandAvailable(cmd)) {
    return {
      updated: false,
      failed: false,
      note: `\`${cmd}\` CLI not found: run \`${cmd} ${args.join(" ")}\` once installed`,
    };
  }
  if (dryRun) {
    return { updated: true, failed: false, note: `dry-run: would run \`${cmd} ${args.slice(0, 3).join(" ")} ...\`` };
  }
  const r = runCliCommand(cmd, args);
  return r.ok
    ? { updated: true, failed: false, note: `registered via \`${cmd} ${args.slice(0, 4).join(" ")}\`` }
    : { updated: false, failed: true, note: `\`${cmd} mcp add\` failed: ${r.error}` };
}

/** Prefer the PATH-resolved `node` when it points at the same binary we are
 * running. On Homebrew that is a stable symlink (`/opt/homebrew/bin/node`)
 * instead of the versioned Cellar path, which disappears on `brew upgrade`.
 * If PATH resolves a different Node, keep the running executable so the
 * bundle is launched with the version that proved it works. */
export function resolveNodeExecutable(nodeExe = process.execPath): string {
  const override = process.env.QUICKSPOT_NODE?.trim();
  if (override) return override;
  const probe = platform() === "win32" ? "where" : "which";
  const r = spawnSync(probe, ["node"], { encoding: "utf8" });
  if (r.status === 0) {
    const candidate = (r.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (candidate) {
      try {
        if (realpathSync(candidate) === realpathSync(nodeExe)) return candidate;
      } catch {
        // Fall back to the running executable.
      }
    }
  }
  return nodeExe;
}

export function buildEntry(serverPath: string, nodeExe = resolveNodeExecutable()): ServerEntry {
  return { command: nodeExe, args: [serverPath] };
}

function alreadyRegisteredJson(existing: string | null, key: string, entry: ServerEntry): boolean {
  if (existing === null) return false;
  try {
    const cur = JSON.parse(existing) as Record<string, unknown>;
    const srv = (cur[key] as Record<string, unknown> | undefined)?.["quickspot"] as ServerEntry | undefined;
    return (
      !!srv &&
      srv.command === entry.command &&
      JSON.stringify(srv.args) === JSON.stringify(entry.args) &&
      (entry.type === undefined || srv.type === entry.type)
    );
  } catch {
    return false;
  }
}

function registerJsonFile(
  file: string,
  key: string,
  entry: ServerEntry,
  dryRun: boolean,
): { file: string; updated: boolean; failed: boolean; note: string } {
  try {
    const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
    const current = alreadyRegisteredJson(existing, key, entry);
    if (!current) writeWithBackup(file, mergeConfig(existing, key, entry), dryRun);
    return {
      file,
      updated: !current,
      failed: false,
      note: current ? "already registered" : dryRun ? "dry-run: would write" : "registered",
    };
  } catch (e) {
    return {
      file,
      updated: false,
      failed: true,
      note: e instanceof Error ? e.message : String(e),
    };
  }
}

export function install(opts: InstallOptions = {}, runningFile = process.argv[1] ?? ""): InstallResult {
  const dryRun = !!opts.dryRun;
  const wanted = [...new Set(opts.clients ?? [...CLIENTS])];
  let serverPath = opts.serverPath ? resolve(opts.serverPath) : stableServerPath();
  let copied = false;

  if (!opts.noCopy && runningFile && runningFile !== serverPath) {
    if (!dryRun) {
      mkdirSync(dirname(serverPath), { recursive: true });
      copyFileSync(runningFile, serverPath);
      if (platform() !== "win32") {
        try {
          execFileSync("chmod", ["+x", serverPath], { stdio: "ignore" });
        } catch {
          // non-fatal
        }
      }
    }
    copied = true;
  } else if (opts.noCopy && runningFile) {
    serverPath = resolve(opts.serverPath ?? runningFile);
  }

  const entry = buildEntry(serverPath, opts.nodePath);
  const clients: ClientResult[] = [];
  for (const id of wanted) {
    if (id === "vscode") {
      clients.push(registerVsCode(entry, dryRun));
      continue;
    }
    if (isCliManaged(id)) {
      const r = ensureCliManaged(id, entry, dryRun);
      // Any CLI failure (missing shim, wrong scope, permissions) falls back
      // to the file format for the two clients that have a stable one.
      if (!r.updated && (id === "opencode" || id === "codex")) {
        const fb = registerFileFallback(id, entry, dryRun);
        clients.push({
          id,
          file: fb.file,
          updated: fb.updated,
          failed: fb.failed,
          note: `${r.note}; file fallback: ${fb.note}`,
        });
        continue;
      }
      clients.push({ id, file: null, updated: r.updated, failed: r.failed, note: r.note });
      continue;
    }
    clients.push({ id, ...registerJsonFile(clientConfigFile(id), configKeyFor(id), entry, dryRun) });
  }
  return { serverPath, copied, clients };
}

/** VS Code needs two destinations today: the native Copilot file the current
 * docs recommend (`mcpServers`, `type: "stdio"`) and, when the user already
 * has one, the deprecated editor-managed user `mcp.json` (`servers`). Both
 * entries need the transport type or VS Code refuses the stdio server. */
function registerVsCode(entry: ServerEntry, dryRun: boolean): ClientResult {
  const typed: ServerEntry = { ...entry, type: "stdio" };
  const native = registerJsonFile(copilotConfigFile(), "mcpServers", typed, dryRun);
  const legacyFile = clientConfigFile("vscode");
  if (!existsSync(legacyFile)) {
    return { id: "vscode", ...native };
  }
  const legacy = registerJsonFile(legacyFile, "servers", typed, dryRun);
  return {
    id: "vscode",
    file: native.file,
    updated: native.updated || legacy.updated,
    failed: native.failed || legacy.failed,
    note: `${native.note}; legacy ${legacy.note}`,
  };
}

/** File fallback for CLI-managed clients with a stable on-disk format.
 * Used automatically when their CLI is not on PATH. */
function registerFileFallback(
  id: "opencode" | "codex",
  entry: ServerEntry,
  dryRun: boolean,
): { file: string; updated: boolean; failed: boolean; note: string } {
  const serverPath = entry.args[0] ?? "";
  try {
    if (id === "opencode") {
      const file = opencodeConfigFile();
      const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
      const want = openCodeEntry(serverPath, entry.command);
      let current = false;
      try {
        const mcp = asRecord(asRecord(existing ? JSON.parse(existing) : {})?.mcp);
        const v2 = asRecord(mcp?.servers)?.["quickspot"] as OpenCodeEntry | undefined;
        const v1 = mcp?.["quickspot"] as OpenCodeEntry | undefined;
        const same = (srv: OpenCodeEntry | undefined): boolean =>
          !!srv && JSON.stringify(srv.command) === JSON.stringify(want.command);
        current = same(v2) || same(v1);
      } catch {
        current = false;
      }
      if (!current) writeWithBackup(file, mergeOpenCode(existing, want), dryRun);
      return {
        file,
        updated: !current,
        failed: false,
        note: current ? "already registered (file)" : dryRun ? "dry-run: would write (file)" : "registered (file)",
      };
    }
    const file = codexConfigFile();
    const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
    const want = codexSectionText(codexEntry(serverPath, entry.command));
    const current = !!existing && existing.includes(want);
    if (!current) writeWithBackup(file, upsertCodexToml(existing, codexEntry(serverPath, entry.command)), dryRun);
    return {
      file,
      updated: !current,
      failed: false,
      note: current ? "already registered (file)" : dryRun ? "dry-run: would write (file)" : "registered (file)",
    };
  } catch (e) {
    const file = id === "opencode" ? opencodeConfigFile() : codexConfigFile();
    return { file, updated: false, failed: true, note: e instanceof Error ? e.message : String(e) };
  }
}

/** Read `file` and report whether `key.quickspot` exists. */
function jsonEntryState(file: string, key: string): { exists: boolean; registered: boolean; error: string | null } {
  if (!existsSync(file)) return { exists: false, registered: false, error: null };
  try {
    const root = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const servers = asRecord(root[key]);
    return { exists: true, registered: !!(servers && servers["quickspot"]), error: null };
  } catch (e) {
    return { exists: true, registered: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function opencodeState(): string {
  const file = opencodeConfigFile();
  if (!existsSync(file)) return `no file (${file})`;
  try {
    const root = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const mcp = asRecord(root.mcp);
    const entry = asRecord(mcp?.servers)?.["quickspot"] ?? mcp?.["quickspot"];
    return entry ? `registered (${file})` : `file exists, no entry (${file})`;
  } catch {
    return `unreadable file (${file})`;
  }
}

function codexState(): string {
  const file = codexConfigFile();
  if (!existsSync(file)) return `no file (${file})`;
  try {
    const text = readFileSync(file, "utf8");
    return /^\s*\[mcp_servers\.quickspot\]\s*$/m.test(text)
      ? `registered (${file})`
      : `file exists, no entry (${file})`;
  } catch {
    return `unreadable file (${file})`;
  }
}

function claudeCodeState(): string {
  if (!commandAvailable("claude")) return "CLI not found (`claude mcp list`)";
  const r = runCliCommand("claude", ["mcp", "get", "quickspot"], true);
  return r.ok
    ? "registered (`claude mcp get quickspot`)"
    : `not registered or CLI error (${r.error || "not found"})`;
}

function vscodeState(): string {
  const native = jsonEntryState(copilotConfigFile(), "mcpServers");
  const legacy = jsonEntryState(clientConfigFile("vscode"), "servers");
  const parts: string[] = [];
  if (native.registered) parts.push(`registered (${copilotConfigFile()})`);
  else if (native.error) parts.push(`unreadable native file (${native.error})`);
  else parts.push(`no native entry (${copilotConfigFile()})`);
  if (legacy.exists) {
    if (legacy.registered) parts.push(`legacy registered (${clientConfigFile("vscode")})`);
    else if (legacy.error) parts.push(`unreadable legacy file (${legacy.error})`);
    else parts.push(`legacy file without entry (${clientConfigFile("vscode")})`);
  }
  return parts.join("; ");
}

export function status(serverPath = stableServerPath()): string {
  const lines: string[] = [`Server: ${serverPath} ${existsSync(serverPath) ? "(present)" : "(MISSING)"}`];
  for (const id of CLIENTS) {
    let state: string;
    if (id === "vscode") state = vscodeState();
    else if (id === "claude-code") state = claudeCodeState();
    else if (id === "opencode") state = opencodeState();
    else if (id === "codex") state = codexState();
    else {
      const file = clientConfigFile(id);
      const r = jsonEntryState(file, configKeyFor(id));
      state = !r.exists
        ? `no file (${file})`
        : r.registered
          ? `registered (${file})`
          : r.error
            ? `unreadable file (${file})`
            : `file exists, no entry (${file})`;
    }
    lines.push(`- ${id}: ${state}`);
  }
  return lines.join("\n");
}

export interface UninstallResult {
  lines: string[];
  failed: boolean;
}

export function uninstall(opts: { clients?: ClientId[]; dryRun?: boolean; removeFiles?: boolean } = {}): UninstallResult {
  const wanted = [...new Set(opts.clients ?? [...CLIENTS])];
  const dryRun = !!opts.dryRun;
  const out: string[] = [];
  let failed = false;

  const removeJson = (id: ClientId, file: string, key: string): void => {
    if (!existsSync(file)) {
      out.push(`${id}: no file, nothing to do (${file})`);
      return;
    }
    try {
      const next = removeFromConfig(readFileSync(file, "utf8"), key);
      if (next === null) {
        out.push(`${id}: no quickspot entry (${file})`);
      } else {
        writeWithBackup(file, next, dryRun);
        out.push(`${id}: entry removed (${file})`);
      }
    } catch (e) {
      failed = true;
      out.push(`${id}: FAILED ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const removeFallback = (id: "opencode" | "codex"): void => {
    const file = id === "opencode" ? opencodeConfigFile() : codexConfigFile();
    if (!existsSync(file)) {
      out.push(`${id}: no file, nothing to do (${file})`);
      return;
    }
    try {
      const text = readFileSync(file, "utf8");
      const next = id === "opencode" ? removeOpenCode(text) : removeCodexToml(text);
      if (next === null) {
        out.push(`${id}: no quickspot entry (${file})`);
      } else {
        writeWithBackup(file, next, dryRun);
        out.push(`${id}: entry removed (${file})`);
      }
    } catch (e) {
      failed = true;
      out.push(`${id}: FAILED ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  for (const id of wanted) {
    if (id === "vscode") {
      removeJson("vscode", copilotConfigFile(), "mcpServers");
      if (existsSync(clientConfigFile("vscode"))) removeJson("vscode", clientConfigFile("vscode"), "servers");
      continue;
    }
    if (id === "opencode") {
      // OpenCode v2 has no `mcp remove`; edit the global file.
      removeFallback("opencode");
      continue;
    }
    if (id === "codex") {
      if (commandAvailable("codex") && !dryRun) {
        const r = runCliCommand("codex", ["mcp", "remove", "quickspot"]);
        if (r.ok) out.push("codex: entry removed (CLI)");
        // A non-zero exit often just means the entry lived in config.toml;
        // the fallback below is the source of truth, so don't fail here.
        else out.push(`codex: CLI reported: ${r.error}`);
      } else if (dryRun) {
        out.push("codex: dry-run: would run `codex mcp remove quickspot`");
      } else {
        out.push("codex: `codex mcp remove quickspot` (CLI not found)");
      }
      removeFallback("codex");
      continue;
    }
    if (id === "claude-code") {
      if (!commandAvailable("claude")) {
        out.push("claude-code: `claude mcp remove quickspot --scope user` (CLI not found)");
      } else if (dryRun) {
        out.push("claude-code: dry-run: would run `claude mcp remove quickspot --scope user`");
      } else {
        const r = runCliCommand("claude", ["mcp", "remove", "--scope", "user", "quickspot"]);
        if (r.ok) out.push("claude-code: entry removed (CLI, user scope)");
        else {
          failed = true;
          out.push(`claude-code: CLI remove failed: ${r.error}`);
        }
      }
      continue;
    }
    removeJson(id, clientConfigFile(id), configKeyFor(id));
  }

  if (opts.removeFiles) {
    const serverPath = stableServerPath();
    if (!existsSync(serverPath)) {
      out.push(`server: no file, nothing to do (${serverPath})`);
    } else if (dryRun) {
      out.push(`server: dry-run: would remove ${serverPath}`);
    } else {
      try {
        unlinkSync(serverPath);
        out.push(`server: removed (${serverPath})`);
      } catch (e) {
        failed = true;
        out.push(`server: FAILED to remove ${serverPath}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return { lines: out, failed };
}
