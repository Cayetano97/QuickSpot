/** Appearance theme for the overlay.
 * - `light`: light register (white panels, light-gray disc) for bright rooms.
 * - `dark`: elevated-gray dark default (Linear/Spotify-style stack).
 * - `deep`: OLED true-black variant for dark rooms.
 * `system` follows the OS via `prefers-color-scheme` (light -> `light`,
 * dark -> `dark`); `deep` is always an explicit opt-in pin. */
export type StoredTheme = "system" | "light" | "dark" | "deep";
export type EffectiveTheme = "light" | "dark" | "deep";

export const THEMES: readonly StoredTheme[] = ["system", "light", "dark", "deep"] as const;

export function isStoredTheme(value: unknown): value is StoredTheme {
  return value === "system" || value === "light" || value === "dark" || value === "deep";
}

/** Normalize a persisted value; unknown/empty falls back to `system`. */
export function normalizeTheme(value: unknown): StoredTheme {
  return isStoredTheme(value) ? value : "system";
}

/** Resolve the effective theme. `prefersDark` is `matchMedia("(prefers-color-scheme: dark)").matches`. */
export function resolveTheme(stored: StoredTheme, prefersDark: boolean): EffectiveTheme {
  if (stored === "light" || stored === "dark" || stored === "deep") return stored;
  return prefersDark ? "dark" : "light";
}

/** `true` when the OS prefers a dark color scheme (SSR/jsdom-safe). */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Theme-color meta per effective theme (matches the disc fill). */
export function themeColorFor(effective: EffectiveTheme): string {
  switch (effective) {
    case "light":
      return "#e8e8ec";
    case "deep":
      return "#000000";
    default:
      return "#0d0d0e";
  }
}
