import { describe, expect, it } from "vitest";
import {
  DOCK_MAX_SCALE,
  DOCK_RADIUS,
  SELECTION_BOOST,
} from "./constants";
import { chipMaxScale, chipCenter, dockScale } from "./easing";

describe("dockScale", () => {
  const cx = 260;
  const cy = 290;

  it("peaks at DOCK_MAX_SCALE when the cursor is on the chip center", () => {
    expect(dockScale(cx, cy, cx, cy, false)).toBeCloseTo(DOCK_MAX_SCALE, 10);
  });

  it("returns 1 beyond DOCK_RADIUS for an unselected chip", () => {
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
    // Cursor centered between two chips 140px apart (an 8-chip ring).
    const left = dockScale(260, 290, 330, 290, false);
    const right = dockScale(400, 290, 330, 290, false);
    expect(left).toBeCloseTo(right, 10);
    expect(left).toBeGreaterThan(1.04);
  });

  it("keeps the selected chip at SELECTION_BOOST even far from the cursor", () => {
    expect(dockScale(cx, cy, cx + DOCK_RADIUS * 2, cy, true)).toBeCloseTo(
      SELECTION_BOOST,
      10,
    );
  });

  it("lets the hover peak override the selection boost", () => {
    expect(dockScale(cx, cy, cx, cy, true)).toBeCloseTo(DOCK_MAX_SCALE, 10);
  });
});

describe("chipMaxScale", () => {
  it("keeps an 8-chip ring's 3 o'clock chip inside the disc at full hover", () => {
    // 8 chips: the 3 o'clock chip sits at (443, 290), r = 183. Growing it to
    // 1.2x would push its far corner past the disc circle (260px radius).
    const [cx, cy] = chipCenter(2, 8);
    expect(cx).toBeCloseTo(443, 0);
    const capped = chipMaxScale(cx, cy, DOCK_MAX_SCALE);
    expect(capped).toBeLessThan(DOCK_MAX_SCALE);
    // The capped chip's far corner must land exactly on the disc circle.
    const a = 66;
    const b = 20;
    const dist = Math.hypot(a * capped + (cx - 260), b * capped + (cy - 290));
    expect(dist).toBeLessThanOrEqual(260);
    // ...and it is not over-clamped: it still grows past 1.
    expect(capped).toBeGreaterThan(1);
  });

  it("mirrors the clamp for the 9 o'clock chip", () => {
    const [cx, cy] = chipCenter(6, 8);
    const capped = chipMaxScale(cx, cy, DOCK_MAX_SCALE);
    const [rx, ry] = chipCenter(2, 8);
    const right = chipMaxScale(rx, ry, DOCK_MAX_SCALE);
    expect(capped).toBeCloseTo(right, 10);
  });

  it("leaves top/bottom chips of a sparse ring unclamped", () => {
    // 4 chips: the top chip is at (260, 130); its closest rim is ~130px away,
    // far more than 1.2x magnification could reach.
    const [cx, cy] = chipCenter(0, 4);
    expect(chipMaxScale(cx, cy, DOCK_MAX_SCALE)).toBe(DOCK_MAX_SCALE);
  });

  it("leaves a centered chip unclamped", () => {
    expect(chipMaxScale(260, 290, DOCK_MAX_SCALE)).toBe(DOCK_MAX_SCALE);
  });
});
