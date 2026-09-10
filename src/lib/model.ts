import { MAX_QUERY_BYTES, MAX_VISIBLE } from "./constants";

export type ActionKind = "url" | "command" | "app" | "file" | "folder" | "sequence";

/** Leaf kinds a sequence step may use (never `sequence`: no nesting). */
export type SequenceStepKind = Exclude<ActionKind, "sequence">;

export const SEQUENCE_STEP_KINDS: readonly SequenceStepKind[] = [
  "url",
  "command",
  "app",
  "file",
  "folder",
] as const;

/** Maximum steps a sequence action holds (backend truncates beyond this). */
export const MAX_SEQUENCE_STEPS = 5;

export interface SequenceStep {
  kind: SequenceStepKind;
  value: string;
  browser?: string | null;
}

export interface Action {
  name: string;
  kind: ActionKind;
  value: string;
  browser?: string | null;
  hint?: string | null;
  /** Id of the group this action belongs to, if any. */
  group?: string | null;
  /** Sub-actions for `kind === "sequence"` (1..MAX_SEQUENCE_STEPS). */
  steps?: SequenceStep[] | null;
}

/** True for the six-way picker value that fans out to sub-actions. */
export const isSequenceKind = (kind: string): kind is "sequence" => kind === "sequence";

/** True for a runnable leaf kind (anything but `sequence`). */
export function isSequenceStepKind(kind: string): kind is SequenceStepKind {
  return (SEQUENCE_STEP_KINDS as readonly string[]).includes(kind);
}

/** Trimmed, non-empty leaf steps in order, capped at MAX_SEQUENCE_STEPS.
 * Drops nested `sequence` kinds and blank values (same rule as Rust
 * `sanitize`). Pure: never mutates the input. */
export function normalizeSequenceSteps(
  steps: readonly SequenceStep[] | null | undefined,
): SequenceStep[] {
  if (!steps) return [];
  const out: SequenceStep[] = [];
  for (const s of steps) {
    if (out.length >= MAX_SEQUENCE_STEPS) break;
    if (!s || !isSequenceStepKind(s.kind)) continue;
    const value = (s.value ?? "").trim();
    if (!value) continue;
    const browser = (s.browser ?? "").trim();
    const clean: SequenceStep = { kind: s.kind, value };
    if (s.kind === "url" && browser) clean.browser = browser;
    out.push(clean);
  }
  return out;
}

/** A sequence action is valid with a non-blank name and at least one
 * runnable step (blank steps don't count). */
export function isValidSequenceAction(a: Pick<Action, "name" | "steps">): boolean {
  if (!a.name.trim()) return false;
  const steps = a.steps ?? [];
  let runnable = 0;
  for (const s of steps) {
    if (!s || !isSequenceStepKind(s.kind)) continue;
    if ((s.value ?? "").trim()) runnable++;
    if (runnable > 0) break;
  }
  return runnable > 0;
}

export interface Group {
  id: string;
  name: string;
  color: string;
}

/** Curated 6-digit hex colors, each readable (luminance >= READABLE_LUMINANCE)
 * on the dark disc. Free-form colors are validated against the same bar. */
export const isHexColor = (s: string): boolean => /^#[0-9a-f]{6}$/i.test(s);

/** WCAG relative luminance of a #rrggbb hex color (0 = black, 1 = white). */
export function hexLuminance(hex: string): number {
  if (!isHexColor(hex)) return 0;
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    const lin = v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    sum += lin * (i === 0 ? 0.2126 : i === 1 ? 0.7152 : 0.0722);
  }
  return sum;
}

/** Minimum luminance for a color to contrast (~4.5:1) against the dark disc
 * fill (#111113); below that a hex color is rejected in the settings editor. */
export const READABLE_LUMINANCE = 0.2;

export const isReadableOnDark = (hex: string): boolean =>
  hexLuminance(hex) >= READABLE_LUMINANCE;

/** Lowercase alphanumeric slug ("Dev Tools" -> "dev-tools"); diacritics are
 * stripped first ("Wörk" -> "work"); falls back to `fallback` when nothing
 * slugifiable remains. */
