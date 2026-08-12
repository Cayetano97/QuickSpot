import { describe, expect, it } from "vitest";
import {
  backspaceCodepoint,
  capUtf8Bytes,
  filterActions,
  moveSelection,
  type Action,
} from "./model";

const actions: Action[] = [
  { name: "Vercel", kind: "url", value: "https://vercel.com" },
  { name: "GitHub", kind: "url", value: "https://github.com" },
  { name: "Native SDK docs", kind: "url", value: "https://native-sdk.dev" },
  { name: "Reload (use tray)", kind: "command", value: "echo hello" },
];

describe("filterActions", () => {
  it("narrows by case-insensitive substring", () => {
    expect(filterActions(actions, "g")).toEqual([1]);
    expect(filterActions(actions, "G")).toEqual([1]);
    expect(filterActions(actions, "n")).toEqual([2]);
  });

  it("keeps config order and never reorders", () => {
    expect(filterActions(actions, "")).toEqual([0, 1, 2, 3]);
    expect(filterActions(actions, "o")).toEqual([2, 3]);
  });

  it("caps at MAX_VISIBLE (8) matches", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      name: `item${i}`,
      kind: "url" as const,
      value: `https://example.com/${i}`,
    }));
    expect(filterActions(many, "item")).toHaveLength(8);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterActions(actions, "zzz")).toEqual([]);
  });
});

describe("moveSelection", () => {
  it("steps forward and wraps to 0", () => {
    let sel = 0;
    for (let expected = 0; expected < 4; expected++) {
      expect(sel).toBe(expected);
      sel = moveSelection(sel, 4, 1);
    }
    expect(sel).toBe(0);
  });

  it("wraps backward to the last", () => {
    expect(moveSelection(0, 4, -1)).toBe(3);
  });

  it("is safe with an empty list", () => {
    expect(moveSelection(0, 0, 1)).toBe(0);
  });

  it("steps forward from no selection to the first", () => {
    expect(moveSelection(-1, 4, 1)).toBe(0);
  });

  it("steps backward from no selection to the last", () => {
    expect(moveSelection(-1, 4, -1)).toBe(3);
  });

  it("handles no selection with a single item", () => {
    expect(moveSelection(-1, 1, 1)).toBe(0);
    expect(moveSelection(-1, 1, -1)).toBe(0);
  });
});

describe("backspaceCodepoint", () => {
  it("removes one full codepoint (surrogate pairs)", () => {
    expect(backspaceCodepoint("git")).toBe("gi");
    expect(backspaceCodepoint("g🪐t")).toBe("g🪐");
    expect(backspaceCodepoint("")).toBe("");
  });
});

describe("capUtf8Bytes", () => {
  it("keeps short strings untouched", () => {
    expect(capUtf8Bytes("hi", 256)).toBe("hi");
  });

  it("truncates without splitting a codepoint", () => {
    const s = "🪐".repeat(100); // 4 bytes each
    const capped = capUtf8Bytes(s, 6);
    expect(new TextEncoder().encode(capped).length).toBeLessThanOrEqual(6);
    expect([...capped].every((c) => c === "🪐")).toBe(true);
  });
});
