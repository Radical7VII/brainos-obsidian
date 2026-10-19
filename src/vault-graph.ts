import { App, getAllTags, TFile } from "obsidian";
import { isThoughtFile } from "./thought-scope";
import type { GraphNode, GraphEdge, GraphSnapshot } from "./thoughts";
import type { GraphOptions } from "./graph-options";

/** Use Obsidian's resolved reference index, never read every Markdown body. */
export function buildVaultSnapshot(app: App, thoughts: GraphSnapshot["thoughts"], filter: GraphOptions["filter"], folder?: string): GraphSnapshot {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const addFile = (file: TFile) => {
    if (folder !== undefined && !isThoughtFile(file.path, folder)) return undefined;
    if (file.extension !== "md" && !filter.showAttachments) return undefined;
    let node = nodes.get(file.path);
    if (!node) {
      node = { path: file.path, openPath: file.path, label: file.basename, x: NaN, y: NaN, degree: 0, thoughts: [],
        kind: file.extension === "md" ? "note" : "attachment", tags: getAllTags(app.metadataCache.getFileCache(file) ?? {}) ?? [] };
      nodes.set(node.path, node);
    }
    return node;
  };
  const addEdge = (from: string, to: string) => {
    if (from === to || !nodes.has(from) || !nodes.has(to)) return;
    const key = JSON.stringify([from, to]);
    if (!edges.has(key)) edges.set(key, { from, to, thoughts: [] });
  };
  for (const file of app.vault.getMarkdownFiles()) addFile(file);
  for (const [source, targets] of Object.entries(app.metadataCache.resolvedLinks)) {
    const file = app.vault.getAbstractFileByPath(source);
    if (!(file instanceof TFile) || !addFile(file)) continue;
    for (const target of Object.keys(targets)) {
      const destination = app.vault.getAbstractFileByPath(target);
      if (destination instanceof TFile && addFile(destination)) addEdge(source, destination.path);
    }
  }
  if (filter.showUnresolved) {
    for (const [source, targets] of Object.entries(app.metadataCache.unresolvedLinks)) {
      if (!nodes.has(source)) continue;
      for (const target of Object.keys(targets)) {
        const path = `unresolved:${target}`;
        if (!nodes.has(path)) nodes.set(path, { path, openPath: target, label: target, kind: "unresolved", degree: 0, thoughts: [], x: NaN, y: NaN });
        addEdge(source, path);
      }
    }
  }
  if (filter.showTags) {
    for (const node of [...nodes.values()]) {
      for (const tag of node.tags ?? []) {
        if (!nodes.has(tag)) nodes.set(tag, { path: tag, openPath: "", label: tag, kind: "tag", degree: 0, thoughts: [], x: NaN, y: NaN });
        addEdge(node.path, tag);
      }
    }
  }
  for (const edge of edges.values()) { nodes.get(edge.from)!.degree++; nodes.get(edge.to)!.degree++; }
  return { nodes: [...nodes.values()], edges: [...edges.values()], thoughts };
}

/** Search changes the simulated graph; neighbors are filtered in explicit rounds. */
export function selectGraph(snapshot: GraphSnapshot, query: string, options: GraphOptions["filter"], localCenter?: string): GraphSnapshot {
  const tokens = query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const matches = (node: GraphNode) => tokens.every(raw => {
    const token = raw.replace(/"/g, "").toLocaleLowerCase();
    if (token.startsWith("path:")) return node.path.toLocaleLowerCase().includes(token.slice(5));
    if (token.startsWith("file:")) return node.label.toLocaleLowerCase().includes(token.slice(5));
    if (token.startsWith("tag:")) {
      const value = token.slice(4).replace(/^#/, "");
      return (node.tags ?? []).some(tag => tag.slice(1).toLocaleLowerCase() === value || tag.slice(1).toLocaleLowerCase().startsWith(value + "/"));
    }
    return node.label.toLocaleLowerCase().includes(token) || node.path.toLocaleLowerCase().includes(token);
  });
  let nodes = snapshot.nodes.filter(matches);
  let ids = new Set(nodes.map(node => node.path));
  let edges = snapshot.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
  if (localCenter) {
    const keep = new Set<string>();
    const layers = new Map<string, number>();
    if (ids.has(localCenter)) { keep.add(localCenter); layers.set(localCenter, 0); }
    const byPath = new Map(nodes.map(node => [node.path, node]));
    for (let depth = 0; depth < options.localDepth; depth++) {
      const next = new Set<string>();
      for (const edge of edges) {
        if (options.localOutgoing && keep.has(edge.from) && byPath.get(edge.from)?.kind !== "tag" && !keep.has(edge.to)) next.add(edge.to);
        if (options.localIncoming && keep.has(edge.to) && byPath.get(edge.to)?.kind !== "tag" && !keep.has(edge.from)) next.add(edge.from);
      }
      for (const path of next) { keep.add(path); layers.set(path, depth + 1); }
    }
    nodes = nodes.filter(node => keep.has(node.path)).map(node => ({ ...node, weight: Math.max(0, 30 - 30 / options.localDepth * (layers.get(node.path) ?? 0)) }));
    ids = keep; edges = edges.filter(edge => ids.has(edge.from) && ids.has(edge.to));
  } else nodes = nodes.map(node => ({ ...node, weight: undefined }));
  const degrees = new Map<string, number>();
  for (const edge of edges) {
    degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1);
    degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1);
  }
  nodes = nodes.map(node => ({ ...node, degree: degrees.get(node.path) ?? 0 }));
  if (!options.showOrphans) {
    const connected = new Set(edges.flatMap(edge => [edge.from, edge.to]));
    nodes = nodes.filter(node => connected.has(node.path) || node.path === localCenter);
  }
  return { nodes, edges, thoughts: snapshot.thoughts };
}