export function slugify(s: string, fallback = "group"): string {
  const normalized = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/** First id (from `slugify(name)`) not already taken by `groups`. */
export function uniqueGroupId(groups: readonly Group[], name: string): string {
  const base = slugify(name);
  let id = base;
  for (let n = 2; groups.some((g) => g.id === id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * Normalize free text for matching: collapse every whitespace run (spaces,
 * tabs, newlines, NBSP, …) to a single space, trim the edges, lowercase and
 * strip diacritics. Pure: never throws on `null`/`undefined` (treated as "").
 *
 * Rationale: the launcher keeps the raw keystrokes in the input (so the
 * caret never jumps) and normalizes only for matching. That way
 * `"  GitHub  "`, `"\\tgithub\\n"` and `"GITHUB"` all match `GitHub`, while
 * `"   "` (whitespace-only) normalizes to `""` and matches everything
 * instead of showing a confusing "no matches".
 */
export function normalizeQuery(query: string | null | undefined): string {
  return (query ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Normalized form of an action/app name, using the same pipeline as the
 * query so matching is case-, accent- and whitespace-insensitive
 * (`"Canción"` ⇔ `"cancion"`, `"Native  SDK"` ⇔ `"native sdk"`). */
export function normalizeName(name: string | null | undefined): string {
  return normalizeQuery(name);
}

/** True when `name` matches the (raw, unnormalized) `query`. A blank query
 * (empty or whitespace-only) matches every name; otherwise it is a
 * substring match on the normalized forms, in config order semantics. */
export function matchesQuery(name: string, query: string): boolean {
  const q = normalizeQuery(query);
  if (q.length === 0) return true;
  return normalizeName(name).includes(q);
}

/**
 * Substring match on `name` only (never `value`/`hint`/group: those would
 * leak paths into the ring and make results noisy), in config order (never
 * re-orders). The query is normalized (trimmed, whitespace-collapsed,
 * case- and accent-insensitive); blank queries match everything.
 * Returns the first MAX_VISIBLE matching indices.
 */
export function filterActions(actions: readonly Action[], query: string): number[] {
  const q = normalizeQuery(query);
  const out: number[] = [];
  for (let i = 0; i < actions.length && out.length < MAX_VISIBLE; i++) {
    if (q.length === 0 || normalizeName(actions[i].name).includes(q)) out.push(i);
  }
  return out;
}

/** Count of every action matching the query (uncapped); filterActions caps
 * its return at MAX_VISIBLE, and the launcher shows the delta as "N more".
 * Shares `normalizeQuery` with `filterActions`, so both always agree on
 * what "matches" means (including blank-query-matches-all). */
export function countMatches(actions: readonly Action[], query: string): number {
  const q = normalizeQuery(query);
  if (q.length === 0) return actions.length;
  let n = 0;
  for (const a of actions) if (normalizeName(a.name).includes(q)) n++;
  return n;
}

/**
 * Stable grouping by group id: returns the same actions reordered so every
 * action sharing a group becomes contiguous. Relative order is preserved
 * within a group, groups keep the order of their first appearance, and
 * ungrouped actions act as their own singletons (they never cross each
 * other, and a group block never splits an ungrouped run). Actions with a
 * group id that has no matching `Group` entry are still grouped by that id.
 */
export function groupActions(actions: readonly Action[]): Action[] {
  const blockOf = new Map<string, number>();
  let key = 0;
  const keys: number[] = [];
  for (const a of actions) {
    if (a.group) {
      let k = blockOf.get(a.group);
      if (k === undefined) {
        k = key++;
        blockOf.set(a.group, k);
      }
      keys.push(k);
    } else {
      keys.push(key++);
    }
  }
  return actions
    .map((action, i) => ({ action, key: keys[i] }))
    .sort((x, y) => x.key - y.key)
    .map(({ action }) => action);
}

/** Move the selection by delta, wrapping in both directions. A negative
 * `current` means "nothing selected": stepping forward lands on the first
 * item, stepping backward on the last. */
export function moveSelection(current: number, count: number, delta: number): number {
  if (count === 0) return 0;
  const start = current >= 0 ? current : delta > 0 ? -1 : count;
  return (((start + delta) % count) + count) % count;
}

/** Remove the last full Unicode codepoint (handles surrogate pairs). */
export function backspaceCodepoint(s: string): string {
  const chars = Array.from(s);
  chars.pop();
  return chars.join("");
}

/** Cap a string at maxBytes UTF-8 without splitting a codepoint. */
export function capUtf8Bytes(s: string, maxBytes = MAX_QUERY_BYTES): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= maxBytes) return s;
  let n = maxBytes;
  while (n > 0 && (bytes[n] & 0xc0) === 0x80) n--;
  return new TextDecoder().decode(bytes.slice(0, n));
}
