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
import * as z from "zod/v4";
import {
  findActionIndex,
  loadConfig,
  resolveConfigPath,
  sanitize,
  sanitizeGroups,
  saveTo,
} from "./config.js";
import { install, status, uninstall, type ClientId } from "./install.js";
import {
  ActionKindSchema,
  CreateActionSchema,
  CreateGroupSchema,
  DeleteActionSchema,
  DeleteGroupSchema,
  MoveActionSchema,
  StepKindSchema,
  UpdateActionSchema,
} from "./schema.js";
import type { Action } from "./types.js";
import { MAX_SEQUENCE_STEPS } from "./types.js";

export const SERVER_NAME = "quickspot";
export const SERVER_VERSION = "0.1.0";

const RELOAD_HINT = "Press Cmd/Ctrl+R in QuickSpot (or tray -> Reload config) to see the changes.";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
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
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "list-actions",
    {
      description: "List QuickSpot actions (index, name, type, value, group). Read-only.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { config, path } = loadConfig();
      return textResult(`Config: ${path}\n${config.actions.length} acciones:\n${summarizeActions(config.actions)}`);
    },
  );

  server.registerTool(
    "get-config",
    {
      description: "Return the full quickspot.config.json (actions, groups, language, theme) and the resolved path. Read-only.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { config, path, existed } = loadConfig();
      return textResult(
        `Path: ${path} (${existed ? "exists" : "missing: showing default values"})\n` +
          JSON.stringify(config, null, 2),
      );
    },
  );

  server.registerTool(
    "create-action",
    {
      description:
        "Create a QuickSpot action (url, command, app, file, folder or sequence of up to 5 steps). Validates like the backend; the name must be unique.",
      inputSchema: CreateActionSchema,
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      const { config, path } = loadConfig();
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
      return textResult(`Action "${action.name}" created (${action.kind}). ${RELOAD_HINT}`);
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
      const { config, path } = loadConfig();
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
      return textResult(`Action "${prev.name}" updated. ${RELOAD_HINT}`);
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
      const { config, path } = loadConfig();
      const idx = findActionIndex(config.actions, input.ref as number | string);
      if (idx < 0) throw new Error(`action not found: ${String(input.ref)}.`);
      const [removed] = config.actions.splice(idx, 1);
      saveTo(path, config);
      return textResult(`Action "${removed.name}" deleted. ${RELOAD_HINT}`);
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
      const { config, path } = loadConfig();
      const idx = findActionIndex(config.actions, input.ref as number | string);
      if (idx < 0) throw new Error(`action not found: ${String(input.ref)}.`);
      const [item] = config.actions.splice(idx, 1);
      const to = Math.max(0, Math.min(input.to, config.actions.length));
      config.actions.splice(to, 0, item);
      saveTo(path, config);
      return textResult(`"${item.name}" moved to position ${to}. ${RELOAD_HINT}`);
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
      const { config, path } = loadConfig();
      const base = (input.id ?? slugify(input.name)).trim() || slugify(input.name);
      let id = base;
      for (let n = 2; config.groups.some((g) => g.id === id); n++) id = `${base}-${n}`;
      config.groups = sanitizeGroups([...config.groups, { id, name: input.name.trim(), color: input.color }]);
      saveTo(path, config);
      return textResult(`Group "${input.name}" created with id "${id}". ${RELOAD_HINT}`);
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
      const { config, path } = loadConfig();
      if (!config.groups.some((g) => g.id === input.id)) throw new Error(`group not found: "${input.id}".`);
      config.groups = config.groups.filter((g) => g.id !== input.id);
      if (input.unassignActions) {
        for (const a of config.actions) if (a.group === input.id) delete a.group;
      }
      saveTo(path, config);
      return textResult(`Group "${input.id}" deleted. ${RELOAD_HINT}`);
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
      const { readFileSync, existsSync } = await import("node:fs");
      const path = resolveConfigPath();
      if (!existsSync(path)) return textResult(`Missing ${path}: QuickSpot will use the 3 default values. Valid.`);
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(path, "utf8"));
      } catch (e) {
        return textResult(`INVALID: malformed JSON (${e instanceof Error ? e.message : String(e)}). QuickSpot will use the default values.`);
      }
      const { parseConfig } = await import("./config.js");
      const rawActions = Array.isArray((raw as Record<string, unknown>).actions)
        ? ((raw as Record<string, unknown>).actions as unknown[]).length
        : -1;
      if (rawActions === -1) return textResult("INVALID: missing `actions` array. QuickSpot will use the default values.");
      const parsed = parseConfig(JSON.stringify(raw));
      const skipped = rawActions - parsed.actions.length;
      return textResult(
        `Valid. Actions: ${parsed.actions.length} (skipped: ${skipped}), groups: ${parsed.groups.length}, ` +
          `language: ${parsed.language ?? "system"}, icons: ${parsed.showIcons}, magnify: ${parsed.magnify}, theme: ${parsed.theme ?? "system"}.`,
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

  // Referenced so the kind enums stay the single source of truth for docs.
  void ActionKindSchema;
  void StepKindSchema;
  void MAX_SEQUENCE_STEPS;

  return server;
}

