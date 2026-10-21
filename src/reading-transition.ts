import type { GraphNode, Point } from "./thoughts";

/** Smooth, reversible presentation only. No reading coordinates enter persistence. */
export class ReadingTransition {
  private positions = new Map<string, Point>();
  private strength = 0;
  private lastTime?: number;
  private targets: Record<string, Point> = {};
  private offset: Point = { x: 0, y: 0 };
  get(key: string) { return this.positions.get(key); }
  hold(key: string, point: Point) { this.positions.set(key, { ...point }); }
  clear() { this.positions.clear(); this.strength = 0; this.lastTime = undefined; this.targets = {}; }

  step(nodes: readonly GraphNode[], targets: Record<string, Point>, requested: boolean, zoom: number, time: number,
    offset: Point = { x: 0, y: 0 }, held?: { key: string; point: Point }, reducedMotion = false) {
    const elapsed = Math.min(48, Math.max(1, this.lastTime === undefined ? 16 : time - this.lastTime));
    this.lastTime = time;
    if (requested) { this.targets = targets; this.offset = offset; }
    const t = Math.max(0, Math.min(1, (zoom - 0.45) / 0.45));
    const goal = requested ? t * t * (3 - 2 * t) : 0;
    this.strength = reducedMotion ? goal : this.strength + (goal - this.strength) * (1 - Math.exp(-elapsed / 110));
    if (Math.abs(this.strength - goal) < 0.001) this.strength = goal;
    let moving = this.strength !== goal;
    const alive = new Set(nodes.map(node => node.path));
    for (const key of this.positions.keys()) if (!alive.has(key)) this.positions.delete(key);
    for (const node of nodes) {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
      if (held?.key === node.path) { this.hold(node.path, held.point); continue; }
      const target = this.targets[node.path];
      const read = target && { x: target.x + this.offset.x, y: target.y + this.offset.y };
      // Retain a little live physical variation without letting a distant free
      // position reverse the reading order after the transition settles.
      const elastic = read && { x: read.x + Math.max(-12, Math.min(12, node.x - read.x)),
        y: read.y + Math.max(-24, Math.min(24, node.y - read.y)) };
      const desired = elastic ? { x: node.x + (elastic.x - node.x) * this.strength,
        y: node.y + (elastic.y - node.y) * this.strength } : { x: node.x, y: node.y };
      const before = this.positions.get(node.path) ?? { x: node.x, y: node.y };
      const distance = Math.hypot(desired.x - before.x, desired.y - before.y);
      const fraction = reducedMotion || distance < 0.1 ? 1 : Math.min(1 - Math.exp(-elapsed / 85), 32 * elapsed / 16 / Math.max(0.1, zoom) / distance);
      const next = { x: before.x + (desired.x - before.x) * fraction, y: before.y + (desired.y - before.y) * fraction };
      if (Math.hypot(desired.x - next.x, desired.y - next.y) > 0.1) moving = true;
      else Object.assign(next, desired);
      this.positions.set(node.path, next);
    }
    return moving;
  }
}
