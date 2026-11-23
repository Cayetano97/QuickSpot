#!/usr/bin/env node
/** quickspot-mcp: MCP server (stdio) to manage QuickSpot actions.
 *
 * Normal mode (no args): serves tools over stdio for any MCP host.
 * Install mode: `node dist/index.js --install|--status|--uninstall`.
 *
 * The server only edits `quickspot.config.json` with the exact validation
 * semantics of the Rust backend (`src-tauri/src/config.rs`). It never
 * executes actions. After every mutation the user must press Cmd/Ctrl+R in
 * QuickSpot (or Tray -> Reload config): the app does not watch the file.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createInterface } from "node:readline/promises";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";
import {
  findActionIndex,
  loadConfig,
  resolveConfigPath,
  sanitize,
  sanitizeGroups,
  saveTo,
  validateConfigText,
} from "./config.js";
import { CLIENTS, install, status, uninstall, type ClientId } from "./install.js";
import {
  CreateActionSchema,
  CreateGroupSchema,
  DeleteActionSchema,
  DeleteGroupSchema,
  MoveActionSchema,
  UpdateActionSchema,
} from "./schema.js";
import type { Action } from "./types.js";

export const SERVER_NAME = "quickspot";
export const SERVER_VERSION = "0.1.0";

const RELOAD_HINT =
  "Press Cmd/Ctrl+R in QuickSpot (or tray -> Reload config) to see the changes. Reload before changing settings in the app: QuickSpot refuses a settings save while the file has external edits.";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/** Mutations rebuild a corrupt config from defaults (with a .bak backup, like
 * the app); say so instead of silently replacing the user's file. */
function configWarning(valid: boolean, error: string | null): string {
  return valid
    ? ""
    : `WARNING: the existing config could not be parsed (${error ?? "unknown error"}); the previous file is in the .bak backup and the config was rebuilt from the built-in defaults.\n`;
}

function summarizeActions(actions: Action[]): string {
  if (actions.length === 0) return "(no actions)";
  return actions
    .map((a, i) => {
      const extra =
        a.kind === "sequence"
          ? ` [${(a.steps ?? []).map((s) => s.kind).join("+")}]`
          : a.value.length > 60
            ? ` -> ${a.value.slice(0, 60)}…`
            : ` -> ${a.value}`;
      const group = a.group ? ` {${a.group}}` : "";
      return `${i}. ${a.name} (${a.kind})${group}${extra}`;
    })
    .join("\n");
}

