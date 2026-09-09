/**
 * WCAG 2.1 contrast guard for the three QuickSpot themes.
 *
 * Reads the single source of truth (`src/style.css`), extracts the custom
 * properties of each `:root[data-theme=...]` block and asserts:
 * - SC 1.4.3 (Contrast Minimum, AA): every text pair >= 4.5:1.
 * - SC 1.4.11 (Non-text Contrast, AA): every essential control boundary
 *   (inputs, panel/card/chip borders, switch, grip, scrollbars, focus and
 *   selection rings) >= 3:1.
 *
 * Deliberately NOT asserted (documented decorative/redundant cues, each
 * backed by a passing text/aria cue):
 * - hairline dividers and toolbar/count/badge borders: pure decoration,
 *   structure comes from headings and label text (>= 4.5:1).
 * - hover-only fills (row-hover, tab hover, update hover): the pointer
 *   position is the cue; resting state already passes.
 * - update-ink border and tab selected ring: redundant with the passing
 *   pill text / tab label + `aria-selected`.
 * - per-field invalid borders on dark/deep: redundant with the card-level
 *   invalid border (>= 3.4:1) and the error message text (>= 6:1).
 * - disabled controls: exempt per Understanding 1.4.3 (inactive components).
 * - group color accents (dots, icon tint, fills): redundant with the always
 *   present `--accent` label text; the light theme additionally darkens the
 *   icon tint to >= 3.3:1 for the full palette.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Single source of truth: parse the shipped stylesheet (node environment,
// so `fs` is available). If a token changes, this guard follows it.
const styleCss = readFileSync(new URL("../style.css", import.meta.url), "utf8");

type ThemeName = "dark" | "deep" | "light";

function themeVars(theme: ThemeName): Record<string, string> {
  const pattern =
    theme === "dark"
      ? /:root,\s*:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/m
      : new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
  const match = styleCss.match(pattern);
  if (!match) throw new Error(`theme block not found: ${theme}`);
  const out: Record<string, string> = {};
  for (const [, name, value] of match[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  // `color-scheme` is a real property, not a custom property: capture it too.
  const scheme = match[1].match(/^\s*color-scheme\s*:\s*([^;]+);/m);
  if (scheme) out["color-scheme"] = scheme[1].trim();
  // Resolve one level of var() references (e.g. --grip-ink: var(--accent)).
  for (const [name, value] of Object.entries(out)) {
    const ref = value.match(/^var\((--[\w-]+)\)$/);
    if (ref) out[name] = out[ref[1].slice(2)] ?? value;
  }
  return out;
}

function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().toLowerCase();
  if (!h.startsWith("#")) throw new Error(`not a hex color: ${hex}`);
  h = h.slice(1);
  if (h.length === 3) h = h
    .split("")
    .map((c) => c + c)
    .join("");
  if (h.length !== 6) throw new Error(`unsupported hex color: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number): number =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.1 relative-luminance contrast ratio between two hex colors. */
export function contrastRatio(a: string, b: string): number {
  const l1 = luminance(parseHex(a));
  const l2 = luminance(parseHex(b));
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const V = (v: Record<string, string>, name: string): string => {
  const value = v[name];
  if (!value || !value.startsWith("#")) throw new Error(`missing color var: ${name}`);
  return value;
};

/** [textVar, backgroundVar, where the pair is used] — must reach 4.5:1. */
const TEXT_PAIRS: Array<[string, string, string]> = [
  ["accent", "disc", "chips/query on the disc"],
  ["accent", "panel-fill", "dialog titles and labels"],
  ["accent", "chip-fill", "chip labels and buttons"],
  ["accent", "field-fill", "input text"],
  ["accent", "query-fill", "query pill and caret"],
  ["accent", "inset-fill", "group/step block text"],
  ["accent", "popover-fill", "picker options"],
  ["accent", "picker-fill", "app picker rows"],
  ["ink-dim", "disc", "empty state"],
  ["ink-dim", "panel-fill", "section captions"],
  ["ink-dim", "chip-fill", "count badges and cards"],
  ["ink-dim", "field-fill", "secondary text in fields"],
  ["ink-dim", "inset-fill", "block captions"],
  ["ink-dim", "tabs-fill", "unselected tabs"],
  ["ink-muted", "disc", "secondary disc text"],
  ["ink-muted", "panel-fill", "translator credits"],
  ["ink-faint", "disc", "faint disc metadata"],
  ["ink-faint", "panel-fill", "version caption"],
  ["placeholder", "field-fill", "input placeholders"],
  ["placeholder-quiet", "picker-fill", "picker empty state"],
  ["error-ink", "disc", "run error on the disc"],
  ["error-ink", "panel-fill", "form error messages"],
  ["update-ink", "update-fill", "update pill label"],
  ["disc", "accent-hover", "primary button label on hover"],
  ["disc", "accent", "primary button label and switch knob"],
];

/** [borderVar, surfaceVar, control] — must reach 3:1. */
const UI_PAIRS: Array<[string, string, string]> = [
  ["ghost-border", "field-fill", "text input boundary"],
  ["ghost-border", "panel-fill", "card and button boundary"],
  ["ghost-border", "chip-fill", "settings row boundary"],
  ["chip-border", "chip-fill", "chip boundary"],
  ["panel-border", "panel-fill", "dialog boundary"],
  ["query-border", "query-fill", "search field boundary"],
  ["switch-border", "switch-off", "switch track boundary"],
  ["switch-border", "panel-fill", "switch track on dialog"],
  ["grip-border", "disc", "drag handle boundary"],
  ["scroll-thumb", "panel-fill", "scrollbar thumb"],
  ["scroll-thumb-small", "popover-fill", "picker scrollbar thumb"],
  ["option-ring", "ghost-fill-active", "keyboard-active option ring"],
  ["swatch-border", "inset-fill", "color swatch boundary"],
  ["dashed-border", "panel-fill", "creation row boundary"],
  ["hover-border", "row-hover", "hovered row boundary"],
];

const THEMES: ThemeName[] = ["dark", "deep", "light"];

describe("theme blocks", () => {
  it("defines all three themes with the right color-scheme", () => {
    for (const theme of THEMES) {
      const vars = themeVars(theme);
      expect(vars["color-scheme"], `${theme} color-scheme`).toBe(
        theme === "light" ? "light" : "dark",
      );
      expect(vars["disc"], `${theme} disc`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("WCAG 1.4.3 text contrast >= 4.5:1", () => {
  for (const theme of THEMES) {
    it(`${theme}: all text pairs pass`, () => {
      const vars = themeVars(theme);
      for (const [fg, bg, where] of TEXT_PAIRS) {
        const ratio = contrastRatio(V(vars, fg), V(vars, bg));
        expect(ratio, `${theme} ${fg}/${bg} (${where}): ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    });
  }
});

describe("WCAG 1.4.11 non-text contrast >= 3:1", () => {
  for (const theme of THEMES) {
    it(`${theme}: all control boundaries pass`, () => {
      const vars = themeVars(theme);
      for (const [fg, bg, where] of UI_PAIRS) {
        const ratio = contrastRatio(V(vars, fg), V(vars, bg));
        expect(ratio, `${theme} ${fg}/${bg} (${where}): ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          3,
        );
      }
    });
  }
});
