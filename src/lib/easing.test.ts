import { describe, expect, it } from "vitest";
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
  PETAL_OUTER_R,
  PILL_DOCK_RADIUS,
  SELECTION_BOOST,
} from "./constants";
import {
  chipCenter,
  chipMaxScale,
  dockScale,
  orbitAngle,
  orbitRadius,
  petalHoverScale,
} from "./easing";
import { PETAL_MID_R } from "./petals";

describe("dockScale", () => {
  const cx = 260;
  const cy = 290;

  it("peaks at DOCK_MAX_SCALE when the cursor is on the tile centre", () => {
    expect(dockScale(cx, cy, cx, cy, false)).toBeCloseTo(DOCK_MAX_SCALE, 10);
  });

  it("returns 1 beyond DOCK_RADIUS for an unselected tile", () => {
    expect(dockScale(cx, cy, cx + DOCK_RADIUS, cy, false)).toBe(1);
    expect(dockScale(cx, cy, cx + DOCK_RADIUS * 2, cy, false)).toBe(1);
  });

  it("falls off smoothly and monotonically with distance", () => {
    const near = dockScale(cx, cy, cx, cy, false);
    const mid = dockScale(cx, cy, cx + DOCK_RADIUS / 2, cy, false);
    const far = dockScale(cx, cy, cx + DOCK_RADIUS, cy, false);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(mid).toBeGreaterThan(1);
  });

  it("raises the two neighbours of a midpoint equally (the dock wave)", () => {
    // Cursor centered between two petal centres 80px apart.
    const left = dockScale(260, 290, 300, 290, false);
    const right = dockScale(340, 290, 300, 290, false);
    expect(left).toBeCloseTo(right, 10);
    expect(left).toBeGreaterThan(1.04);
  });

  it("keeps the selected tile at SELECTION_BOOST even far from the cursor", () => {
    expect(dockScale(cx, cy, cx + DOCK_RADIUS * 2, cy, true)).toBeCloseTo(
      SELECTION_BOOST,
      10,
    );
  });

  it("lets the hover peak override the selection boost", () => {
    expect(dockScale(cx, cy, cx, cy, true)).toBeCloseTo(DOCK_MAX_SCALE, 10);
  });
});

describe("petalHoverScale", () => {
  const cx = 260;
  const cy = 290;

  it("peaks at PETAL_HOVER_PEAK under the cursor", () => {
    expect(petalHoverScale(cx, cy, cx, cy, false)).toBeCloseTo(PETAL_HOVER_PEAK, 10);
  });

  it("stays at rest beyond the wave's reach", () => {
    expect(petalHoverScale(cx, cy, cx + DOCK_RADIUS * 2, cy, false)).toBe(1);
  });

  it("lifts the selected tile to SELECTION_BOOST when the cursor is away", () => {
    expect(petalHoverScale(cx, cy, cx + DOCK_RADIUS * 2, cy, true)).toBeCloseTo(
      SELECTION_BOOST,
      10,
    );
  });

  it("never exceeds the peak, even with the selected floor and a full wave", () => {
    expect(petalHoverScale(cx, cy, cx, cy, true)).toBeCloseTo(PETAL_HOVER_PEAK, 10);
    expect(PETAL_HOVER_PEAK).toBeGreaterThanOrEqual(SELECTION_BOOST);
  });

  it("keeps a fully magnified tile inside the tray", () => {
    // The outermost tile edge sits `PETAL_OUTER_R` from the disc centre and
    // scales about the tile's mid radius; the tray's rim is DISC_RADIUS.
    const grown = PETAL_MID_R + (PETAL_OUTER_R - PETAL_MID_R) * PETAL_HOVER_PEAK;
    expect(grown).toBeLessThan(DISC_RADIUS);
  });
});

describe("pill orbit (classic layout)", () => {
  it("starts at 12 o'clock and walks clockwise in equal steps", () => {
    expect(orbitAngle(0, 4)).toBeCloseTo(-Math.PI / 2, 10);
    expect(orbitAngle(1, 4) - orbitAngle(0, 4)).toBeCloseTo(Math.PI / 2, 10);
  });

  it("keeps the base radius until the pills would touch, then grows", () => {
    expect(orbitRadius(4)).toBeCloseTo(ORBIT_RADIUS, 10);
    expect(orbitRadius(8)).toBeGreaterThan(ORBIT_RADIUS);
    expect(orbitRadius(8)).toBeCloseTo(
      (CHIP_W + CHIP_GAP) / (2 * Math.sin(Math.PI / 8)),
      10,
    );
  });

  it("places every pill centre on the orbit circle", () => {
    for (const total of [1, 2, 5, 8]) {
      const radius = orbitRadius(total);
      for (let index = 0; index < total; index++) {
        const [cx, cy] = chipCenter(index, total);
        expect(Math.hypot(cx - CENTER_X, cy - CENTER_Y)).toBeCloseTo(radius, 8);
      }
    }
  });

  it("clamps the scale so a pill never pokes out of the disc", () => {
    // The 3/9 o'clock pill of a full ring sits closest to the rim.
    const [cx, cy] = chipCenter(2, 8);
    const max = chipMaxScale(cx, cy, DOCK_MAX_SCALE);
    expect(max).toBeLessThan(DOCK_MAX_SCALE);
    const corner = Math.hypot(
      Math.abs(cx - CENTER_X) + (CHIP_W / 2) * max,
      (CHIP_H / 2) * max,
    );
    expect(corner).toBeLessThanOrEqual(DISC_RADIUS + 1e-9);
    // A pill at the disc centre never needs clamping.
    expect(chipMaxScale(CENTER_X, CENTER_Y, 1.1)).toBeCloseTo(1.1, 10);
  });

  it("gives the pills dock wave the classic 100px reach", () => {
    expect(
      dockScale(CENTER_X, CENTER_Y, CENTER_X + 80, CENTER_Y, false, PILL_DOCK_RADIUS),
    ).toBeGreaterThan(1);
    // Beyond the pills' reach with the petal default, still swelling with
    // the classic one: the two layouts keep their own feel.
    expect(dockScale(CENTER_X, CENTER_Y, CENTER_X + 80, CENTER_Y, false)).toBe(1);
  });
});