function printHelp(): void {
  console.log(`quickspot-mcp v${SERVER_VERSION}
Usage:
  node dist/index.js                 Serve over stdio (piped host) or ask to install (terminal)
  node dist/index.js --install [--clients a,b] [--server PATH] [--no-copy] [--dry-run]
  node dist/index.js --status
  node dist/index.js --uninstall [--clients a,b] [--dry-run]
  node dist/index.js --yes ...       Same as --install, skipping the confirmation prompt
  node dist/index.js --help | --version

The from-repo installer (scripts/install.mjs) never installs without asking:
with no action flags it prompts [y/N] on a TTY, and refuses on a
non-interactive shell unless --yes is given. Agents/CI: pass --yes.

After every action change, press Cmd/Ctrl+R in QuickSpot to reload.
Variables: QUICKSPOT_CONFIG (file to edit), QUICKSPOT_MCP_DIR (install target).`);
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

function parseClients(value: string | undefined): ClientId[] | undefined {
  if (!value) return undefined;
  const ids = value.split(",").map((s) => s.trim()).filter(Boolean) as ClientId[];
  const valid: ClientId[] = [
    "claude-desktop",
    "claude-code",
    "cursor",
    "vscode",
    "windsurf",
    "opencode",
    "gemini",
    "codex",
  ];
  for (const id of ids) {
    if (!valid.includes(id)) throw new Error(`unknown client: "${id}" (${valid.join(", ")})`);
  }
  return ids;
}

export function printInstallResult(res: { serverPath: string; copied: boolean; clients: { id: string; note: string; file: string | null }[] }, dryRun: boolean): void {
  console.log(`Server: ${res.serverPath}${res.copied ? " (copied)" : ""}${dryRun ? " [dry-run]" : ""}`);
  for (const c of res.clients) console.log(`- ${c.id}: ${c.note}${c.file ? ` (${c.file})` : ""}`);
  console.log(RELOAD_HINT);
  console.log("Restart your AI client so it picks up the server.");
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
    console.log(`QuickSpot config: ${resolveConfigPath()}`);
    return true;
  }
  if (has("--uninstall")) {
    const clients = parseClients(flag("--clients"));
    for (const line of uninstall({ clients, dryRun })) console.log(line);
    return true;
  }
  if (has("--install")) {
    const clients = parseClients(flag("--clients"));
    const server = flag("--server");
    const noCopy = has("--no-copy");
    printInstallResult(install({ serverPath: server, clients, dryRun, noCopy }), dryRun);
    return true;
  }
  return false;
}

const isMain = process.argv[1] !== undefined && import.meta.url.endsWith("/index.js");
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
