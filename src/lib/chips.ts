/**
 * Chip layout preference (`chipLayout` in the config): how the launcher
 * arranges its action chips.
 *
 * - `ring` (default) — rounded wedge tiles filling the disc between the free
 *   centre circle and the tray's edge (geometry in `petals.ts`).
 * - `pills` — the classic flat pills riding a regular orbit around the hub
 *   (`chipCenter()` in `easing.ts`).
 *
 * Unknown or missing values fall back to `ring` (same policy as `theme.ts`),
 * so a hand-edited config can never leave the launcher without a layout.
 */
export type ChipMode = "ring" | "pills";

/** Selectable layouts, in settings order. */
export const CHIP_MODES: readonly ChipMode[] = ["ring", "pills"];

/** Config value -> a known `ChipMode` (anything unknown means the default). */
export function normalizeChipMode(value: unknown): ChipMode {
  return value === "pills" ? "pills" : "ring";
}
