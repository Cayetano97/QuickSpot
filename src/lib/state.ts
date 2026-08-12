import { CLOSE_MS, OPEN_MS } from "./constants";

export type Phase = "hidden" | "opening" | "closing" | "visible";

/**
 * The overlay animation state machine. `open()`/`close()` replace the
 * transition in place (never accumulate timers); `tick()` advances the
 * easing against a monotonic clock and returns true when a transition
 * has settled.
 */
export class OverlayState {
  phase: Phase = "hidden";
  animProgress = 0;
  animStartMs = 0;

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly reducedMotion: () => boolean = () => false,
  ) {}

  get visible(): boolean {
    return this.phase !== "hidden";
  }

  get animating(): boolean {
    return this.phase === "opening" || this.phase === "closing";
  }

  /** Visual progress: for closing, 1 - animProgress. */
  get displayProgress(): number {
    return this.phase === "closing" ? 1 - this.animProgress : this.animProgress;
  }

  open(): void {
    const current = this.displayProgress;
    this.phase = "opening";
    this.animProgress = current;
    this.animStartMs = this.now() - current * OPEN_MS;
  }

  close(): void {
    if (this.phase === "hidden") return;
    const current = this.phase === "opening" || this.phase === "closing" ? this.displayProgress : 1;
    this.phase = "closing";
    this.animProgress = 1 - current;
    this.animStartMs = this.now() - this.animProgress * CLOSE_MS;
  }

  /** Toggle: if open or opening, close; else open. */
  toggle(): void {
    if (this.phase === "opening" || this.phase === "visible") this.close();
    else this.open();
  }

  /** Advance the easing; returns true when the transition just settled. */
  tick(): boolean {
    if (!this.animating) return false;
    const dur = this.reducedMotion()
      ? 0
      : this.phase === "opening"
        ? OPEN_MS
        : CLOSE_MS;
    this.animProgress = Math.min(Math.max((this.now() - this.animStartMs) / dur, 0), 1);
    if (this.animProgress >= 1) {
      if (this.phase === "opening") {
        this.phase = "visible";
        this.animProgress = 1;
      } else {
        this.phase = "hidden";
        this.animProgress = 0;
      }
      return true;
    }
    return false;
  }
}
