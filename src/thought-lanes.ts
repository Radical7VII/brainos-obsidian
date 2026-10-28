import type { DocumentRelation, ThoughtDocument } from "./thought-document";

/** A node appears once in the reading graph; its original records stay untouched. */
export function projectThoughtNodes(doc: ThoughtDocument, preferredIndex = -1) {
  const ids = [...new Set(doc.occurrences.map(v => v.id))];
  const remaining = new Set(ids), order: string[] = [];
  const incoming = new Map(ids.map(id => [id, 0]));
  const outgoing = new Map<string, string[]>();
  const latest = new Map<string, number>();
  doc.occurrences.forEach((visit, index) => latest.set(visit.id, index));
  // Count only declared nodes: unresolved references are shown as hints, not rows.
  for (const edge of doc.relations) {
    if (edge.from === edge.to || !remaining.has(edge.from) || !remaining.has(edge.to)) continue;
    incoming.set(edge.to, incoming.get(edge.to)! + 1);
    const targets = outgoing.get(edge.from) ?? [];
    targets.push(edge.to); outgoing.set(edge.from, targets);
  }
  // Stable topological order; breaking a cycle leaves a visible return link.
  while (remaining.size) {
    const next = ids.find(id => remaining.has(id) && incoming.get(id) === 0)
      ?? ids.find(id => remaining.has(id))!;
    order.push(next); remaining.delete(next);
    for (const target of outgoing.get(next) ?? []) incoming.set(target, incoming.get(target)! - 1);
  }
  const sourceIndices = order.map(id => doc.occurrences[preferredIndex]?.id === id ? preferredIndex
    : latest.get(id)!);
  const occurrences = sourceIndices.map(index => doc.occurrences[index]);
  const rowIndices = new Map(order.map((id, index) => [id, index]));
  const seen = new Set<string>();
  const relations = doc.relations.filter(edge => {
    const key = JSON.stringify([edge.from, edge.to]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(edge => ({ ...edge, sourceIndex: rowIndices.get(edge.from) ?? -1 }));
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
  const relationsByRow = new Map<number, DocumentRelation[]>();
  for (const relation of doc.relations) {
    if (relation.sourceIndex === undefined) continue;
    const relations = relationsByRow.get(relation.sourceIndex) ?? [];
    relations.push(relation); relationsByRow.set(relation.sourceIndex, relations);
  }
  // Resolve the next visit in one backwards pass rather than scanning all rows per edge.
  const nextVisit = new Map<string, number>();
  const targetsByRow: { relation: DocumentRelation; target: number }[][] = [];
  for (let index = rows.length - 1; index >= 0; index--) {
    targetsByRow[index] = (relationsByRow.get(index) ?? []).map(relation => ({ relation, target: nextVisit.get(relation.to) ?? -1 }));
    nextVisit.set(doc.occurrences[index].id, index);
  }
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
    for (const { relation, target } of targetsByRow[index]) {
      if (seen.has(relation.to)) continue;
      seen.add(relation.to);
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

/** A merged node may have several parents; use the selected record's actual arrival. */
export function thoughtLaneParent(doc: ThoughtDocument, index: number) {
  const visit = doc.occurrences[index];
  if (!visit) return undefined;
  const incoming = doc.relations.filter(edge => edge.to === visit.id && edge.sourceIndex !== undefined
    && doc.occurrences.findIndex((record, i) => i > edge.sourceIndex! && record.id === visit.id) === index);
  const sourceIndex = incoming[incoming.length - 1]?.sourceIndex;
  return sourceIndex === undefined ? undefined : doc.occurrences[sourceIndex];
}

/** Git-style list navigation follows visible rows, regardless of graph connections. */
export function navigateThoughtLanes(layout: ThoughtLanes, index: number, direction: LaneDirection): number {
  if (!layout.rows[index]) return index;
  if (direction === "ArrowUp") return Math.max(0, index - 1);
  if (direction === "ArrowDown") return Math.min(layout.rows.length - 1, index + 1);
  return index;
}
