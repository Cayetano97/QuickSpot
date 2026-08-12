import { describe, expect, it } from "vitest";
import {
  DOCK_MAX_SCALE,
  DOCK_RADIUS,
  SELECTION_BOOST,
} from "./constants";
import { dockScale } from "./easing";

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
