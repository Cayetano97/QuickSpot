/** Config file resolution, parsing, sanitizing and atomic saving.
 * Faithful port of `src-tauri/src/config.rs` (`parse_config`, `sanitize`,
 * `sanitize_groups`, `save_to`, `load_from`) so the MCP server can never
 * write a file the Rust backend would reject.
 */
import { existsSync, copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import {
  ACTION_KINDS,
  MAX_SEQUENCE_STEPS,
  isSequenceStepKind,
  type Action,
  type ActionKind,
  type Config,
  type Group,
  type SequenceStep,
} from "./types.js";

export const CONFIG_FILE_NAME = "quickspot.config.json";
const APP_DIR_NAME = "dev.quickspot.app";

/** Env override (tests, agents, portable installs). Wins over everything. */
export function envConfigPath(): string | null {
  const v = process.env.QUICKSPOT_CONFIG?.trim();
  return v ? v : null;
}

/** Per-user config dir, mirroring Tauri `app_config_dir()` in `lib.rs`. */
export function appConfigDir(): string {
  const home = homedir();
  const plat = platform();
  if (plat === "darwin") {
    return join(home, "Library", "Application Support", APP_DIR_NAME);
  }
  if (plat === "win32") {
    const base =
      process.env.APPDATA?.trim() ||
      join(process.env.USERPROFILE || home, "AppData", "Roaming");
    return join(base, APP_DIR_NAME);
  }
  const base = process.env.XDG_CONFIG_HOME?.trim() || join(home, ".config");
  return join(base, APP_DIR_NAME);
}

/** Legacy v1 working-directory file (`lib.rs` migrates it on first run). */
export function legacyConfigPath(cwd = process.cwd()): string {
  return join(cwd, CONFIG_FILE_NAME);
}

/** Resolve the file the MCP server must read/write.
 * Order: `$QUICKSPOT_CONFIG` > per-user config dir > legacy cwd file
 * (only when the per-user file does not exist yet, same as the Rust
 * first-run migration check). */
export function resolveConfigPath(cwd = process.cwd()): string {
  const env = envConfigPath();
  if (env) return env;
  const primary = join(appConfigDir(), CONFIG_FILE_NAME);
  if (existsSync(primary)) return primary;
  const legacy = legacyConfigPath(cwd);
  if (existsSync(legacy)) return legacy;
  return primary;
}

export function isHexColor(s: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(s);
}

function validColor(value: string): boolean {
  return isHexColor(value.trim());
}

export function validLanguage(value: string): boolean {
  return (
    value === "system" ||
    (!!value &&
      value.length <= 64 &&
      [...value].every((c) => /[A-Za-z0-9\-_]/.test(c)))
  );
}

export function validTheme(value: string): boolean {
  return value === "system" || value === "light" || value === "dark" || value === "deep";
}

/** The three built-in defaults (`defaults()` in Rust). */
export function defaults(): Action[] {
  return [
    { name: "QuickSpot", kind: "url", value: "https://github.com/Cayetano97/QuickSpot" },
    { name: "YouTube", kind: "url", value: "https://youtube.com" },
    { name: "Google", kind: "url", value: "https://google.com" },
  ];
}

export function withDefaults(): Config {
  return { actions: defaults(), groups: [], language: null, magnify: true, showIcons: true, theme: null };
}

function parseKind(value: unknown): ActionKind | null {
  if (typeof value !== "string") return null;
  return (ACTION_KINDS as readonly string[]).includes(value) ? (value as ActionKind) : null;
}

function parseSequenceStep(item: unknown): SequenceStep | null {
  if (typeof item !== "object" || item === null) return null;
  const obj = item as Record<string, unknown>;
  const kind = obj.kind;
  if (typeof kind !== "string" || !isSequenceStepKind(kind)) return null;
  if (typeof obj.value !== "string") return null;
  const step: SequenceStep = { kind, value: obj.value };
  if (typeof obj.browser === "string") step.browser = obj.browser;
  return step;
}

function parseSequenceSteps(root: Record<string, unknown>): SequenceStep[] {
  const out: SequenceStep[] = [];
  const list = root.steps;
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (out.length >= MAX_SEQUENCE_STEPS) break;
    const step = parseSequenceStep(item);
    if (step) out.push(step);
  }
  return out;
}

/** Parse config text with the exact fallback semantics of Rust `parse_config`:
 * throws on malformed JSON / missing `actions` array (caller falls back to
 * defaults); skips invalid items instead of failing. */
