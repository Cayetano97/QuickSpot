import { describe, expect, it } from "vitest";
import { DICT_KEYS, resolveLanguage, systemLanguage, t } from "./i18n";

/** Set navigator.language for a single test, then restore it. */
function withLanguage(lang: string, fn: () => void): void {
  const nav = navigator as unknown as Record<string, string>;
  const saved = nav.language;
  Object.defineProperty(nav, "language", { value: lang, configurable: true });
  try {
    fn();
  } finally {
    Object.defineProperty(nav, "language", { value: saved, configurable: true });
  }
}

describe("systemLanguage", () => {
  it("detects Spanish from any Spanish variant", () => {
    withLanguage("es-ES", () => expect(systemLanguage()).toBe("es"));
    withLanguage("es-MX", () => expect(systemLanguage()).toBe("es"));
  });

  it("defaults to English for non-Spanish locales", () => {
    withLanguage("fr-FR", () => expect(systemLanguage()).toBe("en"));
    withLanguage("pt-BR", () => expect(systemLanguage()).toBe("en"));
  });
});

describe("resolveLanguage", () => {
  it("honors an explicit override", () => {
    expect(resolveLanguage("en")).toBe("en");
    expect(resolveLanguage("es")).toBe("es");
  });

  it("follows the system language when set to system", () => {
    withLanguage("es", () => expect(resolveLanguage("system")).toBe("es"));
    withLanguage("de-DE", () => expect(resolveLanguage("system")).toBe("en"));
  });
});

describe("t", () => {
  it("returns the string for the requested language", () => {
    expect(t("en", "placeholder")).toBe("Type to search...");
    expect(t("es", "placeholder")).toBe("Escribe para buscar...");
  });

  it("substitutes variables", () => {
    expect(t("es", "deleteAction", { name: "GitHub" })).toBe("Eliminar GitHub");
    expect(t("en", "saveError", { msg: "boom" })).toBe("Couldn't save: boom");
  });

  it("has both languages translated for every key", () => {
    for (const key of DICT_KEYS) {
      expect(t("en", key).length).toBeGreaterThan(0);
      expect(t("es", key)).not.toBe("");
    }
  });
});
