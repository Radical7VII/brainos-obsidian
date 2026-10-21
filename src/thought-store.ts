import { processGraphFile } from "./graph-history";
import { App, TFile } from "obsidian";
import { isThoughtFile } from "./thought-scope";
import { parseThoughtState, stepKey } from "./thoughts";
import type { GraphNode, GraphSnapshot } from "./thoughts";
import {
  DocumentNode, NodeEditSnapshot, ThoughtDocument, appendDocumentContinuation, appendDocumentStep, cleanNodeTitle,
  documentLinks, insertDocumentStepBefore, nodeKey, nodeRevision, occurrenceTitle, parseThoughtDocument, removeDocumentNode,
  removeDocumentRelation, splitNodeKey, titleID, unlinkDocumentBody, updateDocumentNode, wikiLink,
} from "./thought-document";
import { convertParagraphThought, stripBrainOSProperties, uniqueLegacyTitle } from "./thought-migration";

type LoadedThought = { original: string; markdown: string; doc: ThoughtDocument; legacy: boolean; aliases: Map<string, string> };
const LEGACY_STATE = /<!--\s*brainos-state\s*\n[\s\S]*?\n-->/;
function requireFile(app: App, path: string) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile) || file.extension !== "md") throw new Error("思考文件已不存在");
  return file;
}

/** Viewing never writes. A legacy file is migrated only inside an explicit edit. */
export async function loadThoughtDocument(app: App, file: TFile, folder?: string): Promise<LoadedThought> {
  const original = await app.vault.cachedRead(file);
  const paragraphs = convertParagraphThought(original);
  if (paragraphs) return { original, ...paragraphs, doc: parseThoughtDocument(paragraphs.markdown), legacy: true };
  const state = parseThoughtState(original), aliases = new Map<string, string>();
  if (LEGACY_STATE.test(original) && !state) throw new Error("旧思考状态损坏，原文件未修改");
  if (!state) return { original, markdown: original, doc: parseThoughtDocument(original), legacy: false, aliases };
  let markdown = stripBrainOSProperties(original.replace(LEGACY_STATE, "")).trimEnd();
  if (state.draft?.trim()) markdown += "\n\n" + state.draft.trim() + "\n";
  const byLegacyID = new Map(app.vault.getMarkdownFiles().filter(file => folder === undefined || isThoughtFile(file.path, folder)).flatMap(atom => {
    const id = app.metadataCache.getFileCache(atom)?.frontmatter?.brainos_id;
    return id == null ? [] : [[String(id).toLowerCase(), atom] as const];
  }));
  const imported = new Map<string, string>(), used = new Set<string>();
  for (const path of state.paths ?? []) {
    let newPath = true;
    for (const step of path.steps ?? []) {
      const key = stepKey(step);
      if (!key) { newPath = true; continue; }
      const direct = app.vault.getAbstractFileByPath(key);
      const atom = direct instanceof TFile ? direct : byLegacyID.get(key.toLowerCase()) ?? app.metadataCache.getFirstLinkpathDest(key, file.path);
      if (atom && folder !== undefined && !isThoughtFile(atom.path, folder)) continue;
      const identity = atom?.path ?? key, known = imported.get(identity);
      const title = known ?? uniqueLegacyTitle(atom?.basename ?? key, used);
      imported.set(identity, title);
      const body = known ? "" : atom && atom.path !== file.path ? await app.vault.cachedRead(atom) : atom ? "" : "原节点引用：" + key;
      markdown = appendDocumentStep(markdown, title, body, newPath);
      newPath = false;
    }
  }
  return { original, markdown, doc: parseThoughtDocument(markdown), legacy: true, aliases };
}