function slugify(s: string, fallback = "group"): string {
  const slug = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "QuickSpot reads quickspot.config.json when the user presses Cmd/Ctrl+R. After every mutation, tell the user to reload before changing settings in the app (the app refuses a settings save while the file has external edits). This server only writes config; it never executes actions.",
    },
  );

  server.registerTool(
    "list-actions",
    {
      description: "List QuickSpot actions (index, name, type, value, group). Read-only.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { config, path, valid, error } = loadConfig();
      const warning = valid
        ? ""
        : `WARNING: ${path} could not be parsed (${error}); showing the built-in defaults. Run validate-config for details.\n`;
      return textResult(
        `Config: ${path}\n${warning}${config.actions.length} actions:\n${summarizeActions(config.actions)}`,
      );
    },
  );

  server.registerTool(
    "get-config",
    {
      description:
        "Return the parsed quickspot.config.json (actions, groups, language, chip layout, theme, circle size), the resolved path and whether the file is valid. Set raw=true to return the exact file text instead (useful to inspect entries the parser skips). Read-only.",
      inputSchema: z.object({
        raw: z.boolean().optional().describe("Return the exact file text instead of the parsed model"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ raw }) => {
      const { config, path, existed, valid, error } = loadConfig();
      if (raw) {
        let text: string | null = null;
        if (existed) {
          try {
            text = readFileSync(path, "utf8");
          } catch (e) {
            return textResult(`Path: ${path}\nExists: true\nINVALID: cannot read file (${e instanceof Error ? e.message : String(e)}).`);
          }
        }
        return textResult(
          `Path: ${path}\nExists: ${existed}\nValid: ${valid}${error ? ` (${error})` : ""}\n` +
            (text === null ? "(missing: QuickSpot uses the built-in default values)" : text),
        );
      }
      const state = existed
        ? valid
          ? "exists"
          : `exists but is invalid (${error})`
        : "missing: showing default values";
      return textResult(`Path: ${path} (${state})\n${JSON.stringify(config, null, 2)}`);
    },
  );

  server.registerTool(
    "create-action",
    {
      description:
        "Create a QuickSpot action (url, command, app, file, folder or sequence of up to 5 steps). Validates like the backend; the name must be unique.",
      inputSchema: CreateActionSchema,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      const { config, path, valid, error } = loadConfig();
      if (config.actions.some((a) => a.name.trim().toLowerCase() === input.name.trim().toLowerCase())) {
        throw new Error(`an action named "${input.name}" already exists. Use update-action to modify it.`);
      }
      if (input.group && !config.groups.some((g) => g.id === input.group)) {
        throw new Error(`unknown group "${input.group}". List groups with list-groups first.`);
      }
      const action: Action = {
        name: input.name.trim(),
        kind: input.kind,
        value: input.kind === "sequence" ? "" : input.value.trim(),
      };
      if (input.kind === "url" && input.browser?.trim()) action.browser = input.browser.trim();
      if (input.hint?.trim()) action.hint = input.hint;
      if (input.group) action.group = input.group;
      if (input.kind === "sequence") {
        action.steps = (input.steps ?? []).map((s) => ({
          kind: s.kind,
          value: s.value.trim(),
          ...(s.kind === "url" && s.browser?.trim() ? { browser: s.browser.trim() } : {}),
        }));
      }
      const cleaned = sanitize([...config.actions, action]);
      if (cleaned.length !== config.actions.length + 1) {
        throw new Error("the action failed backend validation (invalid name/value/steps).");
      }
      config.actions = cleaned;
      saveTo(path, config);
      return textResult(`${configWarning(valid, error)}Action "${action.name}" created (${action.kind}). ${RELOAD_HINT}`);
    },
  );

  server.registerTool(
    "update-action",
    {
      description: "Update an existing action (by index or exact name). Only the given fields change. null clears browser/hint/group/steps.",
      inputSchema: UpdateActionSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const { config, path, valid, error } = loadConfig();
      const idx = findActionIndex(config.actions, input.ref as number | string);
      if (idx < 0) throw new Error(`action not found: ${String(input.ref)}. Use list-actions to see indices/names.`);
      const prev = config.actions[idx];
      const next: Action = { ...prev };
      if (input.name !== undefined) next.name = input.name.trim();
      if (input.kind !== undefined) next.kind = input.kind;
      if (input.value !== undefined) next.value = input.value;
      if (input.browser !== undefined) {
        if (input.browser === null) delete next.browser;
        else next.browser = input.browser;
      }
      if (input.hint !== undefined) {
        if (input.hint === null) delete next.hint;
        else next.hint = input.hint;
      }
      if (input.group !== undefined) {
        if (input.group === null) delete next.group;
        else {
          if (!config.groups.some((g) => g.id === input.group)) {
            throw new Error(`unknown group "${input.group}". List groups with list-groups first.`);
          }
          next.group = input.group;
        }
      }
      if (input.steps !== undefined) {
        if (input.steps === null) delete next.steps;
        else next.steps = input.steps.map((s) => ({ kind: s.kind, value: s.value, browser: s.browser ?? null }));
      }
      if (next.kind === "sequence" && !next.steps?.length) {
        throw new Error("a sequence needs steps (1-5 leaf steps).");
      }
      const clash = config.actions.findIndex(
        (a, i) => i !== idx && a.name.trim().toLowerCase() === next.name.trim().toLowerCase(),
      );
      if (clash >= 0) throw new Error(`that name is already used by action ${clash} ("${config.actions[clash].name}").`);
      const trial = [...config.actions];
      trial[idx] = next;
      const cleaned = sanitize(trial);
      if (cleaned.length !== trial.length) {
        throw new Error("the result failed backend validation (invalid name/value/steps).");
      }
      config.actions = cleaned;
      saveTo(path, config);
      return textResult(`${configWarning(valid, error)}Action "${prev.name}" updated. ${RELOAD_HINT}`);
    },
  );

  server.registerTool(
    "delete-action",
    {
      description: "Delete a QuickSpot action (by index or exact name).",
      inputSchema: DeleteActionSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const { config, path, valid, error } = loadConfig();
      const idx = findActionIndex(config.actions, input.ref as number | string);
      if (idx < 0) throw new Error(`action not found: ${String(input.ref)}.`);
      const [removed] = config.actions.splice(idx, 1);
      saveTo(path, config);
      return textResult(`${configWarning(valid, error)}Action "${removed.name}" deleted. ${RELOAD_HINT}`);
    },
  );

  server.registerTool(
    "move-action",
    {
      description: "Reorder an action (order also defines search ranking).",
      inputSchema: MoveActionSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const { config, path, valid, error } = loadConfig();
      const idx = findActionIndex(config.actions, input.ref as number | string);
      if (idx < 0) throw new Error(`action not found: ${String(input.ref)}.`);
      const [item] = config.actions.splice(idx, 1);
      const to = Math.max(0, Math.min(input.to, config.actions.length));
      config.actions.splice(to, 0, item);
      saveTo(path, config);
      return textResult(`${configWarning(valid, error)}"${item.name}" moved to position ${to}. ${RELOAD_HINT}`);
    },
  );

  server.registerTool(
    "list-groups",
    {
      description: "List action groups (id, name, color). Read-only.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { config } = loadConfig();
      if (config.groups.length === 0) return textResult("(no groups)");
      return textResult(config.groups.map((g) => `${g.id}: ${g.name} (${g.color})`).join("\n"));
    },
  );

  server.registerTool(
    "create-group",
    {
      description: "Create a color group (#rrggbb) to organize actions.",
      inputSchema: CreateGroupSchema,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      const { config, path, valid, error } = loadConfig();
      const name = input.name.trim();
      const base = (input.id ?? slugify(name)).trim() || slugify(name);
      let id = base;
      for (let n = 2; config.groups.some((g) => g.id === id); n++) id = `${base}-${n}`;
      const before = config.groups.length;
      const groups = sanitizeGroups([...config.groups, { id, name, color: input.color }]);
      if (groups.length !== before + 1) {
        throw new Error(`group "${name}" failed backend validation (blank name or invalid color).`);
      }
      config.groups = groups;
      saveTo(path, config);
      return textResult(`${configWarning(valid, error)}Group "${name}" created with id "${id}". ${RELOAD_HINT}`);
    },
  );

  server.registerTool(
    "delete-group",
    {
      description: "Delete a group. By default it unassigns its actions (does not delete them).",
      inputSchema: DeleteGroupSchema,
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const { config, path, valid, error } = loadConfig();
      if (!config.groups.some((g) => g.id === input.id)) throw new Error(`group not found: "${input.id}".`);
      config.groups = config.groups.filter((g) => g.id !== input.id);
      if (input.unassignActions) {
        for (const a of config.actions) if (a.group === input.id) delete a.group;
      }
      saveTo(path, config);
      return textResult(`${configWarning(valid, error)}Group "${input.id}" deleted. ${RELOAD_HINT}`);
    },
  );

  server.registerTool(
    "validate-config",
    {
      description: "Validate the current quickspot.config.json without modifying it: count actions/groups and report entries ignored by the backend. Read-only.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const path = resolveConfigPath();
      if (!existsSync(path)) return textResult(`Missing ${path}: QuickSpot will use the 3 default values. Valid.`);
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch (e) {
        return textResult(`INVALID: cannot read ${path} (${e instanceof Error ? e.message : String(e)}).`);
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch (e) {
        return textResult(
          `INVALID: malformed JSON (${e instanceof Error ? e.message : String(e)}). QuickSpot will use the default values.`,
        );
      }
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        return textResult(
          "INVALID: the root must be a JSON object with an `actions` array. QuickSpot will use the default values.",
        );
      }
      if (!Array.isArray((raw as Record<string, unknown>).actions)) {
        return textResult("INVALID: missing `actions` array. QuickSpot will use the default values.");
      }
      const { config, skippedActions, skippedGroups } = validateConfigText(text);
      const detail = (items: { index: number; reason: string }[]): string =>
        items.map((s) => `\n  - index ${s.index}: ${s.reason}`).join("");
      return textResult(
        `Valid. Actions: ${config.actions.length} (skipped: ${skippedActions.length}), groups: ${config.groups.length} (skipped: ${skippedGroups.length}), ` +
          `language: ${config.language ?? "system"}, icons: ${config.showIcons}, magnify: ${config.magnify}, ` +
          `chips: ${config.chipLayout ?? "ring"}, theme: ${config.theme ?? "system"}, ` +
          `circle: ${config.circleSize ?? 100}%.` +
          (skippedActions.length ? `\nSkipped actions:${detail(skippedActions)}` : "") +
          (skippedGroups.length ? `\nSkipped groups:${detail(skippedGroups)}` : ""),
      );
    },
  );

  server.registerResource(
    "quickspot-config",
    "quickspot://config",
    { description: "The current quickspot.config.json as seen by the backend (after sanitizing).", mimeType: "application/json" },
    async (uri) => {
      const { config } = loadConfig();
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(config, null, 2) }] };
    },
  );

  return server;
}

