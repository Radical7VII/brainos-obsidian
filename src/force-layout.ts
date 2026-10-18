import type { GraphEdge, GraphNode, Point } from "./thoughts";

/** Simulation values, after converting the controls' nonlinear slider values. */
export type ForceOptions = {
  centerStrength: number;
  repelStrength: number;
  linkStrength: number;
  linkDistance: number;
};
export type ForceSliders = { center: number; repel: number; link: number; distance: number };
export const DEFAULT_FORCE_OPTIONS: Readonly<ForceOptions> = Object.freeze({
  centerStrength: 0.1, repelStrength: 1000, linkStrength: 1, linkDistance: 250,
});

/** Values observed in the supplied Obsidian 1.14.4 static analysis. */
export function forceOptionsFromSliders(sliders: ForceSliders): ForceOptions {
  const exponential = (value: number) => (Math.pow(0.01, 1 - clamp(finite(value, 0.5), 0, 1)) - 0.01) / 0.99;
  return {
    centerStrength: exponential(sliders.center),
    repelStrength: Math.max(1, Math.pow(clamp(finite(sliders.repel, 10), 0, 100), 3)),
    linkStrength: exponential(sliders.link),
    linkDistance: clamp(finite(sliders.distance, 250), 30, 500),
  };
}

type Particle = Point & { id: string; index: number; vx: number; vy: number; degree: number; fixed?: Point };
type Link = { source: Particle; target: Particle; bias: number; strength: number };
type Quad = {
  x: number; y: number; width: number; count: number; cx: number; cy: number;
  children?: Quad[]; points?: Particle[];
};

/**
 * Original TypeScript reconstruction informed by the supplied static report.
 *
 * Origin gravity, degree-biased predicted-position springs, 0.6 velocity
 * retention and 300-tick cooling follow the observed layout contract. Repulsion
 * uses a Barnes–Hut quadtree; the shipped WASM uses a grid pyramid, so this is
 * deliberately not a claim of frame-for-frame equivalence or measured parity.
 * No proprietary extracted code is executed or bundled.
 */
export class ForceLayout {
  private particles: Particle[] = [];
  private byId = new Map<string, Particle>();
  private links: Link[] = [];
  private topology = "";
  private alpha = 0;
  private alphaTarget = 0;
  private options: ForceOptions = { ...DEFAULT_FORCE_OPTIONS };

  private static readonly alphaDecay = 1 - Math.pow(0.001, 1 / 300);
  private static readonly alphaMin = 0.001;
  private static readonly damping = 0.6;
  private static readonly thetaSquared = 0.9 * 0.9;
  private static readonly collisionDistance = 120;
  private static readonly collisionStrength = 0.5;

  constructor(options: Partial<ForceOptions> = {}) { this.configure(options); }

  configure(options: Partial<ForceOptions>) {
    const next = { ...this.options };
    for (const key of Object.keys(next) as (keyof ForceOptions)[]) {
      const value = options[key];
      if (value !== undefined && Number.isFinite(value)) {
        next[key] = key === "linkDistance" ? clamp(value, 1, 10_000) : clamp(value, 0, key === "repelStrength" ? 1e6 : 10);
      }
    }
    const changed = Object.keys(next).some(key => next[key as keyof ForceOptions] !== this.options[key as keyof ForceOptions]);
    this.options = next;
    if (changed) this.reheat(0.3);
  }

  reset() {
    this.particles = []; this.byId.clear(); this.links = [];
    this.topology = ""; this.alpha = 0; this.alphaTarget = 0;
  }

