import { describe, expect, it } from "vitest";
import {
  DICT_KEYS,
  LANGUAGES,
  LOCALES,
  resolveLanguage,
  systemLanguage,
  t,
} from "./i18n";
import en from "./locales/en.json";

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

/** GitHub username: 1–39 chars, alphanumeric or hyphen, no leading/trailing hyphen. */
const GITHUB_USERNAME = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

/** The `{var}` placeholders a translation uses, sorted for comparison. */
function interpolationVars(s: string): string[] {
  return Array.from(s.matchAll(/\{(\w+)\}/g), (m) => m[1]).sort();
}

/** The translation keys of a locale, excluding the reserved `_meta` block. */
function dictKeys(code: string): string[] {
  return Object.keys(LOCALES[code]).filter((k) => k !== "_meta").sort();
}

describe("systemLanguage", () => {
  it("detects Spanish from any Spanish variant", () => {
    withLanguage("es-ES", () => expect(systemLanguage()).toBe("es"));
    withLanguage("es-MX", () => expect(systemLanguage()).toBe("es"));
  });

  it("detects English from any English variant", () => {
    withLanguage("en-US", () => expect(systemLanguage()).toBe("en"));
    withLanguage("en-GB", () => expect(systemLanguage()).toBe("en"));
  });

  it("defaults to English for locales without a translation", () => {
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

  it("falls back to English for an unknown code", () => {
    expect(resolveLanguage("fr")).toBe("en");
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

  it("falls back to English for an unknown language", () => {
    expect(t("zz", "placeholder")).toBe("Type to search...");
  });
});

describe("locale parity", () => {
  it("every locale covers exactly the keys English covers", () => {
    for (const lang of LANGUAGES) {
      expect(dictKeys(lang.code)).toEqual(DICT_KEYS.slice().sort());
    }
  });

  it("every locale translates every key into a non-empty string", () => {
    for (const lang of LANGUAGES) {
      for (const key of DICT_KEYS) {
        expect(LOCALES[lang.code][key].trim(), `${lang.code}.${key}`).not.toBe("");
      }
    }
  });

  it("every locale uses the same interpolation variables as English", () => {
    for (const lang of LANGUAGES) {
      for (const key of DICT_KEYS) {
        expect(interpolationVars(LOCALES[lang.code][key]), `${lang.code}.${key}`).toEqual(
          interpolationVars(LOCALES.en[key]),
        );
      }
    }
  });
});

describe("locale meta", () => {
  it("every locale declares a native label", () => {
    for (const lang of LANGUAGES) {
      expect(LOCALES[lang.code]._meta.label.trim(), lang.code).not.toBe("");
    }
  });

  it("every locale except the owner-maintained core ones credits at least one translator", () => {
    const ownerMaintained = new Set(["en", "es"]);
    for (const lang of LANGUAGES) {
      const translators = LOCALES[lang.code]._meta.translators;
      expect(Array.isArray(translators), `${lang.code} translators`).toBe(true);
      for (const name of translators) {
        expect(name, `${lang.code} translator`).toMatch(GITHUB_USERNAME);
      }
      if (!ownerMaintained.has(lang.code)) {
        expect(translators.length, `${lang.code} translators`).toBeGreaterThan(0);
      }
    }
  });

  it("en is the reference locale", () => {
    expect(en._meta.label).toBe("English");
  });
});