export function parseConfig(text: string): Config {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error("parse");
  }
  if (typeof root !== "object" || root === null) throw new Error("malformed");
  const r = root as Record<string, unknown>;
  if (!Array.isArray(r.actions)) throw new Error("malformed");

  const actions: Action[] = [];
  for (const item of r.actions as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.name !== "string" || !obj.name.trim()) continue;
    const kind = parseKind(obj.kind);
    if (!kind) continue;
    const hint = typeof obj.hint === "string" ? obj.hint : undefined;
    const group = typeof obj.group === "string" ? obj.group : undefined;
    if (kind === "sequence") {
      const steps = parseSequenceSteps(obj);
      if (steps.length === 0) continue;
      const a: Action = { name: obj.name, kind, value: "" };
      if (hint !== undefined) a.hint = hint;
      if (group !== undefined) a.group = group;
      a.steps = steps;
      actions.push(a);
      continue;
    }
    if (typeof obj.value !== "string") continue;
    const a: Action = { name: obj.name, kind, value: obj.value };
    if (typeof obj.browser === "string") a.browser = obj.browser;
    if (hint !== undefined) a.hint = hint;
    if (group !== undefined) a.group = group;
    actions.push(a);
  }

  const groups: Group[] = [];
  if (Array.isArray(r.groups)) {
    for (const item of r.groups as unknown[]) {
      if (typeof item !== "object" || item === null) continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.id !== "string" || typeof obj.name !== "string" || typeof obj.color !== "string") {
        continue;
      }
      const id = obj.id.trim();
      const name = obj.name.trim();
      if (!id || !name || !validColor(obj.color)) continue;
      groups.push({ id, name, color: obj.color.trim() });
    }
  }

  const language =
    typeof r.language === "string" && validLanguage(r.language) ? r.language : null;
  const magnify = typeof r.magnify === "boolean" ? r.magnify : true;
  const showIcons = typeof r.showIcons === "boolean" ? r.showIcons : true;
  const theme =
    typeof r.theme === "string" && validTheme(r.theme) && r.theme !== "system" ? r.theme : null;

  return { actions, groups, language, magnify, showIcons, theme };
}

/** Read + parse exactly once. Missing file or any parse error -> defaults. */
export function loadFrom(path: string): Config {
  try {
    return parseConfig(readFileSync(path, "utf8"));
  } catch {
    return withDefaults();
  }
}

export function loadConfig(configPath = resolveConfigPath()): { config: Config; path: string; existed: boolean } {
  const existed = existsSync(configPath);
  return { config: loadFrom(configPath), path: configPath, existed };
}

/** Lenient validation mirroring Rust `sanitize`. */
export function sanitize(actions: Action[]): Action[] {
  const out: Action[] = [];
  for (const input of actions) {
    const name = (input.name ?? "").trim();
    if (!name) continue;
    const kind = parseKind(input.kind);
    if (!kind) continue;
    const groupRaw = typeof input.group === "string" ? input.group : null;
    const group = groupRaw && groupRaw.trim() ? groupRaw : undefined;
    if (kind === "sequence") {
      const rawSteps = Array.isArray(input.steps) ? input.steps : [];
      const steps: SequenceStep[] = [];
      for (const s of rawSteps) {
        if (steps.length >= MAX_SEQUENCE_STEPS) break;
        if (!s || !isSequenceStepKind(s.kind)) continue;
        const value = (s.value ?? "").trim();
        if (!value) continue;
        const clean: SequenceStep = { kind: s.kind, value };
        if (s.kind === "url" && typeof s.browser === "string" && s.browser.trim()) {
          clean.browser = s.browser.trim();
        }
        steps.push(clean);
      }
      if (steps.length === 0) continue;
      steps.length = Math.min(steps.length, MAX_SEQUENCE_STEPS);
      const a: Action = { name, kind, value: "" };
      if (input.hint) a.hint = input.hint;
      if (group) a.group = group;
      a.steps = steps;
      out.push(a);
      continue;
    }
    const value = (input.value ?? "").trim();
    if (!value) continue;
    const a: Action = { name, kind, value };
    if (kind === "url" && typeof input.browser === "string" && input.browser.trim()) {
      a.browser = input.browser;
    }
    if (input.hint) a.hint = input.hint;
    if (group) a.group = group;
    out.push(a);
  }
  return out;
}

/** Drop groups with a blank id/name or a non-`#rrggbb` color. */
export function sanitizeGroups(groups: Group[]): Group[] {
  const out: Group[] = [];
  for (const g of groups) {
    const id = (g.id ?? "").trim();
    const name = (g.name ?? "").trim();
    const color = (g.color ?? "").trim();
    if (!id || !name || !validColor(color)) continue;
    out.push({ id, name, color });
  }
  return out;
}

export function serializeConfig(config: Config): string {
  const root: Record<string, unknown> = { actions: sanitize(config.actions) };
  const groups = sanitizeGroups(config.groups);
  if (groups.length > 0) root.groups = groups;
  if (config.language) root.language = config.language;
  if (!config.magnify) root.magnify = false;
  if (!config.showIcons) root.showIcons = false;
  if (config.theme && validTheme(config.theme) && config.theme !== "system") {
    root.theme = config.theme;
  }
  return JSON.stringify(root, null, 2) + "\n";
}

/** Write the config back atomically (tmp + rename) keeping a `.bak` copy.
 * Creates the parent dir when missing. Returns the path written. */
export function saveTo(path: string, config: Config): string {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    try {
      copyFileSync(path, path + ".bak");
    } catch {
      // Backup is best-effort; the write below is what matters.
    }
  }
  const text = serializeConfig(config);
  const tmp = join(
    dirname(path),
    `.${CONFIG_FILE_NAME}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
  return path;
}

/** Find an action by numeric index or case-insensitive name. */
export function findActionIndex(actions: Action[], ref: number | string): number {
  if (typeof ref === "number") {
    return Number.isInteger(ref) && ref >= 0 && ref < actions.length ? ref : -1;
  }
  const needle = ref.trim().toLowerCase();
  return actions.findIndex((a) => a.name.trim().toLowerCase() === needle);
}