  sync(nodes: readonly GraphNode[], edges: readonly GraphEdge[], saved: Record<string, Point>) {
    const ids = [...new Set(nodes.map(node => node.path))].sort();
    const idSet = new Set(ids);
    const uniqueEdges = new Map<string, GraphEdge>();
    for (const edge of edges) {
      if (edge.from !== edge.to && idSet.has(edge.from) && idSet.has(edge.to)) uniqueEdges.set(JSON.stringify([edge.from, edge.to]), edge);
    }
    const sortedEdges = [...uniqueEdges.entries()].sort(([a], [b]) => a.localeCompare(b));
    const topology = JSON.stringify([ids, sortedEdges.map(([key]) => key)]);
    const changed = topology !== this.topology;
    const firstGraph = this.particles.length === 0;
    this.topology = topology;
    for (const id of this.byId.keys()) if (!idSet.has(id)) this.byId.delete(id);

    const nodeById = new Map(nodes.map(node => [node.path, node]));
    const adjacency = new Map<string, string[]>();
    for (const [, edge] of sortedEdges) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
      adjacency.get(edge.from)!.push(edge.to); adjacency.get(edge.to)!.push(edge.from);
    }
    const added: string[] = [];
    for (const [index, id] of ids.entries()) {
      if (this.byId.has(id)) continue;
      const stored = saved[id];
      const original = nodeById.get(id)!;
      // A zero coordinate in a fresh snapshot is a placeholder, not a saved
      // request to stack all nodes at the origin. Explicit saved (0,0) is valid.
      const explicit = validPoint(stored) ? stored
        : validPoint(original) && (original.x !== 0 || original.y !== 0) ? original : undefined;
      const point = explicit ?? seedPoint(id, index, ids.length);
      this.byId.set(id, { id, index, x: point.x, y: point.y, vx: 0, vy: 0, degree: 0 });
      if (!explicit) added.push(id);
    }
    // Anchor new nodes at old neighbors; freshly seeded nodes never make an
    // entire new connected component collapse to one arbitrary seed point.
    const newSet = new Set(added);
    for (const id of added) {
      const neighbors = (adjacency.get(id) ?? []).filter(other => !newSet.has(other)).map(other => this.byId.get(other)!);
      if (!neighbors.length) continue;
      const angle = hash(id) / 0x1_0000_0000 * Math.PI * 2;
      const point = this.byId.get(id)!;
      const radius = 40 + hash(id + "radius") % 40;
      point.x = neighbors.reduce((sum, node) => sum + node.x, 0) / neighbors.length + Math.cos(angle) * radius;
      point.y = neighbors.reduce((sum, node) => sum + node.y, 0) / neighbors.length + Math.sin(angle) * radius;
    }
    this.particles = ids.map((id, index) => {
      const particle = this.byId.get(id)!; particle.index = index; particle.degree = 0; return particle;
    });
    for (const [, edge] of sortedEdges) { this.byId.get(edge.from)!.degree++; this.byId.get(edge.to)!.degree++; }
    this.links = sortedEdges.map(([, edge]) => {
      const source = this.byId.get(edge.from)!, target = this.byId.get(edge.to)!;
      return { source, target, bias: source.degree / (source.degree + target.degree), strength: 1 / Math.min(source.degree, target.degree) };
    });
    this.alphaTarget = this.particles.some(particle => particle.fixed) ? 0.3 : 0;
    if (!this.particles.length) this.alpha = 0;
    else if (changed) this.reheat(firstGraph ? 1 : 0.3);
    this.copyToNodes(nodes);
  }

  /** Selection affects rendering only; it must not attract the whole graph. */
  setSelected(_path: string | undefined) {}

  pin(path: string, position: Point) {
    const particle = this.byId.get(path);
    if (!particle || !validPoint(position)) return;
    particle.fixed = { ...position }; particle.x = position.x; particle.y = position.y;
    particle.vx = 0; particle.vy = 0; this.alphaTarget = 0.3; this.reheat(0.3);
  }

  movePinned(path: string, position: Point) {
    const particle = this.byId.get(path);
    if (!particle?.fixed || !validPoint(position)) return;
    particle.fixed = { ...position }; particle.x = position.x; particle.y = position.y;
    particle.vx = 0; particle.vy = 0; this.alphaTarget = 0.3; this.reheat(0.3);
  }

  unpin(path: string) {
    const particle = this.byId.get(path);
    if (!particle?.fixed) return;
    particle.fixed = undefined; particle.vx = 0; particle.vy = 0;
    this.alphaTarget = this.particles.some(node => node.fixed) ? 0.3 : 0;
    this.reheat(0.3);
  }

  reheat(alpha = 0.3) { this.alpha = Math.max(this.alpha, clamp(finite(alpha, 0.3), 0, 1)); }

  tick(nodes: readonly GraphNode[]): boolean {
    if (!this.isRunning) { this.copyToNodes(nodes); return false; }
    this.alpha += (this.alphaTarget - this.alpha) * ForceLayout.alphaDecay;
    const center = this.options.centerStrength * this.alpha;
    for (const particle of this.particles) { particle.vx -= particle.x * center; particle.vy -= particle.y * center; }
    for (const link of this.links) {
      const a = link.source, b = link.target;
      let dx = b.x + b.vx - a.x - a.vx, dy = b.y + b.vy - a.y - a.vy;
      if (dx === 0 && dy === 0) { const unit = direction(a.id, b.id); dx = unit.x * 0.1; dy = unit.y * 0.1; }
      const length = Math.hypot(dx, dy);
      const factor = (length - this.options.linkDistance) / length * this.alpha * this.options.linkStrength * link.strength;
      dx *= factor; dy *= factor;
      b.vx -= dx * link.bias; b.vy -= dy * link.bias;
      a.vx += dx * (1 - link.bias); a.vy += dy * (1 - link.bias);
    }
    if (this.particles.length > 1 && this.options.repelStrength > 0) {
      const tree = buildTree(this.particles);
      const strength = this.options.repelStrength * this.alpha;
      for (const particle of this.particles) this.repulse(particle, tree, strength);
    }
    this.collide();
    for (const particle of this.particles) {
      if (particle.fixed) {
        particle.x = particle.fixed.x; particle.y = particle.fixed.y; particle.vx = 0; particle.vy = 0;
      } else {
        particle.vx *= ForceLayout.damping; particle.vy *= ForceLayout.damping;
        particle.x += particle.vx; particle.y += particle.vy;
        // Corrupt saved coordinates and extreme custom forces cannot poison
        // subsequent frames. This is a safety boundary, not a normal speed cap.
        if (!Number.isFinite(particle.x) || !Number.isFinite(particle.y) || Math.abs(particle.x) > 1e7 || Math.abs(particle.y) > 1e7) {
          const seed = seedPoint(particle.id, particle.index, this.particles.length);
          particle.x = seed.x; particle.y = seed.y; particle.vx = 0; particle.vy = 0;
        }
      }
    }
    if (this.alphaTarget === 0 && this.alpha < ForceLayout.alphaMin) this.alpha = 0;
    this.copyToNodes(nodes);
    return this.isRunning;
  }

  snapshot(): Record<string, Point> {
    return Object.fromEntries(this.particles.map(particle => [particle.id, { x: particle.x, y: particle.y }]));
  }

  get isRunning() { return this.particles.length > 0 && (this.alpha >= ForceLayout.alphaMin || this.alphaTarget > 0); }

  private copyToNodes(nodes: readonly GraphNode[]) {
    for (const node of nodes) { const point = this.byId.get(node.path); if (point) { node.x = point.x; node.y = point.y; } }
  }

  private repulse(particle: Particle, quad: Quad, strength: number) {
    if (!quad.count) return;
    let dx = particle.x - quad.cx, dy = particle.y - quad.cy;
    let squared = dx * dx + dy * dy;
    const contains = particle.x >= quad.x && particle.x <= quad.x + quad.width && particle.y >= quad.y && particle.y <= quad.y + quad.width;
    if (quad.children && !contains && quad.width * quad.width < ForceLayout.thetaSquared * squared) {
      const factor = strength * quad.count / Math.max(1, squared);
      particle.vx += dx * factor; particle.vy += dy * factor;
    } else if (quad.children) {
      for (const child of quad.children) this.repulse(particle, child, strength);
    } else {
      for (const other of quad.points ?? []) {
        if (other === particle) continue;
        dx = particle.x - other.x; dy = particle.y - other.y; squared = dx * dx + dy * dy;
        if (squared < 1e-12) { const unit = direction(other.id, particle.id); dx = unit.x; dy = unit.y; squared = 1; }
        const factor = strength / Math.max(1, squared);
        particle.vx += dx * factor; particle.vy += dy * factor;
      }
    }
  }

  /** Predicted-position uniform buckets avoid an all-pairs collision pass. */
  private collide() {
    const distance = ForceLayout.collisionDistance;
    const buckets = new Map<string, Particle[]>();
    const predicted = this.particles.map(node => ({ x: node.x + node.vx, y: node.y + node.vy }));
    for (const particle of this.particles) {
      const point = predicted[particle.index];
      const key = `${Math.floor(point.x / distance)},${Math.floor(point.y / distance)}`;
      const bucket = buckets.get(key) ?? []; bucket.push(particle); buckets.set(key, bucket);
    }
    for (const particle of this.particles) {
      const point = predicted[particle.index], cellX = Math.floor(point.x / distance), cellY = Math.floor(point.y / distance);
      for (let x = cellX - 1; x <= cellX + 1; x++) for (let y = cellY - 1; y <= cellY + 1; y++) {
        for (const other of buckets.get(`${x},${y}`) ?? []) {
          if (other.index <= particle.index) continue;
          const target = predicted[other.index];
          let dx = target.x - point.x, dy = target.y - point.y;
          let length = Math.hypot(dx, dy);
          if (length >= distance) continue;
          if (length < 1e-6) { const unit = direction(particle.id, other.id); dx = unit.x; dy = unit.y; length = 1; }
          const factor = (distance - length) / length * ForceLayout.collisionStrength;
          const aShare = particle.fixed ? 0 : other.fixed ? 1 : 0.5;
          const bShare = other.fixed ? 0 : particle.fixed ? 1 : 0.5;
          particle.vx -= dx * factor * aShare; particle.vy -= dy * factor * aShare;
          other.vx += dx * factor * bShare; other.vy += dy * factor * bShare;
        }
      }
    }
  }
}

