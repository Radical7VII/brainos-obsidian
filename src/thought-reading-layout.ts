import type { GraphNode, Point, ThoughtVisit } from "./thoughts";
import { RectIndex } from "./graph-label-placement";

export type NodeExtent = { width: number; top: number; bottom: number };
type Context = { anchor: Point; positions: Record<string, Point>; sizes: Record<string, NodeExtent>; signature: string };
const finite = (point: Point | undefined): point is Point => !!point && Number.isFinite(point.x) && Number.isFinite(point.y);

/** Per-thought reading geometry. Free coordinates and other thoughts never change. */
export class ThoughtReadingLayout {
  private contexts = new Map<string, Context>();
  clear() { this.contexts.clear(); }
  move(thought: string, key: string, point: Point) {
    const context = this.contexts.get(thought);
    if (context?.positions[key]) context.positions[key] = { ...point };
  }
  sync(thought: string, nodes: readonly GraphNode[], steps: readonly ThoughtVisit[], extent: (node: GraphNode) => NodeExtent): Record<string, Point> {
    const byId = new Map(nodes.map(node => [node.path, node]));
    const visits = steps.filter(step => step.thoughtPath === thought && byId.has(step.key));
    const ids = [...new Set(visits.map(step => step.key))];
    if (!ids.length) return {};
    const active = new Set(ids), order = new Map(ids.map((id, index) => [id, index]));
    const outgoing = new Map(ids.map(id => [id, new Set<string>()]));
    const incoming = new Map(ids.map(id => [id, new Set<string>()]));
    for (let index = 1; index < visits.length; index++) {
      const a = visits[index - 1], b = visits[index];
      if (a.pathIndex !== b.pathIndex || a.key === b.key) continue;
      outgoing.get(a.key)!.add(b.key); incoming.get(b.key)!.add(a.key);
    }
    const sizes = new Map(nodes.map(node => [node.path, extent(node)]));
    const signature = JSON.stringify([visits.map(step => [step.key, step.pathIndex]), ids.map(id => sizes.get(id))]);
    let context = this.contexts.get(thought);
    if (context?.signature === signature) return context.positions;
    const root = byId.get(ids[0])!;
    if (!context) {
      context = { anchor: finite(root) ? { x: root.x, y: root.y } : { x: 0, y: 0 }, positions: {}, sizes: {}, signature: "" };
      this.contexts.set(thought, context);
    }

    // Find strongly connected components without recursion. Only return edges
    // inside a real cycle may point left; branches and merges retain direction.
    const seen = new Set<string>(), finished: string[] = [];
    for (const root of ids) {
      if (seen.has(root)) continue;
      const stack: [string, boolean][] = [[root, false]];
      while (stack.length) {
        const [id, done] = stack.pop()!;
        if (done) { finished.push(id); continue; }
        if (seen.has(id)) continue;
        seen.add(id); stack.push([id, true]);
        for (const next of outgoing.get(id)!) if (!seen.has(next)) stack.push([next, false]);
      }
    }
    const component = new Map<string, number>();
    for (const root of finished.reverse()) {
      if (component.has(root)) continue;
      const group = component.size, stack = [root]; component.set(root, group);
      while (stack.length) for (const previous of incoming.get(stack.pop()!)!) {
        if (!component.has(previous)) { component.set(previous, group); stack.push(previous); }
      }
    }
    const forward = new Map(ids.map(id => [id, [...outgoing.get(id)!].filter(next =>
      component.get(id) !== component.get(next) || order.get(id)! < order.get(next)!)]));
    const members = new Map<number, string[]>();
    for (const id of ids) {
      const group = component.get(id)!;
      if (!members.has(group)) members.set(group, []);
      members.get(group)!.push(id);
    }
    const cycleOffset = new Map<string, number>();
    for (const group of members.values()) if (group.length > 2) group.forEach((id, index) =>
      cycleOffset.set(id, Math.sin(index / group.length * Math.PI * 2) * 120));
    const parents = new Map(ids.map(id => [id, [] as string[]]));
    for (const [from, targets] of forward) for (const to of targets) parents.get(to)!.push(from);
    const pending = new Map(ids.map(id => [id, parents.get(id)!.length]));
    const rank = new Map(ids.map(id => [id, 0]));
    const queue = ids.filter(id => !pending.get(id));
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index];
      for (const next of forward.get(id)!) {
        rank.set(next, Math.max(rank.get(next)!, rank.get(id)! + 1));
        pending.set(next, pending.get(next)! - 1); if (!pending.get(next)) queue.push(next);
      }
    }
    const widths: number[] = [];
    for (const id of ids) widths[rank.get(id)!] = Math.max(widths[rank.get(id)!] ?? 0, sizes.get(id)!.width);
    const columns = [context.anchor.x];
    for (let index = 1; index < widths.length; index++) columns[index] = columns[index - 1] + Math.max(220, (widths[index - 1] + widths[index]) / 2 + 70);
    const occupied = new RectIndex();
    const rect = (point: Point, size: NodeExtent) => ({ left: point.x - size.width / 2, right: point.x + size.width / 2,
      top: point.y + size.top, bottom: point.y + size.bottom });
    for (const node of nodes) if (!active.has(node.path) && finite(node)) occupied.set(node.path, rect(node, sizes.get(node.path)!));
    // Reserve old positions before placing additions, so a new sibling cannot
    // steal an existing branch's lane and cascade through the whole thought.
    for (const id of ids) if (context.positions[id]) occupied.set(id, rect(context.positions[id], context.sizes[id] ?? sizes.get(id)!));
    const positions: Record<string, Point> = {};
    for (const id of queue) {
      const size = sizes.get(id)!, old = context.positions[id];
      const predecessors = parents.get(id)!.map(key => ({ point: positions[key], size: sizes.get(key)! }));
      const required = Math.max(-Infinity, ...predecessors.map(parent => parent.point.x + (parent.size.width + size.width) / 2 + 70));
      const x = Math.max(old?.x ?? columns[rank.get(id)!], required);
      const preferredY = old?.y ?? (cycleOffset.has(id) ? context.anchor.y + cycleOffset.get(id)!
        : predecessors.length ? predecessors.reduce((sum, parent) => sum + parent.point.y, 0) / predecessors.length : context.anchor.y);
      const stride = Math.max(100, size.bottom - size.top + 24);
      let point = { x, y: preferredY }, attempt = 0;
      while (occupied.collides(rect(point, size), id, 16)) {
        attempt++;
        point = { x, y: preferredY + Math.ceil(attempt / 2) * stride * (attempt % 2 ? 1 : -1) };
      }
      positions[id] = point; occupied.set(id, rect(point, size));
    }
    context.positions = positions; context.sizes = Object.fromEntries(ids.map(id => [id, sizes.get(id)!])); context.signature = signature;
    return positions;
  }
}