function printHelp(): void {
  console.log(`quickspot-mcp v${SERVER_VERSION}
Usage:
  node dist/index.js                 Serve over stdio (piped host) or ask to install (terminal)
  node dist/index.js --install [--clients a,b] [--server PATH] [--node PATH] [--no-copy] [--dry-run]
  node dist/index.js --status
  node dist/index.js --uninstall [--clients a,b] [--remove-files] [--dry-run]
  node dist/index.js --yes ...       Same as --install, skipping the confirmation prompt
  node dist/index.js --help | --version

  --server PATH   Register an existing server file as-is (no copy).
  --node PATH     Node executable to register (default: stable PATH node).
  --no-copy       Register the running file instead of copying it.
  --remove-files  On uninstall, also delete the copied stable server.

The installer exits non-zero when a requested client fails (broken JSON,
failed CLI command); optional clients whose CLI is simply absent are
reported but do not fail the install.

The from-repo installer (scripts/install.mjs) never installs without asking:
with no action flags it prompts [y/N] on a TTY, and refuses on a
non-interactive shell unless --yes is given. Agents/CI: pass --yes.

After every action change, press Cmd/Ctrl+R in QuickSpot to reload. Reload
before changing settings in the app: QuickSpot refuses a settings save while
the file has external edits.
Variables: QUICKSPOT_CONFIG (file to edit), QUICKSPOT_MCP_DIR (install target),
QUICKSPOT_NODE (node executable to register).`);
}

