import { MAX_QUERY_BYTES, MAX_VISIBLE } from "./constants";

export type ActionKind = "url" | "command" | "app";

export interface Action {
  name: string;
  kind: ActionKind;
  value: string;
  browser?: string | null;
  hint?: string | null;
}

/**
 * Case-insensitive substring match on `name`, in config order (never
 * re-orders). Returns the first MAX_VISIBLE matching indices.
 */
export function filterActions(actions: readonly Action[], query: string): number[] {
  const q = query.toLowerCase();
  const out: number[] = [];
  for (let i = 0; i < actions.length && out.length < MAX_VISIBLE; i++) {
    if (q.length === 0 || actions[i].name.toLowerCase().includes(q)) out.push(i);
  }
  return out;
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
