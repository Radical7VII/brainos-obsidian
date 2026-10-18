/** Original Canvas presentation rules derived from the user's static analysis
 * of Obsidian 1.14.4. No extracted application code is executed or bundled. */
export type GraphDisplayOptions = {
  nodeSizeMultiplier: number;
  lineSizeMultiplier: number;
  textFadeMultiplier: number;
  showArrows: boolean;
};
export type ScreenPoint = { x: number; y: number };
export type ScreenRect = { left: number; right: number; top: number; bottom: number };

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** getSize() is in graph units; Obsidian compensates the scene scale with its
 * inverse square root, leaving a sqrt(zoom) radius in screen pixels. */
export function nodeScreenRadius(weight: number, zoom: number, multiplier = 1): number {
  const size = clamp(3 * Math.sqrt(Math.max(0, weight) + 1), 8, 30);
  return size * Math.max(0.05, multiplier) * Math.sqrt(Math.max(0.0001, zoom));
}

export function graphLabelAlpha(zoom: number, fadeMultiplier = 0): number {
  return clamp(Math.log2(Math.max(0.0001, zoom)) + 1 - fadeMultiplier, 0, 1);
}

/** Frame-rate independent approach, snapping once the remaining difference
 * cannot visibly affect a Canvas alpha value. */
export function approachOpacity(previous: number, target: number, elapsedMs: number): number {
  if (Math.abs(previous - target) < 0.002) return target;
  const amount = 1 - Math.exp(-Math.min(64, Math.max(1, elapsedMs)) / 65);
  const next = previous + (target - previous) * amount;
  return Math.abs(next - target) < 0.002 ? target : next;
}

export function intersectsViewport(rect: ScreenRect, width: number, height: number): boolean {
  return rect.right >= 0 && rect.bottom >= 0 && rect.left <= width && rect.top <= height;
}

export function edgeInViewport(a: ScreenPoint, b: ScreenPoint, width: number, height: number, padding = 2): boolean {
  return intersectsViewport({ left: Math.min(a.x, b.x) - padding, right: Math.max(a.x, b.x) + padding,
    top: Math.min(a.y, b.y) - padding, bottom: Math.max(a.y, b.y) + padding }, width, height);
}

/** Reciprocal directed edges share a stroke, while their arrowheads remain
 * separately available to the caller. */
export function edgeStrokeKey(from: string, to: string): string {
  return JSON.stringify(from < to ? [from, to] : [to, from]);
}

export function wrapGraphLabel(text: string, measure: (value: string) => number, width: number, maxLines = 4): string[] {
  const lines: string[] = [];
  let line = "";
  for (const character of text.replace(/\s+/g, " ").trim()) {
    if (line && measure(line + character) > width) {
      lines.push(line.trimEnd());
      line = character.trimStart();
      if (lines.length === maxLines) {
        let last = lines[maxLines - 1];
        while (last && measure(last + "…") > width) last = Array.from(last).slice(0, -1).join("");
        lines[maxLines - 1] = last + "…";
        return lines;
      }
    } else line += character;
  }
  if (line || !lines.length) lines.push(line.trimEnd());
  return lines;
}
