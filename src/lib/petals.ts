/**
 * Petal geometry: the launcher's chips are wedge tiles that fill the disc.
 *
 * Each chip is a rounded annular sector of the ring between `PETAL_INNER_R`
 * and `PETAL_OUTER_R`. The tiles are laid out by COUNT, so any number of
 * actions fills the circle edge to edge: two actions get two halves, eight
 * get eight eighths, and the more actions there are the smaller (thinner)
 * every tile becomes. The centre circle stays free for the control cluster
 * (grip, hub/add, query, minimize). Neighbours are separated by a seam of
 * constant width (`PETAL_GAP`): both sides run parallel to the seam's
 * centre line, so the gutter reads the same at the rim and at the inner
 * edge — a purely angular span would flare toward the rim.
 *
 * Local frame: the element's SVG viewport is the tile's bounding box; the
 * disc centre sits `PETAL_OUTER_R + PAD` below the box top, and the box
 * centre (the rotation/scale pivot) lands on the tile's radial axis at
 * `petalPivotR(total)` from the disc centre — the mid radius for many tiles,
 * sliding toward the centre as a tile wraps. Petal 0 is the 12 o'clock tile;
 * the element's CSS rotation is `index * 360° / total`, so the shape's "up"
 * always points outward.
 *
 * `petalOutline()` produces the rounded sector as structured segments (so
 * the geometry is unit-testable), `petalPath()` serialises it to an SVG path
 * in the element's box coordinates (`PAD` keeps the 1px stroke inside the
 * SVG viewport).
 */
import {
  CENTER_X,
  CENTER_Y,
  PETAL_CORNER,
  PETAL_GAP,
  PETAL_INNER_R,
  PETAL_OUTER_R,
} from "./constants";

const TAU = Math.PI * 2;
const PAD = 1;
/** Radius of the label band's centre line, inward of the tile mid radius. */
const LABEL_R_OFFSET = 12;
/** Slack for hit-testing at the band's edges. */
const HIT_SLACK = 2;

/** Mid radius of the band: the radial line every tile's content rides. */
export const PETAL_MID_R = (PETAL_INNER_R + PETAL_OUTER_R) / 2;

const round2 = (v: number): number => Math.round(v * 100) / 100;

export type PetalSegment =
  | { kind: "arc"; r: number; large: boolean; sweep: 0 | 1; to: readonly [number, number] }
  | { kind: "line"; to: readonly [number, number] };

export interface PetalOutline {
  /** Path start, in box coordinates. */
  from: readonly [number, number];
  segments: readonly PetalSegment[];
  /** Box size; the SVG viewBox is `0 0 w h`. */
  w: number;
  h: number;
  /** Disc centre in box coordinates: body points are R1..R2 away from it. */
  discCenter: readonly [number, number];
  /** Tile corner radius actually used (clamped to the available edge). */
  corner: number;
}

/** Half-angle of a tile's wedge (radians): the seam between neighbours
 *  straddles the wedge's edge, `PETAL_GAP / 2` of it inside each tile. */
function wedgeFor(total: number): number {
  return Math.PI / total;
}

/** How far the tile reaches sideways: the sine of its wedge half-angle,
 *  clamped at the 90° apex (a tile wider than a half-circle — the
 *  single-action ring — reaches its widest point at 3/9 o'clock, not at its
 *  own edges). */
function spreadFor(wedge: number): number {
  return Math.sin(Math.min(wedge, Math.PI / 2));
}

/** The tile's reach relative to the disc centre: `right` is the half-width
 *  (capped at the 3/9 o'clock apex) and `down` is how far below the centre
 *  the outline reaches (negative while the whole tile stays above it). The
 *  deepest point is the inner-edge corner on narrow tiles; once a tile wraps
 *  past a half-circle it is the outer arc, and a full ring reaches a full
 *  radius below the centre. */
function extentsFor(wedge: number): { right: number; down: number } {
  return {
    right: PETAL_OUTER_R * spreadFor(wedge),
    down:
      wedge <= Math.PI / 2
        ? -PETAL_INNER_R * Math.cos(wedge)
        : -PETAL_OUTER_R * Math.cos(wedge),
  };
}

