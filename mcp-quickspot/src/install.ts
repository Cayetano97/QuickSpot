/** Universal installer: registers the MCP server in every detected AI client.
 * Pure path/merge helpers are exported for tests; side effects live in
 * `install` / `status` / `uninstall`. Runs on macOS / Windows / Linux with
 * plain Node 20+ (no shell-specific scripts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
}

export interface InstallOptions {
  /** Absolute path of the server JS to register. Defaults to the stable copy. */
  serverPath?: string;
  clients?: ClientId[];
  dryRun?: boolean;
  /** Skip self-copy, register the running file directly. */
  noCopy?: boolean;
}

export interface InstallResult {
  serverPath: string;
  copied: boolean;
  clients: { id: ClientId; file: string | null; updated: boolean; note: string }[];
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

/** OpenCode file fallback (v2 shape). Global config lives at
 * ~/.config/opencode/opencode.json on every OS. */
export function opencodeConfigFile(p = currentOsPaths()): string {
  return join(p.home, ".config", "opencode", "opencode.json");
}

/** Codex file fallback: ~/.codex/config.toml (TOML, not JSON). */
export function codexConfigFile(p = currentOsPaths()): string {
  return join(p.home, ".codex", "config.toml");
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

/** Remove our entry from OpenCode's config; null when absent. */
export function removeOpenCode(existingText: string): string | null {
  const root = asRecord(JSON.parse(existingText));
  const servers = root && asRecord(asRecord(root.mcp)?.servers);
  if (!servers || !("quickspot" in servers)) return null;
  const next = { ...servers };
  delete next.quickspot;
  return JSON.stringify({ ...root, mcp: { ...(asRecord(root.mcp) ?? {}), servers: next } }, null, 2) + "\n";
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

/** Register via the client's own CLI (`<cmd> mcp add quickspot -- …`).
 * The CLI knows its current config format/version, so this is preferred over
 * hand-editing files. Returns a manual fallback command when the CLI is
 * missing so the user/agent knows the exact next step. */
export function ensureCliManaged(
  id: CliManagedId,
  entry: ServerEntry,
  dryRun: boolean,
): { updated: boolean; note: string } {
  const { cmd } = CLI_SPECS[id];
  const args = ["mcp", "add", "quickspot", "--", entry.command, ...entry.args];
  if (!commandAvailable(cmd)) {
    return {
      updated: false,
      note: `\`${cmd}\` CLI not found: run \`${cmd} ${args.join(" ")}\` once installed`,
    };
  }
  if (dryRun) return { updated: true, note: `dry-run: would run \`${cmd} mcp add\`` };
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return { updated: true, note: `registered via \`${cmd} mcp add quickspot\`` };
  } catch (e) {
    return { updated: false, note: `\`${cmd} mcp add\` failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function buildEntry(serverPath: string, nodeExe = process.execPath): ServerEntry {
  return { command: nodeExe, args: [serverPath] };
}

function alreadyRegisteredJson(existing: string | null, key: string, entry: ServerEntry): boolean {
  if (existing === null) return false;
  try {
    const cur = JSON.parse(existing) as Record<string, unknown>;
    const srv = (cur[key] as Record<string, unknown> | undefined)?.["quickspot"] as ServerEntry | undefined;
    return !!srv && srv.command === entry.command && JSON.stringify(srv.args) === JSON.stringify(entry.args);
  } catch {
    return false;
  }
}

function registerJsonFile(
  file: string,
  key: string,
  entry: ServerEntry,
  dryRun: boolean,
): { file: string; updated: boolean; note: string } {
  try {
    const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
    const current = alreadyRegisteredJson(existing, key, entry);
    if (!current) writeWithBackup(file, mergeConfig(existing, key, entry), dryRun);
    return {
      file,
      updated: !current,
      note: current ? "already registered" : dryRun ? "dry-run: would write" : "registered",
    };
  } catch (e) {
    return { file, updated: false, note: e instanceof Error ? e.message : String(e) };
  }
}

export function install(opts: InstallOptions = {}, runningFile = process.argv[1] ?? ""): InstallResult {
  const dryRun = !!opts.dryRun;
  const wanted = opts.clients ?? [...CLIENTS];
  let serverPath = opts.serverPath ?? stableServerPath();
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
    serverPath = opts.serverPath ?? runningFile;
  }

  const entry = buildEntry(serverPath);
  const clients: InstallResult["clients"] = [];
  for (const id of wanted) {
    if (isCliManaged(id)) {
      const r = ensureCliManaged(id, entry, dryRun);
      // CLI missing -> fall back to the client's config file automatically.
      if (!r.updated && r.note.includes("not found") && (id === "opencode" || id === "codex")) {
        const fb = registerFileFallback(id, serverPath, dryRun);
        clients.push({ id, ...fb, note: `${r.note}; file fallback: ${fb.note}` });
        continue;
      }
      clients.push({ id, file: null, updated: r.updated, note: r.note });
      continue;
    }
    clients.push({ id, ...registerJsonFile(clientConfigFile(id), configKeyFor(id), entry, dryRun) });
  }
  void localappdataUnused();
  return { serverPath, copied, clients };
}

/** File fallback for CLI-managed clients with a stable on-disk format.
 * Used automatically when their CLI is not on PATH. */
function registerFileFallback(
  id: "opencode" | "codex",
  serverPath: string,
  dryRun: boolean,
): { file: string; updated: boolean; note: string } {
  try {
    if (id === "opencode") {
      const file = opencodeConfigFile();
      const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
      const want = openCodeEntry(serverPath);
      let current = false;
      try {
        const cur = asRecord(asRecord(existing ? JSON.parse(existing) : {})?.mcp)?.servers;
        const srv = asRecord(cur)?.["quickspot"] as OpenCodeEntry | undefined;
        current = !!srv && JSON.stringify(srv.command) === JSON.stringify(want.command);
      } catch {
        current = false;
      }
      if (!current) writeWithBackup(file, mergeOpenCode(existing, want), dryRun);
      return { file, updated: !current, note: current ? "already registered (file)" : dryRun ? "dry-run: would write (file)" : "registered (file)" };
    }
    const file = codexConfigFile();
    const existing = existsSync(file) ? readFileSync(file, "utf8") : null;
    const want = codexSectionText(codexEntry(serverPath));
    const current = !!existing && existing.includes(want);
    if (!current) writeWithBackup(file, upsertCodexToml(existing, codexEntry(serverPath)), dryRun);
    return { file, updated: !current, note: current ? "already registered (file)" : dryRun ? "dry-run: would write (file)" : "registered (file)" };
  } catch (e) {
    const file = id === "opencode" ? opencodeConfigFile() : codexConfigFile();
    return { file, updated: false, note: e instanceof Error ? e.message : String(e) };
  }
}

function localappdataUnused(): void {
  // Keeps `currentOsPaths` honest about Windows paths without unused warnings.
  void currentOsPaths().localappdata;
}

export function status(serverPath = stableServerPath()): string {
  const lines: string[] = [`Server: ${serverPath} ${existsSync(serverPath) ? "(present)" : "(MISSING)"}`];
  for (const id of CLIENTS) {
    if (isCliManaged(id)) {
      const cmd = CLI_SPECS[id].cmd;
      const fallback = id === "claude-code" ? null : id === "opencode" ? opencodeConfigFile() : codexConfigFile();
      const fbState =
        fallback === null
          ? ""
          : existsSync(fallback)
            ? `; file fallback present (${fallback})`
            : `; file fallback absent`;
      lines.push(`- ${id}: CLI-managed (\`${cmd} mcp list\`)${fbState}`);
      continue;
    }
    const file = clientConfigFile(id);
    let state = "not configured";
    if (existsSync(file)) {
      try {
        const cur = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
        const srv = (cur[configKeyFor(id)] as Record<string, unknown> | undefined)?.["quickspot"];
        state = srv ? `registered (${file})` : `file exists, no entry (${file})`;
      } catch {
        state = `unreadable file (${file})`;
      }
    } else {
      state = `no file (${file})`;
    }
    lines.push(`- ${id}: ${state}`);
  }
  return lines.join("\n");
}

export function uninstall(opts: { clients?: ClientId[]; dryRun?: boolean; removeFiles?: boolean } = {}): string[] {
  const wanted = opts.clients ?? [...CLIENTS];
  const out: string[] = [];
  for (const id of wanted) {
    if (isCliManaged(id)) {
      const cmd = CLI_SPECS[id].cmd;
      if (id === "opencode") {
        // No documented `opencode mcp remove`; go straight to the file fallback.
        out.push(removeFileFallbackLine(id, !!opts.dryRun));
        continue;
      }
      if (commandAvailable(cmd) && !opts.dryRun) {
        try {
          execFileSync(cmd, ["mcp", "remove", "quickspot"], { stdio: "ignore" });
          out.push(`${id}: entry removed`);
        } catch (e) {
          out.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        out.push(`${id}: run \`${cmd} mcp remove quickspot\``);
      }
      if (id === "codex") out.push(removeFileFallbackLine(id, !!opts.dryRun));
      continue;
    }
    const file = clientConfigFile(id);
    if (!existsSync(file)) {
      out.push(`${id}: no file, nothing to do`);
      continue;
    }
    try {
      const next = removeFromConfig(readFileSync(file, "utf8"), configKeyFor(id));
      if (next === null) {
        out.push(`${id}: no quickspot entry`);
      } else {
        writeWithBackup(file, next, !!opts.dryRun);
        out.push(`${id}: entry removed`);
      }
    } catch (e) {
      out.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

function removeFileFallbackLine(id: "opencode" | "codex", dryRun: boolean): string {
  const file = id === "opencode" ? opencodeConfigFile() : codexConfigFile();
  if (!existsSync(file)) return `${id}: no fallback file, nothing to do`;
  try {
    const text = readFileSync(file, "utf8");
    const next = id === "opencode" ? removeOpenCode(text) : removeCodexToml(text);
    if (next === null) return `${id}: no quickspot entry in fallback file`;
    writeWithBackup(file, next, dryRun);
    return `${id}: fallback file entry removed`;
  } catch (e) {
    return `${id}: ${e instanceof Error ? e.message : String(e)}`;
  }
}