async function mutateThought(app: App, filePath: string, edit: (markdown: string, loaded: LoadedThought) => string) {
  const file = requireFile(app, filePath), loaded = await loadThoughtDocument(app, file);
  await processGraphFile(app, file, current => {
    if (loaded.legacy && current !== loaded.original) throw new Error("旧思考在转换期间已变化，请刷新后重试");
    if (!loaded.legacy && (LEGACY_STATE.test(current) || convertParagraphThought(current))) throw new Error("思考格式已变化，请刷新后重试");
    const next = edit(loaded.legacy ? loaded.markdown : current, loaded);
    parseThoughtDocument(next);
    return next;
  });
  if (loaded.legacy && loaded.aliases.size) await migrateIncomingAnchors(app, filePath, loaded.aliases);
}
/** Preserve existing plugin references when a source drops its old block IDs. */
async function migrateIncomingAnchors(app: App, source: string, aliases: Map<string, string>) {
  const rewrite = (markdown: string, owner: string) => {
    let next = markdown;
    for (const link of documentLinks(markdown).reverse()) {
      const target = referenceFile(app, owner, link.target);
      const title = target.anchor.startsWith("^") ? aliases.get(target.anchor.slice(1)) : undefined;
      if (target.file?.path !== source || !title) continue;
      next = next.slice(0, link.start) + wikiLink(target.rawPath + "#" + title, link.label ?? title) + next.slice(link.end);
    }
    return next;
  };
  for (const file of app.vault.getMarkdownFiles()) {
    const before = await app.vault.cachedRead(file);
    if (rewrite(before, file.path) !== before) await processGraphFile(app, file, current => rewrite(current, file.path));
  }
}
function findNode(loaded: LoadedThought, id: string) {
  return loaded.doc.nodes.find(node => node.id === id)
    ?? loaded.doc.nodes.find(node => node.id === titleID(loaded.aliases.get(id) ?? ""));
}
function referenceFile(app: App, owner: string, target: string) {
  const hash = target.indexOf("#"), rawPath = hash >= 0 ? target.slice(0, hash) : target;
  const anchor = hash >= 0 ? target.slice(hash + 1) : "";
  const direct = app.vault.getAbstractFileByPath(rawPath || owner);
  const file = direct instanceof TFile ? direct : app.metadataCache.getFirstLinkpathDest(rawPath, owner);
  return { file: file instanceof TFile ? file : undefined, anchor, rawPath };
}
async function resolveTarget(app: App, owner: string, target: string, label?: string, read = (file: TFile) => loadThoughtDocument(app, file), nodeReference = false) {
  const { file, anchor } = referenceFile(app, owner, target);
  if (file?.extension === "md") {
    const loaded = await read(file);
    let node: DocumentNode | undefined;
    if (anchor.startsWith("^")) node = findNode(loaded, anchor.slice(1));
    else if (anchor) node = loaded.doc.nodes.find(node => !node.target && node.title === anchor);
    // A plain file link with a node-name alias is the optional cross-file node reference.
    else if (label && nodeReference) node = loaded.doc.nodes.find(node => !node.target && node.title === label);
    // Old block links can still be read after conversion when their readable alias survives.
    if (!node && anchor.startsWith("^") && label) node = loaded.doc.nodes.find(node => !node.target && node.title === label);
    if (node) return { key: nodeKey(file.path, node.id), file, node };
  }
  const name = nodeReference && label && !anchor ? "#brainos=" + encodeURIComponent(titleID(label)) : "";
  return { key: file ? file.path + (anchor ? "#" + anchor : name) : target + name, file, anchor, nodeReference };
}