/** Entry decision for a bare invocation (no explicit action flags).
 * Explicit actions always win; `--yes` is an explicit opt-in. Otherwise:
 * - no args + piped stdio = an MCP host spawning us -> serve;
 * - a terminal (TTY) = a human -> ask before touching anything;
 * - stray flags on a non-interactive shell -> refuse, demand --yes.
 * Installation is strictly opt-in and never silent. */
export type EntryDecision = "passthrough" | "prompt" | "refuse" | "install-yes" | "serve";

const ACTION_FLAGS = new Set(["--install", "--status", "--uninstall", "--help", "-h", "--version", "-V"]);

export function decideEntryArgs(argv: string[], isTTY: boolean): EntryDecision {
  if (argv.some((a) => ACTION_FLAGS.has(a.split("=")[0]))) return "passthrough";
  if (argv.includes("--yes") || argv.includes("-y")) return "install-yes";
  if (argv.length === 0) return isTTY ? "prompt" : "serve";
  return isTTY ? "prompt" : "refuse";
}

export function stripYes(argv: string[]): string[] {
  return argv.filter((a) => a !== "--yes" && a !== "-y");
}

export function parseClients(value: string | undefined): ClientId[] | undefined {
  if (!value) return undefined;
  const ids = value.split(",").map((s) => s.trim()).filter(Boolean) as ClientId[];
  for (const id of ids) {
    if (!CLIENTS.includes(id)) {
      throw new Error(`unknown client: "${id}" (${CLIENTS.join(", ")})`);
    }
  }
  return ids;
}

