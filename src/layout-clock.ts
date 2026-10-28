/** Fixed 60 Hz physics, independent of display refresh rate. */
export class LayoutClock {
  private previous?: number;
  private remainder = 0;

  reset() { this.previous = undefined; this.remainder = 0; }

  advance(time: number): number {
    if (this.previous === undefined) { this.previous = time; return 1; }
    // Resume gently after a background tab or a blocked main thread.
    this.remainder += Math.max(0, Math.min(1000 / 12, time - this.previous));
    this.previous = time;
    const steps = Math.floor((this.remainder + 1e-7) / (1000 / 60));
    this.remainder = Math.max(0, this.remainder - steps * (1000 / 60));
    return steps;
  }
}
