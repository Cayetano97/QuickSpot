/**
 * Petal geometry guard.
 *
 * The launcher's chips are wedge tiles that fill the disc: these tests pin
 * the invariants that keep the layout honest at every action count:
 * - every tile is a closed, symmetric rounded sector inside the band,
 * - neighbours keep a seam of constant width: equal at the rim and at the
 *   inner edge, never flaring with the radius,
 * - more actions make every tile smaller (the ring always uses the circle),
 * - the band's inner edge clears the centre control cluster and the outer
 *   edge stays inside the tray (WCAG 1.4.11: tiles never merge with chrome),
 * - hit-testing maps a point to the nearest tile and nothing outside the
 *   band.
 */
import { describe, expect, it } from "vitest";
import {
  CENTER_X,
  CENTER_Y,
  DISC_RADIUS,
  GRIP_H,
  GRIP_W,
  GRIP_Y,
  HUB_X,
  HUB_Y,
  MINIMIZE_H,
  MINIMIZE_Y,
  PETAL_GAP,
  PETAL_HOVER_PEAK,
  PETAL_INNER_R,
  PETAL_OUTER_R,
  QUERY_H,
  QUERY_W,
  QUERY_Y,
  SELECTION_BOOST,
} from "./constants";
import {
  PETAL_MID_R,
  petalAtPointer,
  petalLayout,
  petalOutline,
  petalPath,
  petalPivotR,
} from "./petals";

const TOTALS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 20];

const dist = (p: readonly [number, number], q: readonly [number, number]): number =>
  Math.hypot(p[0] - q[0], p[1] - q[1]);

describe("petalOutline", () => {
  it("stays inside the annulus and the element box at every count", () => {
    for (const total of TOTALS) {
      const outline = petalOutline(total);
      const points: Array<readonly [number, number]> = [
        outline.from,
        ...outline.segments.map((s) => s.to),
      ];
      for (const p of points) {
        const r = dist(p, outline.discCenter);
        expect(r).toBeGreaterThanOrEqual(PETAL_INNER_R - 0.01);
        expect(r).toBeLessThanOrEqual(PETAL_OUTER_R + 0.01);
        expect(p[0]).toBeGreaterThanOrEqual(0);
        expect(p[0]).toBeLessThanOrEqual(outline.w);
        expect(p[1]).toBeGreaterThanOrEqual(0);
        expect(p[1]).toBeLessThanOrEqual(outline.h);
      }
    }
  });

  it("lands the band arcs exactly on their circles", () => {
    for (const total of TOTALS) {
      const outline = petalOutline(total);
      for (const seg of outline.segments) {
        if (seg.kind !== "arc") continue;
        if (seg.r !== PETAL_INNER_R && seg.r !== PETAL_OUTER_R) continue;
        expect(dist(seg.to, outline.discCenter)).toBeCloseTo(seg.r, 9);
      }
    }
  });

  it("closes the outline and mirrors it across the radial axis", () => {
    for (const total of TOTALS) {
      const outline = petalOutline(total);
      const points: Array<readonly [number, number]> = [
        outline.from,
        ...outline.segments.map((s) => s.to),
      ];
      const last = outline.segments[outline.segments.length - 1];
      expect(last.to[0]).toBeCloseTo(outline.from[0], 9);
      expect(last.to[1]).toBeCloseTo(outline.from[1], 9);
      for (const p of points) {
        const mirrored = points.some(
          (q) => Math.abs(q[0] - (outline.w - p[0])) < 0.01 && Math.abs(q[1] - p[1]) < 0.01,
        );
        expect(mirrored).toBe(true);
      }
    }
  });

  it("keeps the seam between neighbours a constant width", () => {
    for (const total of TOTALS) {
      const outline = petalOutline(total);
      const points: Array<readonly [number, number]> = [
        outline.from,
        ...outline.segments.map((s) => s.to),
      ];
      outline.segments.forEach((seg, i) => {
        if (seg.kind !== "line") return;
        const a = points[i];
        // Distance from the disc centre to the side line: half the gutter,
        // at every count and at every point along the side. A radial side
        // would pass through the centre (distance 0) and the seam would
        // flare with the radius.
        const cross =
          (seg.to[0] - a[0]) * (outline.discCenter[1] - a[1]) -
          (seg.to[1] - a[1]) * (outline.discCenter[0] - a[0]);
        expect(Math.abs(cross) / dist(a, seg.to)).toBeCloseTo(PETAL_GAP / 2, 6);
      });
    }
  });

  it("serialises to a closed path with rounded corners and no NaN", () => {
    for (const total of TOTALS) {
      const outline = petalOutline(total);
      const path = petalPath(total);
      expect(path).not.toContain("NaN");
      expect(path.startsWith("M ")).toBe(true);
      expect(path.endsWith("Z")).toBe(true);
      expect(outline.corner).toBeGreaterThan(0);
      // Four band-arcs + four corner fillets + two radial sides.
      expect(outline.segments).toHaveLength(8);
      expect(outline.segments.filter((s) => s.kind === "line")).toHaveLength(2);
    }
  });
});

