/**
 * Geometry guard for the macOS-style toggle switch.
 *
 * Regression test: the WCAG 1.4.11 track border (`border: 1px`) shifted the
 * knob's containing block (absolute offsets count from INSIDE the border),
 * leaving 3px/1px margins instead of the 2px design margin. These invariants
 * tie border, offsets, knob size and travel together so the knob stays
 * optically centered in both states:
 * - design margin M = border + offset == 2 on every side,
 * - knob + 2·M == track height (vertically centered),
 * - travel == width − knob − 2·M (checked right margin == unchecked left).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styleCss = readFileSync(new URL("../style.css", import.meta.url), "utf8");

function ruleBlock(selector: string): string {
  const pattern = new RegExp(`${selector}\\s*\\{([^{}]*)\\}`, "m");
  const match = styleCss.match(pattern);
  if (!match) throw new Error(`rule not found: ${selector}`);
  return match[1];
}

function px(block: string, prop: string): number {
  const match = block.match(new RegExp(`${prop}\\s*:\\s*(\\d+)px`));
  if (!match) throw new Error(`property not found: ${prop} in ${block.slice(0, 60)}…`);
  return Number(match[1]);
}

describe("switch geometry", () => {
  it("knob keeps the 2px design margin on every side, off and on", () => {
    const track = ruleBlock("\\.switch-track");
    const knob = ruleBlock("\\.switch-track::after");
    const checked = ruleBlock("\\.switch input:checked \\+ \\.switch-track::after");
    const root = ruleBlock("\\.switch");

    const trackW = px(root, "width");
    const trackH = px(root, "height");
    const border = Number(track.match(/border\s*:\s*(\d+)px/)?.[1] ?? 0);
    const top = px(knob, "top");
    const left = px(knob, "left");
    const knobSize = px(knob, "width");
    expect(px(knob, "height")).toBe(knobSize);
    const travel = Number(checked.match(/translateX\((\d+)px\)/)?.[1]);
    expect(travel).toBeGreaterThan(0);

    // Design margin: border (outside) + offset (inside) == 2px everywhere.
    const margin = border + top;
    expect(margin).toBe(2);
    expect(border + left).toBe(margin);

    // Vertically centered: knob + one margin above and below == track height.
    expect(knobSize + 2 * margin).toBe(trackH);

    // Checked travel lands the knob exactly one margin from the far edge.
    expect(travel).toBe(trackW - knobSize - 2 * margin);
  });
});