export async function readThoughtNode(app: App, key: string, ordinal?: number) {
  const ref = splitNodeKey(key);
  if (!ref) throw new Error("请选择思考文件中的节点");
  const file = requireFile(app, ref.file), loaded = await loadThoughtDocument(app, file);
  const node = findNode(loaded, ref.id);
  if (!node || node.target) throw new Error("来源节点已不存在");
  const visit = node.occurrences[ordinal ?? node.occurrences.length - 1];
  if (!visit) throw new Error("这次记录已不存在，请刷新后重试");
  return { file, occurrences: node.occurrences, node: { ...node, body: visit.body, start: visit.start,
    ordinal: visit.ordinal, revision: nodeRevision(node) } };
}
function graphEntry(owner: string, node: Pick<GraphNode, "path" | "label" | "ownerPath">, markdown: string) {
  const ref = splitNodeKey(node.path);
  if (ref?.file === owner || node.ownerPath === owner) {
    const found = parseThoughtDocument(markdown).nodes.find(value => value.id === ref?.id);
    if (!found || found.target) throw new Error("起点节点已变化，请刷新后重试");
    return found.title;
  }
  if (!node.ownerPath) throw new Error("来源节点已不存在");
  return wikiLink(node.ownerPath, node.label);
}
export async function createThoughtNode(app: App, owner: string, title: string, body = "", parent?: { key: string; title: string; newPath?: boolean }) {
  const value = cleanNodeTitle(title);
  if (parseThoughtDocument("- " + value).nodes[0]?.target) throw new Error("节点名称不能是完整的文件引用，请使用引用已有节点");
  await mutateThought(app, owner, (markdown, loaded) => {
    let from: string | undefined;
    if (parent) {
      const ref = splitNodeKey(parent.key);
      const actual = ref?.file === owner ? findNode({ ...loaded, doc: parseThoughtDocument(markdown) }, ref.id) : undefined;
      from = actual ? occurrenceTitle(actual) : graphEntry(owner, { path: parent.key, label: parent.title, ownerPath: ref?.file }, markdown);
    }
    if (from && parent?.newPath) return appendDocumentStep(appendDocumentStep(markdown, from, "", true), value, body);
    return appendDocumentContinuation(markdown, from, value, body);
  });
  return nodeKey(owner, titleID(value));
}
export type InsertThoughtTarget = { child: string; parent: string; ordinal: number };
export async function insertThoughtNode(app: App, owner: string, title: string, target: InsertThoughtTarget) {
  const keys = await referenceKeys(app, owner);
  await mutateThought(app, owner, markdown => {
    const visits = parseThoughtDocument(markdown).occurrences;
    const matches = visits.flatMap((visit, index) => keys.entry(visit.id) === target.child && visit.ordinal === target.ordinal ? [index] : []);
    if (matches.length !== 1) throw new Error("当前节点的记录已变化，请刷新后重试");
    const index = matches[0], previous = visits[index - 1];
    if (!previous || previous.path !== visits[index].path || keys.entry(previous.id) !== target.parent) {
      throw new Error("父节点或路径已变化，请刷新后重试");
    }
    return insertDocumentStepBefore(markdown, index, title);
  });
  return nodeKey(owner, titleID(cleanNodeTitle(title)));
}

export async function editThoughtNode(app: App, key: string, title: string, body: string | undefined, expected?: NodeEditSnapshot, allowMerge = false) {
  const ref = splitNodeKey(key);
  if (!ref) throw new Error("请选择思考文件中的节点");
  const value = cleanNodeTitle(title);
  let oldTitle = "";
  await mutateThought(app, ref.file, (text, loaded) => {
    const actual = findNode({ ...loaded, doc: parseThoughtDocument(text) }, ref.id);
    if (!actual) throw new Error("节点已不存在，请刷新后重试");
    oldTitle = actual.title;
    return updateDocumentNode(text, actual.id, value, body, expected, allowMerge);
  });
  if (oldTitle !== value) await renameIncomingReferences(app, ref.file, oldTitle, value);
  return nodeKey(ref.file, titleID(value));
}
/** Keep explicit named references readable after a plugin rename, without adding anchors. */
async function renameIncomingReferences(app: App, source: string, oldTitle: string, title: string) {
  const rewrite = (markdown: string, owner: string) => {
    let next = markdown;
    for (const link of documentLinks(markdown).reverse()) {
      const target = referenceFile(app, owner, link.target);
      if (target.file?.path !== source) continue;
      let path = link.target, label = link.label;
      if (target.anchor === oldTitle || (target.anchor.startsWith("^") && label === oldTitle)) {
        path = target.rawPath + "#" + title;
        if (label === oldTitle) label = title;
      } else if (!target.anchor && label === oldTitle) label = title;
      else continue;
      next = next.slice(0, link.start) + wikiLink(path, label ?? title) + next.slice(link.end);
    }
    return next;
  };
  for (const file of app.vault.getMarkdownFiles()) {
    const before = await app.vault.cachedRead(file);
    if (rewrite(before, file.path) === before) continue;
    await processGraphFile(app, file, current => rewrite(current, file.path));
  }
}
export async function linkThoughtNodes(app: App, owner: string, from: GraphNode, to: GraphNode) {
  await mutateThought(app, owner, text => appendDocumentContinuation(text, graphEntry(owner, from, text), graphEntry(owner, to, text)));
}
export async function referenceThoughtNode(app: App, owner: string, node: GraphNode, parent?: GraphNode, newPath = false) {
  if (!node.nodeId || !node.ownerPath) throw new Error("请选择思考文件中的节点");
  await readThoughtNode(app, node.path);
  await mutateThought(app, owner, text => {
    const from = parent ? graphEntry(owner, parent, text) : undefined, to = graphEntry(owner, node, text);
    if (from && newPath) return appendDocumentStep(appendDocumentStep(text, from, "", true), to);
    return appendDocumentContinuation(text, from, to);
  });
}