/** The tile's element box. The top edge is always the outer arc at 12
 *  o'clock (every tile contains the point straight ahead), so the disc
 *  centre sits `PETAL_OUTER_R + PAD` below it. */
function boxFor(wedge: number): { w: number; h: number; discY: number } {
  const { right, down } = extentsFor(wedge);
  return {
    w: 2 * right + 2 * PAD,
    h: PETAL_OUTER_R + down + 2 * PAD,
    discY: PETAL_OUTER_R + PAD,
  };
}

/** Distance of a tile's rotation pivot (its box centre) from the disc
 *  centre. It equals the mid radius for many tiles and slides toward the
 *  disc centre as a tile wraps, reaching 0 for the single-action ring whose
 *  box is the full disc. */
export function petalPivotR(total: number): number {
  const { h, discY } = boxFor(wedgeFor(total));
  return discY - h / 2;
}

/**
 * The rounded annular sector of `total` as a clockwise outline.
 *
 * Both sides run parallel to the radial line that splits the seam between
 * two neighbours, each pushed half a gutter into the tile, so the space
 * left between tiles is `PETAL_GAP` wide at every radius.
 *
 * Corner rounding: each of the four corners is a fillet of radius `rc`
 * tangent to the side line AND to the band arc. The fillet circle centre
 * sits `rc` inside the outer circle (or `rc` outside the inner one) and
 * `rc + PETAL_GAP / 2` off the seam's centre line, so the corners never
 * encroach on the gutter. The band arcs end on the rays through the fillet
 * centres, `asin((rc + half) / (R ± rc))` past the seam — the angles below
 * are exact, not the arc-length approximation `rc / R`.
 */
export function petalOutline(total: number): PetalOutline {
  const wedge = wedgeFor(total);
  const { w, h, discY } = boxFor(wedge);
  const cx = w / 2;
  const sinB = Math.sin(wedge);
  const cosB = Math.cos(wedge);
  const half = PETAL_GAP / 2;

  // Where the un-rounded side meets the inner circle: the clamp below keeps
  // the fillets well inside that arc at the largest counts.
  const reachIn = Math.sqrt(PETAL_INNER_R ** 2 - half ** 2);
  const innerArcHalf = Math.atan2(reachIn * sinB - half * cosB, reachIn * cosB + half * sinB);
  const corner = Math.min(
    PETAL_CORNER,
    0.45 * innerArcHalf * PETAL_INNER_R,
    0.45 * (PETAL_OUTER_R - PETAL_INNER_R),
  );

  // Fillet centres: `corner + half` off the seam's centre line and `corner`
  // inside the outer circle / outside the inner one.
  const b = half + corner;
  const tOut = Math.sqrt((PETAL_OUTER_R - corner) ** 2 - b ** 2);
  const tIn = Math.sqrt((PETAL_INNER_R + corner) ** 2 - b ** 2);
  const filletAngle = (t: number): number =>
    Math.atan2(t * sinB - b * cosB, t * cosB + b * sinB);
  const psiOut = filletAngle(tOut);
  const psiIn = filletAngle(tIn);

  const at = (delta: number, r: number): readonly [number, number] => [
    cx + r * Math.sin(delta),
    discY - r * Math.cos(delta),
  ];
  const onSeam = (t: number, lift: number): readonly [number, number] => [
    cx + t * sinB + lift * cosB,
    discY - t * cosB + lift * sinB,
  ];
  const mirror = (p: readonly [number, number]): readonly [number, number] => [w - p[0], p[1]];

  const pOut = onSeam(tOut, -half);
  const pIn = onSeam(tIn, -half);
  const segments: readonly PetalSegment[] = [
    { kind: "arc", r: PETAL_OUTER_R, large: 2 * psiOut > Math.PI, sweep: 1, to: at(psiOut, PETAL_OUTER_R) },
    { kind: "arc", r: corner, large: false, sweep: 1, to: pOut },
    { kind: "line", to: pIn },
    { kind: "arc", r: corner, large: false, sweep: 1, to: at(psiIn, PETAL_INNER_R) },
    { kind: "arc", r: PETAL_INNER_R, large: 2 * psiIn > Math.PI, sweep: 0, to: at(-psiIn, PETAL_INNER_R) },
    { kind: "arc", r: corner, large: false, sweep: 1, to: mirror(pIn) },
    { kind: "line", to: mirror(pOut) },
    { kind: "arc", r: corner, large: false, sweep: 1, to: at(-psiOut, PETAL_OUTER_R) },
  ];

  return { from: at(-psiOut, PETAL_OUTER_R), segments, w, h, discCenter: [cx, discY], corner };
}

