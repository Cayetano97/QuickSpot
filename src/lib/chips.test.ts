import { describe, expect, it } from "vitest";
import { CHIP_MODES, normalizeChipMode } from "./chips";

describe("normalizeChipMode", () => {
  it("keeps the known layouts", () => {
    expect(normalizeChipMode("ring")).toBe("ring");
    expect(normalizeChipMode("pills")).toBe("pills");
  });

  it("falls back to the default ring for anything else", () => {
    expect(normalizeChipMode(undefined)).toBe("ring");
    expect(normalizeChipMode(null)).toBe("ring");
    expect(normalizeChipMode("")).toBe("ring");
    expect(normalizeChipMode("wheel")).toBe("ring");
    expect(normalizeChipMode(7)).toBe("ring");
  });
});

describe("CHIP_MODES", () => {
  it("lists every selectable layout once, default first", () => {
    expect(CHIP_MODES).toEqual(["ring", "pills"]);
    expect(new Set(CHIP_MODES).size).toBe(CHIP_MODES.length);
    for (const mode of CHIP_MODES) expect(normalizeChipMode(mode)).toBe(mode);
  });
});
