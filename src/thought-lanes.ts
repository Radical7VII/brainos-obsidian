import type { ThoughtDocument } from "./thought-document";

/** A node appears once in the reading graph; its original records stay untouched. */
export function projectThoughtNodes(doc: ThoughtDocument, preferredIndex = -1) {
  const ids = [...new Set(doc.occurrences.map(v => v.id))];
  const remaining = new Set(ids), order: string[] = [];
  // Stable topological order; breaking a cycle leaves a visible return link.
  while (remaining.size) {
    const next = ids.find(id => remaining.has(id) && !doc.relations.some(e => e.to === id && e.from !== id && remaining.has(e.from)))
      ?? ids.find(id => remaining.has(id))!;
    order.push(next); remaining.delete(next);
  }
  const sourceIndices = order.map(id => doc.occurrences[preferredIndex]?.id === id ? preferredIndex
    : doc.occurrences.reduce((found, visit, index) => visit.id === id ? index : found, -1));
  const occurrences = sourceIndices.map(index => doc.occurrences[index]);
  const seen = new Set<string>();
  const relations = doc.relations.filter(edge => {
    const key = JSON.stringify([edge.from, edge.to]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(edge => ({ ...edge, sourceIndex: order.indexOf(edge.from) }));
  return { doc: { ...doc, occurrences, relations, paths: [] } as ThoughtDocument, sourceIndices };
}

export type LaneEdge = { from: number; to: number; lane: number };
export type LaneRow = { lane: number; revisit?: number; returns: number[]; missing: string[] };

/** Ordered occurrences, not a topological sort: cycles and repeat visits stay readable. */
export function buildThoughtLanes(doc: ThoughtDocument) {
  const rows: LaneRow[] = doc.occurrences.map(() => ({ lane: 0, returns: [], missing: [] }));
  const edges: LaneEdge[] = [], first = new Map<string, number>();
  const occupied = new Map<number, number>();
  const incoming = new Map<number, LaneEdge[]>();
  let laneCount = 1;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], visit = doc.occurrences[index];
    row.revisit = first.get(visit.id);
    if (row.revisit === undefined) first.set(visit.id, index);
    const parents = incoming.get(index) ?? [];
    const freeLane = () => { let lane = 0; while ((occupied.get(lane) ?? -1) > index) lane++; return lane; };
    row.lane = parents.length ? Math.min(...parents.map(e => e.lane)) : freeLane();
    for (const edge of parents) if (occupied.get(edge.lane) === index) occupied.delete(edge.lane);
    const seen = new Set<string>();
    for (const relation of doc.relations.filter(e => e.sourceIndex === index)) {
      if (seen.has(relation.to)) continue;
      seen.add(relation.to);
      const target = doc.occurrences.findIndex((v, i) => i > index && v.id === relation.to);
      if (target < 0) {
        const previous = first.get(relation.to);
        if (previous !== undefined) row.returns.push(previous);
        else row.missing.push(relation.targetText ?? relation.to);
        continue;
      }
      const lane = !occupied.has(row.lane) ? row.lane : freeLane();
      occupied.set(lane, target);
      const edge = { from: index, to: target, lane };
      edges.push(edge); incoming.set(target, [...incoming.get(target) ?? [], edge]);
      laneCount = Math.max(laneCount, lane + 1);
    }
    laneCount = Math.max(laneCount, row.lane + 1);
  }
  return { rows, edges, laneCount };
}

export type ThoughtLanes = ReturnType<typeof buildThoughtLanes>;
export type LaneDirection = "ArrowUp" | "ArrowDown";

/** Git-style list navigation follows visible rows, regardless of graph connections. */
export function navigateThoughtLanes(layout: ThoughtLanes, index: number, direction: LaneDirection): number {
  if (!layout.rows[index]) return index;
  if (direction === "ArrowUp") return Math.max(0, index - 1);
  if (direction === "ArrowDown") return Math.min(layout.rows.length - 1, index + 1);
  return index;
}
