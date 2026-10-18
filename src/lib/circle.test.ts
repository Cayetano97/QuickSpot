import { describe, expect, it } from "vitest";
import {
  CIRCLE_SIZE_DEFAULT,
  CIRCLE_SIZE_MAX,
  CIRCLE_SIZE_MIN,
  CIRCLE_SIZE_STEP,
  circleScale,
  normalizeCircleSize,
} from "./circle";

describe("normalizeCircleSize", () => {
  it("keeps grid values in range", () => {
    for (let size = CIRCLE_SIZE_MIN; size <= CIRCLE_SIZE_MAX; size += CIRCLE_SIZE_STEP) {
      expect(normalizeCircleSize(size)).toBe(size);
    }
  });

  it("falls back to the default for anything that is not a number", () => {
    expect(normalizeCircleSize(undefined)).toBe(CIRCLE_SIZE_DEFAULT);
    expect(normalizeCircleSize(null)).toBe(CIRCLE_SIZE_DEFAULT);
    expect(normalizeCircleSize("115")).toBe(CIRCLE_SIZE_DEFAULT);
    expect(normalizeCircleSize(Number.NaN)).toBe(CIRCLE_SIZE_DEFAULT);
    expect(normalizeCircleSize(Number.POSITIVE_INFINITY)).toBe(CIRCLE_SIZE_DEFAULT);
    expect(normalizeCircleSize({ size: 115 })).toBe(CIRCLE_SIZE_DEFAULT);
  });

  it("clamps hand-edited values to the window-fit range", () => {
    expect(normalizeCircleSize(40)).toBe(CIRCLE_SIZE_MIN);
    expect(normalizeCircleSize(84)).toBe(CIRCLE_SIZE_MIN);
    expect(normalizeCircleSize(400)).toBe(CIRCLE_SIZE_MAX);
    expect(normalizeCircleSize(125.4)).toBe(CIRCLE_SIZE_MAX);
  });

  it("snaps in-range values to the 5% grid", () => {
    expect(normalizeCircleSize(112)).toBe(110);
    expect(normalizeCircleSize(113)).toBe(115);
    expect(normalizeCircleSize(87.5)).toBe(90);
    expect(normalizeCircleSize(99.9)).toBe(100);
  });

  it("is idempotent", () => {
    for (const raw of [83, 88, 112, 113, 121, 999]) {
      const once = normalizeCircleSize(raw);
      expect(normalizeCircleSize(once)).toBe(once);
    }
  });
});

describe("circleScale", () => {
  it("maps percent to the canvas scale factor", () => {
    expect(circleScale(CIRCLE_SIZE_DEFAULT)).toBe(1);
    expect(circleScale(CIRCLE_SIZE_MIN)).toBe(0.85);
    expect(circleScale(CIRCLE_SIZE_MAX)).toBe(1.25);
  });
});
