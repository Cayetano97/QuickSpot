/**
 * Launcher circle size (`circleSize` in the config): the zoom applied to the
 * round launcher composition.
 *
 * The whole composition is one design: the disc, the action chips (wedge
 * tiles in the ring layout, orbiting pills in the classic one — both ride
 * whichever the user picked) and the centre cluster (grip, hub, add, query,
 * minimize) keep their proportions only if they scale together, so the
 * setting is a single scale factor on their common canvas (the `#launcher`
 * wrapper in index.html), never a per-element size.
 *
 * The value is an integer percent of the design size on a 5% grid:
 *
 * - `CIRCLE_SIZE_MIN` (85%): below that the 13px chip labels cross the 11px
 *   legibility floor of the macOS HIG, so the design refuses to shrink
 *   further.
 * - `CIRCLE_SIZE_MAX` (125%): the 520x580 canvas at 1.25 is 650x725, which
 *   still fits the default 680x740 OS window (and every smaller window,
 *   because `--overlay-scale` already shrinks the canvas to fit, so the
 *   product of the two stays inside the window at any allowed size).
 *
 * Unknown or malformed values fall back to the default (100%), and any
 * in-range number snaps to the grid, so a hand-edited config can never
 * leave the launcher clipped or the slider off-grid (same policy as
 * `theme.ts` / `chips.ts`).
 */
export const CIRCLE_SIZE_MIN = 85;
export const CIRCLE_SIZE_MAX = 125;
export const CIRCLE_SIZE_STEP = 5;
export const CIRCLE_SIZE_DEFAULT = 100;

/** Config value -> a size on the valid 5% grid, or the default. */
export function normalizeCircleSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return CIRCLE_SIZE_DEFAULT;
  const clamped = Math.min(CIRCLE_SIZE_MAX, Math.max(CIRCLE_SIZE_MIN, value));
  return Math.round(clamped / CIRCLE_SIZE_STEP) * CIRCLE_SIZE_STEP;
}

/** Percent -> the scale factor applied to the launcher canvas. */
export function circleScale(size: number): number {
  return size / 100;
}
