import { describe, expect, it } from "vitest";
import {
  backspaceCodepoint,
  capUtf8Bytes,
  filterActions,
  groupActions,
  hexLuminance,
  isHexColor,
  isReadableOnDark,
  moveSelection,
  slugify,
  uniqueGroupId,
  type Action,
  type Group,
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

describe("groupActions", () => {
  const A = (name: string, group?: string): Action => ({
    name,
    kind: "url",
    value: `https://${name}.dev`,
    group,
  });
  const names = (src: Action[]): string[] => groupActions(src).map((a) => a.name);

  it("pulls same-group actions together, keeping group first-appearance order", () => {
    expect(names([A("a", "work"), A("b", "dev"), A("c"), A("d", "work"), A("e"), A("f", "dev")])).toEqual([
      "a",
      "d",
      "b",
      "f",
      "c",
      "e",
    ]);
  });

  it("keeps ungrouped actions in their relative order and never splits them", () => {
    expect(names([A("u1"), A("a", "work"), A("u2"), A("b", "work"), A("u3")])).toEqual([
      "u1",
      "a",
      "b",
      "u2",
      "u3",
    ]);
    expect(names([A("a", "work"), A("u1"), A("b", "work"), A("u2")])).toEqual([
      "a",
      "b",
      "u1",
      "u2",
    ]);
  });

  it("is stable within a group", () => {
    expect(names([A("a", "work"), A("u1"), A("b", "work"), A("u2"), A("c", "work")])).toEqual([
      "a",
      "b",
      "c",
      "u1",
      "u2",
    ]);
  });

  it("keeps a list that is already grouped untouched", () => {
    const src = [A("a", "work"), A("b", "work"), A("c"), A("d", "dev")];
    expect(names(src)).toEqual(["a", "b", "c", "d"]);
    expect(names([A("a"), A("b")])).toEqual(["a", "b"]);
  });

  it("groups by the raw group id even when it has no Group entry", () => {
    expect(names([A("a", "ghost"), A("u"), A("b", "ghost")])).toEqual(["a", "b", "u"]);
  });

  it("is a pure function: returns a new array and does not mutate the input", () => {
    const src = [A("a", "work"), A("b", "dev"), A("c")];
    const copy = [...src];
    const out = groupActions(src);
    expect(out).not.toBe(src);
    expect(src).toEqual(copy);
  });

  it("handles empty and single-element lists", () => {
    expect(groupActions([])).toEqual([]);
    expect(names([A("only")])).toEqual(["only"]);
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

describe("groups", () => {
  const groups: Group[] = [
    { id: "work", name: "Work", color: "#5e9eff" },
    { id: "dev", name: "Dev", color: "#30d158" },
  ];

  it("slugify lowercases, strips diacritics and joins with dashes", () => {
    expect(slugify("Dev Tools")).toBe("dev-tools");
    expect(slugify("  Wörk  ")).toBe("work");
    expect(slugify("Über")).toBe("uber");
  });

  it("slugify falls back when nothing slugifiable remains", () => {
    expect(slugify("!!!")).toBe("group");
    expect(slugify("", "custom")).toBe("custom");
  });

  it("uniqueGroupId reuses the slug when free and suffixes otherwise", () => {
    expect(uniqueGroupId(groups, "Social")).toBe("social");
    expect(uniqueGroupId(groups, "Work")).toBe("work-2");
    expect(uniqueGroupId(groups, "Dev")).toBe("dev-2");
  });

  it("isHexColor accepts 6-digit hex only", () => {
    expect(isHexColor("#5e9eff")).toBe(true);
    expect(isHexColor("#5E9EFF")).toBe(true);
    expect(isHexColor("5e9eff")).toBe(false);
    expect(isHexColor("#5e9ef")).toBe(false);
    expect(isHexColor("#5e9eff11")).toBe(false);
    expect(isHexColor("")).toBe(false);
  });

  it("hexLuminance ranks colors by WCAG relative luminance", () => {
    expect(hexLuminance("#000000")).toBe(0);
    expect(hexLuminance("#ffffff")).toBeGreaterThan(0.9);
    expect(hexLuminance("#111113")).toBeLessThan(0.01);
    expect(hexLuminance("#5e9eff")).toBeGreaterThan(0.3);
    expect(hexLuminance("#invalid")).toBe(0);
  });

  it("isReadableOnDark accepts the curated palette and rejects darks", () => {
    for (const hex of ["#5e9eff", "#30d158", "#ff9f0a", "#ff375f", "#bf5af2", "#8a7cff"]) {
      expect(isReadableOnDark(hex)).toBe(true);
    }
    expect(isReadableOnDark("#111113")).toBe(false);
    expect(isReadableOnDark("#0a0a0a")).toBe(false);
    expect(isReadableOnDark("#1b1b1f")).toBe(false);
  });
});