/** Resolve references before the atomic edit; offsets are always computed on the current text. */
async function referenceKeys(app: App, owner: string) {
  const doc = (await loadThoughtDocument(app, requireFile(app, owner))).doc;
  const entries = new Map<string, string>(), links = new Map<string, string>();
  for (const node of doc.nodes) {
    entries.set(node.id, node.target ? (await resolveTarget(app, owner, node.target, node.referenceLabel, undefined, node.referenceLabel !== undefined)).key : nodeKey(owner, node.id));
    for (const visit of node.occurrences) for (const link of documentLinks(visit.body)) {
      links.set(JSON.stringify([link.target, link.label]), (await resolveTarget(app, owner, link.target, link.label)).key);
    }
  }
  return { entry: (id: string) => entries.get(id) ?? nodeKey(owner, id),
    link: (target: string, label?: string) => links.get(JSON.stringify([target, label])) };
}
export async function unlinkThoughtNodes(app: App, owner: string, from: string, to: string, bidirectional = false) {
  const keys = await referenceKeys(app, owner);
  await mutateThought(app, owner, text => {
    const matches = (a: string | undefined, b: string | undefined) => a === from && b === to || bidirectional && a === to && b === from;
    let next = removeDocumentRelation(text, (a, b) => matches(keys.entry(a), keys.entry(b)));
    for (const node of parseThoughtDocument(next).nodes.filter(node => keys.entry(node.id) === from || bidirectional && keys.entry(node.id) === to)) {
      next = unlinkDocumentBody(next, node.id, (target, label) => matches(keys.entry(node.id), keys.link(target, label)));
    }
    return next;
  });
}
export async function removeThoughtNode(app: App, owner: string, key: string) {
  return removeThoughtNodes(app, owner, [key]);
}
export async function removeThoughtNodes(app: App, owner: string, selected: string[]) {
  const keys = await referenceKeys(app, owner), removed = new Set(selected);
  await mutateThought(app, owner, text => {
    let next = text;
    for (const node of parseThoughtDocument(next).nodes.filter(node => removed.has(keys.entry(node.id)))) next = removeDocumentNode(next, node.id);
    for (const node of parseThoughtDocument(next).nodes) next = unlinkDocumentBody(next, node.id, (target, label) => removed.has(keys.link(target, label) ?? ""));
    return next;
  });
}

