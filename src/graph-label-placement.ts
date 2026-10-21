import type { ScreenPoint, ScreenRect } from "./graph-rendering";

export function rectsOverlap(a: ScreenRect, b: ScreenRect, gap = 0) {
  return a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
}

/** Small spatial hash shared by world layout and screen-space title placement. */
export class RectIndex {
  private cells = new Map<string, Set<string>>();
  private rectangles = new Map<string, ScreenRect>();
  constructor(private cellSize = 128) {}
  private keys(rect: ScreenRect) {
    const keys: string[] = [];
    for (let x = Math.floor(rect.left / this.cellSize); x <= Math.floor(rect.right / this.cellSize); x++) {
      for (let y = Math.floor(rect.top / this.cellSize); y <= Math.floor(rect.bottom / this.cellSize); y++) keys.push(`${x}:${y}`);
    }
    return keys;
  }
  set(key: string, rect: ScreenRect) {
    this.delete(key); this.rectangles.set(key, rect);
    for (const cell of this.keys(rect)) {
      if (!this.cells.has(cell)) this.cells.set(cell, new Set());
      this.cells.get(cell)!.add(key);
    }
  }
  delete(key: string) {
    const rect = this.rectangles.get(key); if (!rect) return;
    for (const cell of this.keys(rect)) {
      const items = this.cells.get(cell); items?.delete(key); if (!items?.size) this.cells.delete(cell);
    }
    this.rectangles.delete(key);
  }
  collides(rect: ScreenRect, ignore?: string, gap = 8) {
    const expanded = { left: rect.left - gap, right: rect.right + gap, top: rect.top - gap, bottom: rect.bottom + gap };
    for (const cell of this.keys(expanded)) for (const key of this.cells.get(cell) ?? []) {
      if (key !== ignore && rectsOverlap(rect, this.rectangles.get(key)!, gap)) return true;
    }
    return false;
  }
}

export type LabelCandidate = { key: string; point: ScreenPoint; radius: number; width: number; height: number; priority: number; gap?: number };

/** Labels never overlap each other or graph dots. Dense background labels yield first. */
export function placeGraphLabels(labels: LabelCandidate[], dots: { key: string; point: ScreenPoint; radius: number }[]): Map<string, ScreenRect> {
  const occupied = new RectIndex();
  for (const dot of dots) occupied.set("dot:" + dot.key, { left: dot.point.x - dot.radius, right: dot.point.x + dot.radius,
    top: dot.point.y - dot.radius, bottom: dot.point.y + dot.radius });
  const result = new Map<string, ScreenRect>();
  for (const label of [...labels].sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key))) {
    const { point: p, radius: r, width: w, height: h } = label, gap = label.gap ?? 8;
    const candidates = [
      { x: p.x - w / 2, y: p.y + r + gap },
      { x: p.x - w / 2, y: p.y - r - gap - h },
      { x: p.x + r + gap, y: p.y - h / 2 },
      { x: p.x - r - gap - w, y: p.y - h / 2 },
    ];
    const candidate = candidates.map(({ x, y }) => ({ left: x, right: x + w, top: y, bottom: y + h }))
      .find(rect => !occupied.collides(rect, undefined, 4));
    if (candidate) { result.set(label.key, candidate); occupied.set("label:" + label.key, candidate); }
  }
  return result;
}
