import { describe, expect, it } from "vitest";
import {
  CANVAS_W,
  CENTER_X,
  CENTER_Y,
  CHIP_H,
  CHIP_W,
  CLOSE_MS,
  MAX_FINAL_SCALE,
  OPEN_MS,
  QUERY_H,
  QUERY_W,
  QUERY_Y,
} from "./constants";
import {
  chipCenter,
  clamp01,
  easeInBack,
  easeOutBack,
  easeOutElastic,
  orbitAngle,
  orbitRadius,
  staggeredProgress,
} from "./easing";
import { OverlayState } from "./state";

function stateAt(time: number): { state: OverlayState; advance: (ms: number) => void } {
  const state = new OverlayState(() => time);
  return {
    state,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("OverlayState", () => {
  it("open starts at progress 0 and reaches 1 after OPEN_MS + slack", () => {
    const { state, advance } = stateAt(0);
    state.open();
    expect(state.phase).toBe("opening");
    expect(state.animProgress).toBe(0);

    advance(OPEN_MS / 2);
    expect(state.tick()).toBe(false);
    expect(state.animProgress).toBeCloseTo(0.5, 5);

    advance(OPEN_MS / 2 + 50);
    expect(state.tick()).toBe(true);
    expect(state.phase).toBe("visible");
    expect(state.animProgress).toBe(1);
  });

  it("close ends hidden after CLOSE_MS + slack", () => {
    const { state, advance } = stateAt(0);
    state.open();
    advance(OPEN_MS + 50);
    state.tick();

    state.close();
    expect(state.phase).toBe("closing");
    advance(CLOSE_MS + 50);
    expect(state.tick()).toBe(true);
    expect(state.phase).toBe("hidden");
    expect(state.animProgress).toBe(0);
  });

  it("toggle mid-open starts a close; toggle mid-close starts an open", () => {
    const { state, advance } = stateAt(0);
    state.open();
    advance(30);
    state.tick();
    expect(state.phase).toBe("opening");

    state.toggle();
    expect(state.phase).toBe("closing");
    advance(30);
    state.tick();

    state.toggle();
    expect(state.phase).toBe("opening");
    advance(OPEN_MS + 50);
    expect(state.tick()).toBe(true);
    expect(state.phase).toBe("visible");
  });

  it("close from hidden is a no-op", () => {
    const { state } = stateAt(0);
    state.close();
    expect(state.phase).toBe("hidden");
    expect(state.tick()).toBe(false);
  });

  it("a missed frame does not stall the easing (monotonic timebase)", () => {
    const { state, advance } = stateAt(0);
    state.open();
    // Simulate a dropped frame: jump 200 ms at once.
    advance(200);
    expect(state.tick()).toBe(false);
    expect(state.animProgress).toBeCloseTo(200 / OPEN_MS, 5);
  });

  it("keeps the current presentation when closing is interrupted", () => {
    const { state, advance } = stateAt(0);
    state.open();
    advance(OPEN_MS / 2);
    state.tick();
    expect(state.displayProgress).toBeCloseTo(0.5, 5);

    state.close();
    expect(state.displayProgress).toBeCloseTo(0.5, 5);
    advance(CLOSE_MS / 4);
    state.tick();
    expect(state.displayProgress).toBeCloseTo(0.25, 5);
  });
});

describe("easing", () => {
  it("easeOutBack overshoots above 1 and settles", () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 10);
    expect(easeOutBack(1)).toBeCloseTo(1, 10);
    expect(easeOutBack(0.5, 1.70158)).toBeGreaterThan(1);
    expect(easeInBack(1, 1.2)).toBeCloseTo(1, 10);
    expect(easeInBack(0)).toBeCloseTo(0, 10);
  });

  it("easeOutElastic stays within bounds and lands exactly", () => {
    expect(easeOutElastic(0)).toBe(0);
    expect(easeOutElastic(1)).toBe(1);
    expect(clamp01(easeOutElastic(0.3))).toBeGreaterThan(0);
  });

  it("staggeredProgress delays later chips and works in reverse", () => {
    // Chip 0 starts immediately: its local progress tracks raw.
    expect(staggeredProgress(0, 0, 4, 0.3)).toBe(0);
    expect(staggeredProgress(0.3, 0, 4, 0.3)).toBeCloseTo(0.3, 5);
    expect(staggeredProgress(1, 0, 4, 0.3)).toBe(1);
    // Chip 3 (last) only gets going after its delay window (raw = 0.3).
    expect(staggeredProgress(0.3, 3, 4, 0.3)).toBe(0);
    expect(staggeredProgress(1, 3, 4, 0.3)).toBe(1);
    // Middle chip: offset 0.2, window 0.8.
    expect(staggeredProgress(0.3, 2, 4, 0.3)).toBeCloseTo(0.125, 5);
    // Degenerate cases.
    expect(staggeredProgress(0.5, 0, 0, 0.3)).toBe(0.5);
    expect(staggeredProgress(0.5, 0, 1, 0.3)).toBe(0.5);
  });

  it("keeps every action on a regular orbit, collision-free at rest and clear of the center controls at max magnification", () => {
    const query = {
      left: (CANVAS_W - QUERY_W) / 2,
      right: (CANVAS_W + QUERY_W) / 2,
      top: QUERY_Y,
      bottom: QUERY_Y + QUERY_H,
    };
    // At rest (scale 1) chips must not overlap each other.
    const halfW = CHIP_W / 2;
    const halfH = CHIP_H / 2;
    // At max magnification chips may transiently peek over a neighbour (the
    // dock effect) but must never collide with the center controls.
    const halfWMax = (CHIP_W * MAX_FINAL_SCALE) / 2;
    const halfHMax = (CHIP_H * MAX_FINAL_SCALE) / 2;

    for (let total = 1; total <= 8; total++) {
      const radius = orbitRadius(total);
      const centers = Array.from({ length: total }, (_, index) =>
        chipCenter(index, total),
      );
      for (let index = 1; index < total; index++) {
        expect(orbitAngle(index, total) - orbitAngle(index - 1, total)).toBeCloseTo(
          (2 * Math.PI) / total,
          8,
        );
      }
      for (const [cx, cy] of centers) {
        expect(Math.hypot(cx - CENTER_X, cy - CENTER_Y)).toBeCloseTo(radius, 8);
        const chip = {
          left: cx - halfWMax,
          right: cx + halfWMax,
          top: cy - halfHMax,
          bottom: cy + halfHMax,
        };
        expect(
          chip.left < query.right &&
            chip.right > query.left &&
            chip.top < query.bottom &&
            chip.bottom > query.top,
        ).toBe(false);
      }

      const chips = centers.map(([cx, cy]) => ({
        left: cx - halfW,
        right: cx + halfW,
        top: cy - halfH,
        bottom: cy + halfH,
      }));
      for (let index = 0; index < chips.length; index++) {
        for (const other of chips.slice(index + 1)) {
          expect(
            chips[index].left < other.right &&
              chips[index].right > other.left &&
              chips[index].top < other.bottom &&
              chips[index].bottom > other.top,
          ).toBe(false);
        }
      }
    }
  });
});