function buildTree(points: Particle[]): Quad {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
  const width = Math.max(1, maxX - minX, maxY - minY) * 1.000001;
  return splitQuad(points, minX, minY, width, 0);
}

function splitQuad(points: Particle[], x: number, y: number, width: number, depth: number): Quad {
  let cx = 0, cy = 0;
  for (const point of points) { cx += point.x; cy += point.y; }
  const quad: Quad = { x, y, width, count: points.length, cx: cx / points.length, cy: cy / points.length };
  if (points.length <= 4 || depth >= 24 || width < 1e-6) { quad.points = points; return quad; }
  const half = width / 2, groups: Particle[][] = [[], [], [], []];
  for (const point of points) groups[(point.x >= x + half ? 1 : 0) + (point.y >= y + half ? 2 : 0)].push(point);
  quad.children = groups.flatMap((group, index) => group.length ? [splitQuad(group, x + (index % 2) * half, y + (index >= 2 ? half : 0), half, depth + 1)] : []);
  return quad;
}

function finite(value: number, fallback: number) { return Number.isFinite(value) ? value : fallback; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function validPoint(point: Point | undefined): point is Point { return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1e7 && Math.abs(point.y) <= 1e7; }
function hash(value: string) {
  let result = 2166136261;
  for (const char of value) { result ^= char.charCodeAt(0); result = Math.imul(result, 16777619); }
  return result >>> 0;
}
function seedPoint(id: string, index: number, count: number): Point {
  const angle = hash(id) / 0x1_0000_0000 * Math.PI * 2;
  const radius = (120 + Math.sqrt(count) * 40) * Math.sqrt((index + 0.5) / Math.max(1, count));
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}
/** Stable antisymmetric direction for coincident pairs, independent of input order. */
function direction(from: string, to: string): Point {
  const first = from < to ? from : to, second = from < to ? to : from;
  const angle = hash(first + "\0" + second) / 0x1_0000_0000 * Math.PI * 2;
  const sign = from < to ? 1 : -1;
  return { x: Math.cos(angle) * sign, y: Math.sin(angle) * sign };
}
