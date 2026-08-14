import en from "./locales/en.json";

export interface LocaleMeta {
  label: string;
  translators: string[];
}

/** The translation table of one language, excluding the reserved `_meta` key. */
export type Dict = Omit<typeof en, "_meta">;
export type DictKey = keyof Dict;

const modules = import.meta.glob<Dict & { _meta: LocaleMeta }>("./locales/*.json", {
  eager: true,
  import: "default",
});

/** A language code with a file in `./locales/` (e.g. "en" from en.json).
 * Kept as `string` so adding `fr.json` needs no TypeScript changes; the
 * runtime registry (`LOCALES`) is the single source of truth. */
export type Language = string;
/** What the user can store in the config: an explicit language or the OS one. */
export type StoredLanguage = "system" | Language;

/** code → locale file. Adding `fr.json` is enough to register French. */
export const LOCALES = Object.fromEntries(
  Object.entries(modules).map(([path, locale]) => [
    path.slice(path.lastIndexOf("/") + 1, -".json".length),
    locale,
  ]),
) as Record<Language, Dict & { _meta: LocaleMeta }>;

export interface LanguageInfo {
  code: Language;
  label: string;
  translators: string[];
}

/** Every language with its native label and translator credits. */
export const LANGUAGES: LanguageInfo[] = Object.entries(LOCALES).map(
  ([code, locale]) => ({
    code,
    label: locale._meta.label,
    translators: locale._meta.translators,
  }),
);

/** Every localizable key, shared by all languages. */
export const DICT_KEYS = Object.keys(en).filter((k) => k !== "_meta") as DictKey[];

/** The best available language for the OS, falling back to English. */
export function systemLanguage(): Language {
  if (typeof navigator === "undefined") return "en";
  const nav = navigator.language.toLowerCase();
  for (const lang of LANGUAGES) {
    if (nav === lang.code || nav.startsWith(`${lang.code}-`)) return lang.code;
  }
  return "en";
}

/** Effective UI language: explicit override wins; otherwise the OS language. */
export function resolveLanguage(stored: StoredLanguage): Language {
  if (stored !== "system") return stored in LOCALES ? stored : "en";
  return systemLanguage();
}

export function t(lang: Language, key: DictKey, vars?: Record<string, string>): string {
  const dict = LOCALES[lang] ?? LOCALES.en;
  let s: string = dict[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}
