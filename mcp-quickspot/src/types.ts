/** Shared QuickSpot model. Mirrors `src-tauri/src/config.rs` + `src/lib/model.ts`.
 * The MCP server never invents semantics: it reuses these exact rules. */

export type ActionKind = "url" | "command" | "app" | "file" | "folder" | "sequence";

export const ACTION_KINDS: readonly ActionKind[] = [
  "url",
  "command",
  "app",
  "file",
  "folder",
  "sequence",
] as const;

/** Leaf kinds allowed inside `sequence.steps` (never `sequence`: no nesting). */
export type SequenceStepKind = Exclude<ActionKind, "sequence">;

export const SEQUENCE_STEP_KINDS: readonly SequenceStepKind[] = [
  "url",
  "command",
  "app",
  "file",
  "folder",
] as const;

/** Backend cap (`MAX_SEQUENCE_STEPS` in Rust). Anything beyond is truncated. */
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
  group?: string | null;
  steps?: SequenceStep[] | null;
}

export interface Group {
  id: string;
  name: string;
  color: string;
}

export interface Config {
  actions: Action[];
  groups: Group[];
  /** `null` = follow the OS language. */
  language: string | null;
  magnify: boolean;
  showIcons: boolean;
  /** `null` = follow the OS theme. Only light/dark/deep are pinned. */
  theme: string | null;
}

export function isActionKind(s: string): s is ActionKind {
  return (ACTION_KINDS as readonly string[]).includes(s);
}

export function isSequenceStepKind(s: string): s is SequenceStepKind {
  return (SEQUENCE_STEP_KINDS as readonly string[]).includes(s);
}
