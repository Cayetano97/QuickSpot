/** Canvas geometry (logical px). Window is 520x580, disc is centered. */
export const CANVAS_W = 520;
export const CANVAS_H = 580;

export const CENTER_X = CANVAS_W / 2;
export const CENTER_Y = CANVAS_H / 2;

export const DISC_RADIUS = 260;
export const DISC_Y = (CANVAS_H - DISC_RADIUS * 2) / 2;

export const HUB_SIZE = 64;

export const ORBIT_RADIUS = 160;
export const CHIP_W = 132;
export const CHIP_H = 40;
/** Extra breathing room between adjacent chips when the orbit grows. */
export const CHIP_GAP = 8;

export const MINIMIZE_H = 36;

/** Query pill: centered. */
export const QUERY_W = 136;
export const QUERY_H = 32;
export const QUERY_Y = 264;

/** Vertical stack: settings on top, query in the middle, minimize below. */
export const HUB_Y = QUERY_Y - 50;
export const MINIMIZE_Y = QUERY_Y + QUERY_H + 14;

export const GRIP_W = 96;
export const GRIP_H = 24;
export const GRIP_Y = 52;
export const GRIP_RADIUS = 8;

/** Animation timing (ms) and easing constants. */
export const OPEN_MS = 220;
export const CLOSE_MS = 150;
export const STAGGER_FRAC = 0.22;

/** How long an execution error stays visible on the query line (ms). */
export const RUN_ERROR_MS = 3500;

/** Dock-style hover magnification (macOS fisheye). The effect only kicks in
 * when the cursor is close to the chip ring: the orbit sits at 160px from the
 * center, so with 100 the central zone (gear, query, grip) stays untouched. */
export const DOCK_RADIUS = 100;
export const DOCK_MAX_SCALE = 1.2;
export const SELECTION_BOOST = 1.05;
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