export function printInstallResult(
  res: { serverPath: string; copied: boolean; clients: { id: string; note: string; file: string | null; failed: boolean }[] },
  dryRun: boolean,
): void {
  const copyLabel = res.copied ? (dryRun ? " (would copy)" : " (copied)") : "";
  console.log(`Server: ${res.serverPath}${copyLabel}${dryRun ? " [dry-run]" : ""}`);
  for (const c of res.clients) {
    console.log(`- ${c.id}${c.failed ? " [FAILED]" : ""}: ${c.note}${c.file ? ` (${c.file})` : ""}`);
  }
  const failures = res.clients.filter((c) => c.failed).length;
  if (failures) console.log(`${failures} client(s) failed; see the messages above.`);
  if (res.clients.some((c) => !c.failed)) {
    console.log(RELOAD_HINT);
    console.log("Restart your AI client so it picks up the server.");
  }
}

async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return /^\s*y(es)?\s*$/i.test(answer);
  } catch {
    // stdin closed mid-prompt (Ctrl+D, harness EOF): counts as "no".
    return false;
  } finally {
    rl.close();
  }
}

/** CLI entry (install/status/uninstall/help). Returns true when it handled argv. */
export function runCli(rawArgv = process.argv.slice(2)): boolean {
  // --yes/-y is an explicit opt-in: behave exactly like --install.
  const argv = rawArgv.includes("--yes") || rawArgv.includes("-y") ? ["--install", ...stripYes(rawArgv)] : rawArgv;
  const flag = (name: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(name + "="));
    if (eq) return eq.slice(name.length + 1);
    const i = argv.indexOf(name);
    if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
    return undefined;
  };
  const has = (name: string): boolean => argv.includes(name);

  if (has("--help") || has("-h")) {
    printHelp();
    return true;
  }
  if (has("--version") || has("-V")) {
    console.log(`quickspot-mcp ${SERVER_VERSION}`);
    return true;
  }
  const dryRun = has("--dry-run");
  if (has("--status")) {
    console.log(status());
    const cfg = loadConfig();
    console.log(
      `QuickSpot config: ${cfg.path} (${cfg.existed ? (cfg.valid ? "valid" : `invalid: ${cfg.error}`) : "missing: using defaults"})`,
    );
    return true;
  }
  if (has("--uninstall")) {
    let clients: ClientId[] | undefined;
    try {
      clients = parseClients(flag("--clients"));
    } catch (e) {
      console.error(`quickspot-mcp: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 2;
      return true;
    }
    const res = uninstall({ clients, dryRun, removeFiles: has("--remove-files") });
    for (const line of res.lines) console.log(line);
    if (res.failed) process.exitCode = 1;
    return true;
  }
  if (has("--install")) {
    let clients: ClientId[] | undefined;
    try {
      clients = parseClients(flag("--clients"));
    } catch (e) {
      console.error(`quickspot-mcp: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 2;
      return true;
    }
    const server = flag("--server");
    const nodePath = flag("--node");
    const noCopy = has("--no-copy") || !!server;
    try {
      const res = install({ serverPath: server, clients, dryRun, noCopy, nodePath });
      printInstallResult(res, dryRun);
      if (res.clients.some((c) => c.failed)) process.exitCode = 1;
    } catch (e) {
      console.error(`quickspot-mcp: install failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    }
    return true;
  }
  return false;
}

const isMain = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isMain) {
  if (!runCli()) {
    // No action flags: disambiguate host-spawn from human invocation.
    const decision = decideEntryArgs(process.argv.slice(2), process.stdin.isTTY ?? false);
    if (decision === "serve" || decision === "passthrough") {
      serveStdio(() => createServer());
    } else if (decision === "install-yes") {
      runCli(["--install", ...stripYes(process.argv.slice(2))]);
    } else if (decision === "prompt") {
      const ok = await askYesNo("Install the QuickSpot MCP server for your AI clients? [y/N] ");
      if (!ok) {
        console.log("Skipped: nothing was installed. Re-run with --yes to install non-interactively, or --help for options.");
        process.exit(0);
      }
      runCli(["--install", ...stripYes(process.argv.slice(2))]);
    } else {
      console.error("Refusing to install from a non-interactive shell without --yes. Re-run with --yes, or --help for options.");
      process.exit(2);
    }
  }
}
