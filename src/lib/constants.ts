/** Launcher canvas geometry (logical px). Canvas is 520x580 centered in the
 * 680x740 OS window, disc is centered in the canvas. */
export const CANVAS_W = 520;
export const CANVAS_H = 580;

export const CENTER_X = CANVAS_W / 2;
export const CENTER_Y = CANVAS_H / 2;

export const DISC_RADIUS = 260;
export const DISC_Y = (CANVAS_H - DISC_RADIUS * 2) / 2;

export const HUB_SIZE = 64;

/** The petal ring: chips are rounded wedge tiles filling the annulus between
 *  these radii. `INNER_R` leaves the centre circle to the control cluster
 *  (grip, hub/add, query, minimize); `OUTER_R` stops short of the tray's rim
 *  (and of the hover peak: the worst case is the single-action ring, whose
 *  pivot sits at the disc centre, so its 1.05x outer edge is
 *  `246 x 1.05 = 258.3 < 260`). */
export const PETAL_INNER_R = 104;
export const PETAL_OUTER_R = 246;
/** Gutter between neighbouring petals: a constant-width seam along the
 *  shared radial line, so the space reads the same at the rim and at the
 *  inner edge. */
export const PETAL_GAP = 6;
/** Tile corner radius (clamped by the available edge length per count). */
export const PETAL_CORNER = 12;
/** Hover magnification peak for a tile: gentler than the old pill fisheye,
 *  because the tiles already fill the disc and 1.2x would close the gutters
 *  and push the outermost edge past the tray rim. It must never sit below
 *  the selection floor (`SELECTION_BOOST`), or a merely hovered tile would
 *  outgrow the selected one. */
export const PETAL_HOVER_PEAK = 1.05;

/** Classic chip layout (`chipLayout: "pills"`): flat pills riding a regular
 *  orbit around the hub. `ORBIT_RADIUS` is the base; `orbitRadius()` grows
 *  it per count so the pills never touch. */
export const ORBIT_RADIUS = 160;
export const CHIP_W = 132;
export const CHIP_H = 40;
/** Extra breathing room between adjacent pills when the orbit grows. */
export const CHIP_GAP = 8;
/** Hover magnification reach in pills mode: the dock wave runs over the
 *  pill's 100px neighbourhood (pills sit at ~160-183px from the disc
 *  centre, so the wave crosses the whole orbit). */
export const PILL_DOCK_RADIUS = 100;

export const MINIMIZE_H = 36;

/** Query pill: centered inside the petal ring's free centre circle. */
export const QUERY_W = 136;
export const QUERY_H = 32;
export const QUERY_Y = 270;

/** Vertical stack inside the centre circle: drag grip on top, settings +
 *  add above the query, the "+N more" caption under it, minimize last. All
 *  four controls stay within `PETAL_INNER_R` of the disc centre. */
export const HUB_Y = QUERY_Y - 40;
export const MINIMIZE_Y = QUERY_Y + QUERY_H + 30;

/** Hub control cluster: the settings gear and the add-actions button sit
 * side by side, evenly spaced around the center line (36px buttons, 8px
 * gap, so each is offset by 22px). */
export const HUB_X = CENTER_X + 22;
export const ADD_X = CENTER_X - 22;

export const GRIP_W = 96;
export const GRIP_H = 24;
/** Inside the centre circle, on top of the hub cluster: the grip's outermost
 *  corner (48, 90) stays within PETAL_INNER_R, clear of every tile. */
export const GRIP_Y = 200;
export const GRIP_RADIUS = 8;

/** Animation timing (ms) and easing constants. */
export const OPEN_MS = 220;
export const CLOSE_MS = 150;
export const STAGGER_FRAC = 0.22;

/** How long an execution error stays visible on the query line (ms). */
export const RUN_ERROR_MS = 3500;

/** Dock-style hover magnification (macOS fisheye) for the petal ring. The
 *  effect only kicks in when the cursor is close to a tile's centre (tiles
 *  sit at ~176px from the disc centre), so with 64 the centre circle (grip,
 *  gear, query) stays untouched while the wave rolls smoothly along the
 *  ring. The pills layout passes its own reach (`PILL_DOCK_RADIUS`). */
export const DOCK_RADIUS = 64;
export const DOCK_MAX_SCALE = 1.2;
export const SELECTION_BOOST = 1.05;
/** Cap for a pill's entrance and hover scale (classic layout): the rectangle
 *  must never poke out of the disc; `chipMaxScale()` clamps further where
 *  the geometry demands it. */
export const MAX_FINAL_SCALE = DOCK_MAX_SCALE;

export const MAX_VISIBLE = 8;
export const MAX_QUERY_BYTES = 256;

/** Theme: always the dark register. */
export const ACCENT = "#e5e5e5";
export const DISC_FILL = "#000000";

/** Curated group colors, tuned for legibility on the dark disc: every entry
 * passes `isReadableOnDark` (WCAG relative luminance >= 0.2). */
export const GROUP_PALETTE: readonly string[] = [
  "#5e9eff", // blue
  "#64d2ff", // cyan
  "#30d158", // green
  "#ffd60a", // yellow
  "#ff9f0a", // orange
  "#ff7a59", // coral
  "#ff453a", // red
  "#ff375f", // pink
  "#bf5af2", // purple
  "#8a7cff", // violet
];
