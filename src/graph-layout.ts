import workerSource from "./layout-worker.ts?worker";
import { ForceLayout, ForceOptions } from "./force-layout";
import type { GraphEdge, GraphNode, Point } from "./thoughts";

/** Own worker and transport only; no proprietary Obsidian worker code is bundled. */
export class GraphLayout {
  private worker?: Worker;
  private fallback?: ForceLayout;
  private positions: Record<string, Point> = {};
  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];
  private revision = 0;
  private commandVersion = 0;
  private running = false;
  private selected?: string;
  private options: Partial<ForceOptions> = {};
  private pinned = new Map<string, Point>();
  private disposed = false;

  constructor(private readonly invalidate: () => void) {
    try {
      const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
      try { this.worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
      this.worker.onmessage = event => {
        const value = event.data;
        if (this.disposed || value.revision !== this.revision || value.commandVersion !== this.commandVersion || !(value.positions instanceof Float32Array) || value.positions.length !== this.nodes.length * 2) return;
        this.nodes.forEach((node, index) => {
          const point = this.pinned.get(node.path) ?? { x: value.positions[index * 2], y: value.positions[index * 2 + 1] };
          if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
            this.positions[node.path] = point; node.x = point.x; node.y = point.y;
          }
        });
        this.running = value.running;
        this.invalidate();
      };
      this.worker.onerror = event => { event.preventDefault(); this.useFallback(); this.invalidate(); };
    } catch { this.useFallback(); }
  }
  private useFallback() {
    this.worker?.terminate(); this.worker = undefined;
    this.fallback = new ForceLayout(); this.fallback.configure(this.options);
    this.fallback.sync(this.nodes, this.edges, this.positions); this.fallback.setSelected(this.selected);
    for (const [path, point] of this.pinned) this.fallback.pin(path, point);
  }
  private send(message: object) {
    if (!this.disposed && this.worker) this.worker.postMessage({ ...message, commandVersion: ++this.commandVersion });
  }
  sync(nodes: readonly GraphNode[], edges: readonly GraphEdge[], saved: Record<string, Point>) {
    this.nodes = [...nodes]; this.edges = [...edges]; this.revision++;
    const current: Record<string, Point> = {};
    for (const node of nodes) {
      const point = this.positions[node.path] ?? saved[node.path];
      if (point) { node.x = point.x; node.y = point.y; current[node.path] = { ...point }; }
    }
    this.positions = current;
    if (this.fallback) this.fallback.sync(nodes, edges, this.positions);
    else { this.running = nodes.length > 0; this.send({ type: "sync", revision: this.revision, nodes, edges, saved: this.positions }); }
  }
  configure(options: Partial<ForceOptions>) { this.options = { ...this.options, ...options }; this.fallback?.configure(options); this.send({ type: "configure", options }); }
  setSelected(path: string | undefined) { this.selected = path; this.fallback?.setSelected(path); this.send({ type: "selected", path }); }
  pin(path: string, point: Point) { this.pinned.set(path, { ...point }); this.positions[path] = { ...point }; this.fallback?.pin(path, point); this.running = true; this.send({ type: "pin", path, point }); }
  movePinned(path: string, point: Point) { this.pinned.set(path, { ...point }); this.positions[path] = { ...point }; this.fallback?.movePinned(path, point); this.send({ type: "move", path, point }); }
  unpin(path: string) { this.pinned.delete(path); this.fallback?.unpin(path); this.send({ type: "unpin", path }); }
  reheat(alpha = 0.3) { this.fallback?.reheat(alpha); this.running = true; this.send({ type: "reheat", alpha }); }
  reset() { this.positions = {}; this.fallback?.reset(); this.send({ type: "reset" }); }
  tick(nodes: readonly GraphNode[]) {
    if (this.fallback) return this.fallback.tick(nodes);
    for (const node of nodes) { const point = this.pinned.get(node.path) ?? this.positions[node.path]; if (point) Object.assign(node, point); }
    return this.running;
  }
  snapshot(): Record<string, Point> { return this.fallback?.snapshot() ?? Object.fromEntries(Object.entries(this.positions).map(([path, point]) => [path, { ...point }])); }
  get isRunning() { return this.fallback?.isRunning ?? this.running; }
  dispose() { this.disposed = true; this.worker?.terminate(); this.worker = undefined; this.running = false; }
}