describe("petalLayout", () => {
  it("spaces the tiles evenly around the ring, petal 0 at 12 o'clock", () => {
    for (const total of [2, 3, 4, 5, 6, 7, 8]) {
      for (let i = 0; i < total; i++) {
        const layout = petalLayout(i, total);
        expect(layout.rotation).toBeCloseTo((360 / total) * i, 9);
        expect(dist([layout.cx, layout.cy], [CENTER_X, CENTER_Y])).toBeCloseTo(
          petalPivotR(total),
          9,
        );
      }
      const first = petalLayout(0, total);
      expect(first.cx).toBeCloseTo(CENTER_X, 9);
      expect(first.cy).toBeCloseTo(CENTER_Y - petalPivotR(total), 9);
    }
  });

  it("flips the content column on the lower half only", () => {
    const flips = Array.from({ length: 8 }, (_, i) => petalLayout(i, 8).flip);
    expect(flips).toEqual([false, false, false, true, true, true, false, false]);
  });

  it("shrinks every tile as actions are added", () => {
    const widths = TOTALS.map((total) => petalLayout(0, total).w);
    // The single-action ring's box is the whole disc and two halves tile the
    // same square, so the first step ties; every later step shrinks.
    expect(widths[1]).toBeLessThanOrEqual(widths[0]);
    for (let i = 2; i < widths.length; i++) {
      expect(widths[i]).toBeLessThan(widths[i - 1]);
    }
    const spans = TOTALS.map((total) => (2 * Math.PI) / total);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]).toBeLessThan(spans[i - 1]);
    }
  });

  it("keeps every tile inside the tray at full magnification", () => {
    const peak = Math.max(PETAL_HOVER_PEAK, SELECTION_BOOST);
    for (const total of TOTALS) {
      const pivot = petalPivotR(total);
      // Scaling about the pivot moves the outer edge along its own radius.
      const outer = pivot + (PETAL_OUTER_R - pivot) * peak;
      expect(outer).toBeLessThan(DISC_RADIUS);
    }
  });

  it("shares one outline across a ring but a new one per count", () => {
    for (const total of [3, 8]) {
      const a = petalLayout(0, total);
      const b = petalLayout(total - 1, total);
      expect(a.path).toBe(b.path);
      expect(a.w).toBe(b.w);
      expect(a.h).toBe(b.h);
    }
    expect(petalLayout(0, 3).path).not.toBe(petalLayout(0, 8).path);
  });

  it("keeps the label width inside its band", () => {
    for (const total of TOTALS) {
      const { labelW } = petalLayout(0, total);
      expect(labelW).toBeGreaterThanOrEqual(48);
      expect(labelW).toBeLessThanOrEqual(160);
    }
  });
});

describe("petal band clearance", () => {
  /** Farthest corner of a centred box control from the disc centre. */
  const reach = (cx: number, cy: number, w: number, h: number): number =>
    Math.hypot(
      Math.abs(cx - CENTER_X) + w / 2,
      Math.abs(cy - CENTER_Y) + h / 2,
    );

  it("keeps every centre control inside the free circle", () => {
    const controls = [
      reach(CENTER_X, GRIP_Y + GRIP_H / 2, GRIP_W, GRIP_H),
      reach(HUB_X, HUB_Y + 18, 36, 36), // settings gear (36px)
      reach(HUB_X - 44, HUB_Y + 18, 36, 36), // add button
      reach(CENTER_X, QUERY_Y + QUERY_H / 2, QUERY_W, QUERY_H), // query at rest
      reach(CENTER_X, MINIMIZE_Y + MINIMIZE_H / 2, 36, MINIMIZE_H),
    ];
    for (const r of controls) expect(r).toBeLessThan(PETAL_INNER_R);
  });

  it("keeps the tile band inside the tray", () => {
    expect(PETAL_OUTER_R).toBeLessThan(DISC_RADIUS);
  });
});

describe("petalAtPointer", () => {
  it("maps the four cardinal points to their tiles", () => {
    const r = PETAL_MID_R;
    expect(petalAtPointer(CENTER_X, CENTER_Y - r, 8)).toBe(0);
    expect(petalAtPointer(CENTER_X + r, CENTER_Y, 8)).toBe(2);
    expect(petalAtPointer(CENTER_X, CENTER_Y + r, 8)).toBe(4);
    expect(petalAtPointer(CENTER_X - r, CENTER_Y, 8)).toBe(6);
  });

  it("rejects the centre circle and everything outside the band", () => {
    expect(petalAtPointer(CENTER_X, CENTER_Y, 8)).toBe(-1);
    expect(petalAtPointer(CENTER_X + 50, CENTER_Y, 8)).toBe(-1);
    expect(petalAtPointer(CENTER_X, CENTER_Y + 300, 8)).toBe(-1);
    expect(petalAtPointer(CENTER_X, CENTER_Y - 400, 8)).toBe(-1);
    expect(petalAtPointer(0, 0, 8)).toBe(-1);
  });

  it("wraps around 12 o'clock", () => {
    const up = PETAL_MID_R * Math.cos(0.05);
    const r = PETAL_MID_R;
    expect(petalAtPointer(CENTER_X + r * Math.sin(-0.05), CENTER_Y - up, 8)).toBe(0);
    expect(petalAtPointer(CENTER_X + r * Math.sin(0.05), CENTER_Y - up, 8)).toBe(0);
  });

  it("gives the gutter to the nearer tile", () => {
    const r = PETAL_MID_R;
    const at = (deg: number): number =>
      petalAtPointer(
        CENTER_X + r * Math.sin((deg * Math.PI) / 180),
        CENTER_Y - r * Math.cos((deg * Math.PI) / 180),
        8,
      );
    // Boundaries between tiles of an octant sit at 22.5°, 67.5°, ...
    expect(at(21)).toBe(0);
    expect(at(24)).toBe(1);
    expect(at(66)).toBe(1);
    expect(at(69)).toBe(2);
  });

  it("handles the single-tile ring and the empty ring", () => {
    expect(petalAtPointer(CENTER_X, CENTER_Y - PETAL_MID_R, 1)).toBe(0);
    expect(petalAtPointer(CENTER_X + 200, CENTER_Y + 100, 1)).toBe(0);
    expect(petalAtPointer(CENTER_X, CENTER_Y - PETAL_MID_R, 0)).toBe(-1);
  });
});
