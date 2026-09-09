import { describe, expect, it } from "vitest";
import { normalizeTheme, resolveTheme, themeColorFor } from "./theme";

describe("normalizeTheme", () => {
  it("keeps known themes", () => {
    expect(normalizeTheme("system")).toBe("system");
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("deep")).toBe("deep");
  });

  it("falls back to system for unknown values", () => {
    expect(normalizeTheme(null)).toBe("system");
    expect(normalizeTheme(undefined)).toBe("system");
    expect(normalizeTheme("")).toBe("system");
    expect(normalizeTheme("sepia")).toBe("system");
    expect(normalizeTheme(42)).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("pins explicit variants regardless of the OS", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("deep", true)).toBe("deep");
    expect(resolveTheme("deep", false)).toBe("deep");
  });

  it("follows the OS when set to system (light stays light, dark stays dark)", () => {
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it("never resolves deep from the system (deep is an explicit opt-in)", () => {
    expect(resolveTheme("system", true)).not.toBe("deep");
    expect(resolveTheme("system", false)).not.toBe("deep");
  });
});

describe("themeColorFor", () => {
  it("matches the disc fill of each theme", () => {
    expect(themeColorFor("light")).toBe("#e8e8ec");
    expect(themeColorFor("dark")).toBe("#0d0d0e");
    expect(themeColorFor("deep")).toBe("#000000");
  });
});
