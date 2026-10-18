import {
  CENTER_X,
  CENTER_Y,
  CHIP_GAP,
  CHIP_H,
  CHIP_W,
  DISC_RADIUS,
  DOCK_MAX_SCALE,
  DOCK_RADIUS,
  ORBIT_RADIUS,
  PETAL_HOVER_PEAK,
  SELECTION_BOOST,
} from "./constants";

export const clamp01 = (t: number): number => Math.min(Math.max(t, 0), 1);

export const easeOutCubic = (t: number): number => {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
};

export const easeOutQuart = (t: number): number => {
  const u = 1 - clamp01(t);
  return 1 - u * u * u * u;
};

export const easeOutBack = (t: number, o = 1.70158): number => {
  const u = clamp01(t) - 1;
  return 1 + (o + 1) * u * u * u + o * u * u;
};

export const easeInBack = (t: number, o = 1.2): number => {
  const u = clamp01(t);
  return (o + 1) * u * u * u - o * u * u;
};

export const easeOutElastic = (t: number): number => {
  const u = clamp01(t);
  if (u === 0 || u === 1) return u;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -8 * u) * Math.sin((u * 10 - 0.75) * c4) + 1;
};

/**
 * Per-chip stagger: remap raw progress into the window [offset, 1] -> [0, 1].
 * Open walks i 0..n-1, close walks the reverse order (n-1-i).
 */
export function staggeredProgress(
  raw: number,
  i: number,
  total: number,
  staggerFrac = 0.3,
): number {
  if (total === 0) return raw;
  const n = total - 1;
  const shift = (staggerFrac / Math.max(n, 1)) * i;
  const windowLen = 1 - shift;
  if (windowLen <= 0) return 0;
  return clamp01((raw - shift) / windowLen);
}

/**
 * Dock-style fisheye magnification (macOS Dock). Every tile scales as a
 * smooth function of its distance to the cursor: the closest tile peaks at
 * DOCK_MAX_SCALE, neighbours ease back through a smoothstep falloff, so the
 * ring swells and recedes as the cursor glides across it. The
 * keyboard-selected tile keeps at least SELECTION_BOOST regardless of the
 * cursor. `radius` is the wave's reach: the petal ring's tight default, or
 * the pills layout's wider `PILL_DOCK_RADIUS`.
 */
export function dockScale(
  chipCx: number,
  chipCy: number,
  mouseX: number,
  mouseY: number,
  isSelected: boolean,
  radius = DOCK_RADIUS,
): number {
  const dist = Math.hypot(chipCx - mouseX, chipCy - mouseY);
  const base = isSelected ? SELECTION_BOOST : 1;

  if (dist >= radius) return base;

  const s = 1 - dist / radius;
  const t = s * s * (3 - 2 * s); // smoothstep: s²(3 − 2s)
  const hover = 1 + (DOCK_MAX_SCALE - 1) * t;
  return Math.max(base, hover);
}

/** Angle for pill `index` of `total`: starts at 12 o'clock, clockwise.
 *  (The classic pills layout; the ring angles live in `petals.ts`.) */
export function orbitAngle(index: number, total: number): number {
  return -Math.PI / 2 + ((2 * Math.PI) / total) * index;
}

/**
 * Orbit radius for `total` pills: grows past the base radius whenever the
 * pills would otherwise touch, so all MAX_VISIBLE actions fit without
 * overlap. The circle must also stay inside the 520px-wide disc.
 */
export function orbitRadius(total: number): number {
  if (total <= 1) return ORBIT_RADIUS;
  const needed = (CHIP_W + CHIP_GAP) / (2 * Math.sin(Math.PI / total));
  // Seven items place the first diagonals closest to the query. Give that
  // regular polygon a little more radius instead of changing its angles.
  const clearCoreRadius = total === 7 ? 180 : ORBIT_RADIUS;
  return Math.min(Math.max(clearCoreRadius, needed), CENTER_X - CHIP_W / 2 - 2);
}

/** Canvas-center of pill `index` (the classic layout). */
export function chipCenter(index: number, total: number): [number, number] {
  const a = orbitAngle(index, total);
  const r = orbitRadius(total);
  return [CENTER_X + Math.cos(a) * r, CENTER_Y + Math.sin(a) * r];
}

/**
 * Largest scale that keeps the whole pill rectangle inside the disc circle
 * (center (CENTER_X, CENTER_Y), radius DISC_RADIUS). The pill grows from its
 * center, so the far corner — the one closest to the disc's rim — is what
 * limits the scale; solving `(a·s + dx)² + (b·s + dy)² = r²` for s where
 * `a`/`b` are half the pill's width/height and `dx`/`dy` the pill's offset
 * from the disc center. Returns `scale` unchanged when it already fits
 * (the common case: only the 3/9 o'clock pills of a full ring clamp).
 */
export function chipMaxScale(cx: number, cy: number, scale: number): number {
  const a = CHIP_W / 2;
  const b = CHIP_H / 2;
  const dx = Math.abs(cx - CENTER_X);
  const dy = Math.abs(cy - CENTER_Y);
  const A = a * a + b * b;
  const B = 2 * (a * dx + b * dy);
  const C = dx * dx + dy * dy - DISC_RADIUS * DISC_RADIUS;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return Math.min(scale, 1);
  const max = (-B + Math.sqrt(disc)) / (2 * A);
  return Math.min(scale, max);
}

/**
 * Hover magnification for a petal: the dock wave's 1..DOCK_MAX_SCALE range is
 * remapped onto 1..PETAL_HOVER_PEAK, because the tiles already fill the disc
 * (there is no room for a 1.2x swell), while the selected tile still lifts to
 * SELECTION_BOOST.
 */
export function petalHoverScale(
  chipCx: number,
  chipCy: number,
  mouseX: number,
  mouseY: number,
  isSelected: boolean,
): number {
  const dock = dockScale(chipCx, chipCy, mouseX, mouseY, isSelected);
  const t = (dock - 1) / (DOCK_MAX_SCALE - 1);
  const wave = 1 + t * (PETAL_HOVER_PEAK - 1);
  return Math.max(wave, isSelected ? SELECTION_BOOST : 1);
}