export async function buildThoughtSnapshot(app: App, thoughtFile?: TFile, folder?: string): Promise<GraphSnapshot> {
  const nodes = new Map<string, GraphNode>(), edges = new Map<string, GraphSnapshot["edges"][number]>();
  const thoughts: GraphSnapshot["thoughts"] = [], steps: NonNullable<GraphSnapshot["steps"]> = [];
  const loaded = new Map<string, Promise<LoadedThought>>();
  const read = (file: TFile) => {
    if (!loaded.has(file.path)) loaded.set(file.path, loadThoughtDocument(app, file, folder));
    return loaded.get(file.path)!;
  };
  const addNode = (file: TFile, node: DocumentNode, owner: string) => {
    const key = nodeKey(file.path, node.id);
    let value = nodes.get(key);
    if (!value) {
      value = { path: key, openPath: file.path, label: node.title, ownerPath: file.path, nodeId: node.id,
        x: NaN, y: NaN, degree: 0, thoughts: [], kind: "note" };
      nodes.set(key, value);
    }
    if (!value.thoughts.includes(owner)) value.thoughts.push(owner);
    return key;
  };
  const resolve = async (owner: string, target: string, label?: string, nodeReference = false) => {
    if (folder !== undefined) {
      const destination = referenceFile(app, owner, target).file;
      if (!destination || !isThoughtFile(destination.path, folder)) return "";
    }
    const resolved = await resolveTarget(app, owner, target, label, read, nodeReference);
    if (resolved.node && resolved.file) return addNode(resolved.file, resolved.node, owner);
    const { key, file } = resolved;
    let value = nodes.get(key);
    if (!value) {
      const missing = !file || !!resolved.anchor || !!resolved.nodeReference;
      value = { path: key, openPath: file?.path ?? target,
        label: label ?? (resolved.anchor ? "失效引用：" + resolved.anchor.replace(/^\^/, "") : file?.basename ?? target),
        ownerPath: file?.path, kind: missing ? "unresolved" : file.extension === "md" ? "note" : "attachment",
        thoughts: [], x: NaN, y: NaN, degree: 0 };
      nodes.set(key, value);
    }
    if (!value.thoughts.includes(owner)) value.thoughts.push(owner);
    return key;
  };
  const addEdge = (owner: string, from: string, to: string) => {
    if (!from || !to || from === to) return;
    const key = JSON.stringify([from, to]), edge = edges.get(key) ?? { from, to, thoughts: [] };
    if (!edge.thoughts.includes(owner)) edge.thoughts.push(owner);
    edges.set(key, edge);
  };
  for (const file of thoughtFile ? [thoughtFile] : app.vault.getMarkdownFiles()) {
    if (folder !== undefined && !isThoughtFile(file.path, folder)) continue;
    const document = await read(file);
    const marked = app.metadataCache.getFileCache(file)?.frontmatter?.brainos_type === "thought-file";
    if (!thoughtFile && !document.doc.occurrences.length && !document.legacy && !marked) continue;
    thoughts.push({ path: file.path, title: file.basename });
    const keys = new Map<string, string>();
    for (const node of document.doc.nodes) keys.set(node.id, node.target ? await resolve(file.path, node.target, node.referenceLabel, node.referenceLabel !== undefined) : addNode(file, node, file.path));
    for (const relation of document.doc.relations) addEdge(file.path, keys.get(relation.from)!, keys.get(relation.to)!);
    for (const visit of document.doc.occurrences) {
      const key = keys.get(visit.id)!;
      if (!key) continue;
      steps.push({ key, title: visit.title, body: visit.body, thoughtPath: file.path, pathIndex: visit.path, ordinal: visit.ordinal });
      for (const link of documentLinks(visit.body)) addEdge(file.path, key, await resolve(file.path, link.target, link.label));
    }
    if (!thoughtFile && !document.doc.nodes.length) nodes.set("thought:" + file.path, {
      path: "thought:" + file.path, label: file.basename, openPath: file.path, ownerPath: file.path, x: 0, y: 0,
      degree: 0, thoughts: [file.path], placeholder: true,
    });
  }
  for (const edge of edges.values()) { nodes.get(edge.from)!.degree++; nodes.get(edge.to)!.degree++; }
  return { nodes: [...nodes.values()], edges: [...edges.values()], thoughts, steps };
}