/** The tile of `total` petals as an SVG path in box coordinates. */
export function petalPath(total: number): string {
  const { from, segments } = petalOutline(total);
  const parts = [`M ${round2(from[0])} ${round2(from[1])}`];
  for (const seg of segments) {
    const x = round2(seg.to[0]);
    const y = round2(seg.to[1]);
    if (seg.kind === "line") {
      parts.push(`L ${x} ${y}`);
    } else {
      const r = round2(seg.r);
      parts.push(`A ${r} ${r} 0 ${seg.large ? 1 : 0} ${seg.sweep} ${x} ${y}`);
    }
  }
  parts.push("Z");
  return parts.join(" ");
}

export interface PetalLayout {
  index: number;
  total: number;
  /** Tile mid-point in canvas coordinates: the box centre and the pivot of
   *  the element's rotation and scale. */
  cx: number;
  cy: number;
  /** Element box; the SVG viewBox matches it 1:1. */
  w: number;
  h: number;
  /** CSS rotation in degrees: petal 0 upright at 12 o'clock, clockwise. */
  rotation: number;
  /** True when the tile's outward direction points down-ish: flip the
   *  content column 180° so the label never reads upside down. */
  flip: boolean;
  /** The shared tile outline (identical for every petal of a ring). */
  path: string;
  /** Max width for the label at its radial band. */
  labelW: number;
}

export function petalLayout(index: number, total: number): PetalLayout {
  const wedge = wedgeFor(total);
  const { w, h } = boxFor(wedge);
  const step = TAU / total;
  const angle = -Math.PI / 2 + step * index;
  const rotation = (360 / total) * index;
  // The rotation pivot is the box centre: placing it on the tile's radial
  // axis at the pivot radius makes the element rotation sweep the shape
  // along the ring, whatever the box proportions.
  const pivotR = petalPivotR(total);
  const labelW = Math.min(
    160,
    Math.max(48, 2 * (PETAL_MID_R - LABEL_R_OFFSET) * spreadFor(wedge) - 16),
  );
  return {
    index,
    total,
    cx: CENTER_X + Math.cos(angle) * pivotR,
    cy: CENTER_Y + Math.sin(angle) * pivotR,
    w,
    h,
    rotation,
    // Cos of exactly 90°/270° is ±1e-16 in doubles: treat the cardinals as
    // upright so neighbouring tiles never disagree about the flip.
    flip: Math.cos((rotation * Math.PI) / 180) < -1e-6,
    path: petalPath(total),
    labelW,
  };
}

/**
 * The petal under a point, or -1. The band's edges are slack by
 * `HIT_SLACK`; the gutter between two tiles belongs to the nearer one (the
 * angular rounding), so the ring never feels like it has dead wedges.
 */
export function petalAtPointer(x: number, y: number, total: number): number {
  if (total <= 0) return -1;
  const dx = x - CENTER_X;
  const dy = y - CENTER_Y;
  const r = Math.hypot(dx, dy);
  if (r < PETAL_INNER_R - HIT_SLACK || r > PETAL_OUTER_R + HIT_SLACK) return -1;
  // Angle from 12 o'clock, clockwise, in [0, TAU).
  const turn = ((Math.atan2(dx, -dy) % TAU) + TAU) % TAU;
  return Math.round(turn / (TAU / total)) % total;
}
