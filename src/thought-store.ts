import { App, TFile } from "obsidian";
import { parseThoughtState, stepKey } from "./thoughts";
import type { GraphNode, GraphSnapshot } from "./thoughts";
import {
  DocumentNode, ThoughtDocument, anchorThoughtNodes, documentLinks, initializeThoughtDocument, insertDocumentNode,
  insertDocumentReference, insertDocumentRelation, isThoughtDocument, localTarget, newNodeID, nodeKey,
  parseThoughtDocument, removeDocumentReference, removeDocumentRelation, splitNodeKey,
  unlinkDocumentBody, updateDocumentNode,
} from "./thought-document";

type LoadedThought = { original: string; markdown: string; doc: ThoughtDocument; legacy: boolean };
const LEGACY_STATE = /<!--\s*brainos-state\s*\n[\s\S]*?\n-->/;
function requireFile(app: App, path: string) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile) || file.extension !== "md") throw new Error("思考文件已不存在");
  return file;
}
function stableID(key: string) {
  let a = 2166136261, b = 2246822507;
  for (let index = 0; index < key.length; index++) { a = Math.imul(a ^ key.charCodeAt(index), 16777619); b = Math.imul(b ^ key.charCodeAt(index), 3266489909); }
  return `node-legacy-${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}`;
}
function markThought(markdown: string) {
  const frontmatter = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) return `---\nbrainos_type: thought-file\nbrainos_version: 2\n---\n\n${markdown}`;
  let header = frontmatter[0];
  if (!/^brainos_type:/m.test(header)) header = header.replace(/^---\r?\n/, "---\nbrainos_type: thought-file\n");
  if (!/^brainos_version:/m.test(header)) header = header.replace(/^---\r?\n/, "---\nbrainos_version: 2\n");
  return header + markdown.slice(frontmatter[0].length);
}

/** Read-only conversion lets old thoughts display without modifying any user files. */
export async function loadThoughtDocument(app: App, file: TFile): Promise<LoadedThought> {
  const original = await app.vault.cachedRead(file);
  if (isThoughtDocument(original)) return { original, markdown: original, doc: parseThoughtDocument(original), legacy: false };
  const state = parseThoughtState(original);
  if (LEGACY_STATE.test(original) && !state) throw new Error("旧思考状态损坏，原文件未修改");
  const draft = state?.draft?.trim() ? `\n\n## 草稿\n\n${state.draft}` : "";
  let markdown = initializeThoughtDocument(original.replace(LEGACY_STATE, () => draft).trimEnd());
  if (!state) return { original, markdown, doc: parseThoughtDocument(markdown), legacy: false };
  const byLegacyID = new Map(app.vault.getMarkdownFiles().flatMap(atom => {
    const id = app.metadataCache.getFileCache(atom)?.frontmatter?.brainos_id;
    return id == null ? [] : [[String(id).toLowerCase(), atom] as const];
  }));
  const imported = new Map<string, { id: string; title: string }>();
  for (const path of state.paths ?? []) {
    let previous: { id: string; title: string } | undefined;
    for (const step of path.steps ?? []) {
      const key = stepKey(step);
      if (!key) { previous = undefined; continue; }
      const direct = app.vault.getAbstractFileByPath(key);
      const atom = direct instanceof TFile ? direct : byLegacyID.get(key.toLowerCase()) ?? app.metadataCache.getFirstLinkpathDest(key, file.path);
      const identity = atom?.path ?? key;
      let current = imported.get(identity);
      if (!current) {
        current = { id: stableID(identity), title: atom?.basename ?? key };
        // Keep the entire original note, including properties and nested Markdown.
        const body = atom && atom.path !== file.path ? await app.vault.cachedRead(atom) : atom ? "" : `原节点引用：${key}`;
        markdown = insertDocumentNode(markdown, current.id, current.title, body);
        imported.set(identity, current);
      }
      if (previous && previous.id !== current.id) markdown = insertDocumentRelation(markdown, `#^${previous.id}`, previous.title, `#^${current.id}`, current.title);
      previous = current;
    }
  }
  return { original, markdown, doc: parseThoughtDocument(markdown), legacy: true };
}

async function mutateThought(app: App, filePath: string, edit: (markdown: string) => string) {
  const file = requireFile(app, filePath), loaded = await loadThoughtDocument(app, file);
  await app.vault.process(file, current => {
    if (loaded.legacy && current !== loaded.original) throw new Error("旧思考在转换期间已变化，请刷新后重试");
    if (!loaded.legacy && LEGACY_STATE.test(current) && !isThoughtDocument(current)) throw new Error("思考格式已变化，请刷新后重试");
    const before = loaded.legacy ? loaded.markdown : initializeThoughtDocument(current);
    const next = edit(anchorThoughtNodes(before));
    parseThoughtDocument(next); // Fail before writing malformed identities.
    return markThought(next);
  });
}

function referenceFile(app: App, owner: string, target: string) {
  const hash = target.indexOf("#");
  const rawPath = hash >= 0 ? target.slice(0, hash) : target;
  const anchor = hash >= 0 ? target.slice(hash + 1) : "";
  const direct = app.vault.getAbstractFileByPath(rawPath || owner);
  const file = direct instanceof TFile ? direct : app.metadataCache.getFirstLinkpathDest(rawPath, owner);
  return { file: file instanceof TFile ? file : undefined, anchor, rawPath };
}
export function referenceKey(app: App, owner: string, target: string) {
  const { file, anchor, rawPath } = referenceFile(app, owner, target);
  const path = file?.path ?? (rawPath || owner);
  return anchor.startsWith("^") ? nodeKey(path, anchor.slice(1)) : anchor ? `${path}#${anchor}` : path;
}

export async function readThoughtNode(app: App, key: string) {
  const ref = splitNodeKey(key);
  if (!ref) throw new Error("请选择思考文件中的节点");
  const file = requireFile(app, ref.file), loaded = await loadThoughtDocument(app, file);
  const node = loaded.doc.nodes.find(node => node.id === ref.id);
  if (!node) throw new Error("来源节点已不存在");
  return { file, node };
}
async function ensureNodeAnchor(app: App, key: string) {
  if (!splitNodeKey(key)) return;
  const source = await readThoughtNode(app, key);
  const loaded = await loadThoughtDocument(app, source.file);
  if (loaded.legacy || source.node.needsAnchor) await mutateThought(app, source.file.path, text => text);
}

async function canonicalReferences(app: App, owner: string) {
  const loaded = await loadThoughtDocument(app, requireFile(app, owner));
  const targets = new Set([
    ...loaded.doc.references.map(link => link.target),
    ...loaded.doc.relations.flatMap(edge => [edge.from, edge.to]),
    ...loaded.doc.nodes.flatMap(node => documentLinks(node.body).map(link => link.target)),
  ]);
  const keys = new Map<string, string>();
  for (const target of targets) {
    const { file, anchor } = referenceFile(app, owner, target);
    if (file?.extension === "md" && anchor && !anchor.startsWith("^")) {
      const document = await loadThoughtDocument(app, file);
      const node = document.doc.nodes.find(node => node.title === anchor);
      if (node) { keys.set(target, nodeKey(file.path, node.id)); continue; }
    }
    keys.set(target, referenceKey(app, owner, target));
  }
  return (target: string) => keys.get(target) ?? referenceKey(app, owner, target);
}

export async function createThoughtNode(app: App, owner: string, title: string, body = "", parent?: { key: string; title: string }) {
  const id = newNodeID(), key = nodeKey(owner, id);
  if (parent && splitNodeKey(parent.key)?.file !== owner) await ensureNodeAnchor(app, parent.key);
  await mutateThought(app, owner, markdown => {
    let text = insertDocumentNode(markdown, id, title, body);
    if (parent) text = insertDocumentRelation(text, localTarget(owner, parent.key), parent.title, `#^${id}`, title);
    return text;
  });
  return key;
}
export async function editThoughtNode(app: App, key: string, title: string, body: string, expected?: { title: string; body: string }) {
  const ref = splitNodeKey(key);
  if (!ref) throw new Error("请选择思考文件中的节点");
  await mutateThought(app, ref.file, text => updateDocumentNode(text, ref.id, title, body, expected));
}
export async function linkThoughtNodes(app: App, owner: string, from: GraphNode, to: GraphNode) {
  if (from.ownerPath !== owner) await ensureNodeAnchor(app, from.path);
  if (to.ownerPath !== owner) await ensureNodeAnchor(app, to.path);
  await mutateThought(app, owner, text => insertDocumentRelation(text, localTarget(owner, from.path), from.label, localTarget(owner, to.path), to.label));
}
export async function referenceThoughtNode(app: App, owner: string, node: GraphNode, parent?: GraphNode) {
  if (!node.nodeId || !node.ownerPath) throw new Error("请选择思考文件中的节点");
  await ensureNodeAnchor(app, node.path);
  if (parent && parent.ownerPath !== owner) await ensureNodeAnchor(app, parent.path);
  await mutateThought(app, owner, text => {
    if (parent) return insertDocumentRelation(text, localTarget(owner, parent.path), parent.label, localTarget(owner, node.path), node.label);
    return insertDocumentReference(text, localTarget(owner, node.path), node.label);
  });
}
export async function unlinkThoughtNodes(app: App, owner: string, from: string, to: string) {
  const keyFor = await canonicalReferences(app, owner);
  await mutateThought(app, owner, text => {
    let next = removeDocumentRelation(text, (a, b) => keyFor(a) === from && keyFor(b) === to);
    const ref = splitNodeKey(from);
    if (ref?.file === owner) next = unlinkDocumentBody(next, ref.id, target => keyFor(target) === to);
    return next;
  });
}
export async function removeThoughtNode(app: App, owner: string, key: string) {
  const keyFor = await canonicalReferences(app, owner);
  await mutateThought(app, owner, text => {
    const ref = splitNodeKey(key);
    const parsed = parseThoughtDocument(text);
    let next = text;
    if (ref?.file === owner) {
      const node = parsed.nodes.find(node => node.id === ref.id);
      if (node) next = text.slice(0, node.start) + text.slice(node.end);
    }
    next = removeDocumentRelation(next, (a, b) => keyFor(a) === key || keyFor(b) === key);
    next = removeDocumentReference(next, target => keyFor(target) === key);
    for (const node of parseThoughtDocument(next).nodes) next = unlinkDocumentBody(next, node.id, target => keyFor(target) === key);
    return next;
  });
}

export async function buildThoughtSnapshot(app: App, thoughtFile?: TFile): Promise<GraphSnapshot> {
  const files = thoughtFile ? [thoughtFile] : app.vault.getMarkdownFiles().filter(file => {
    const cache = app.metadataCache.getFileCache(file);
    return cache?.frontmatter?.brainos_type === "thought-file" || Object.keys(cache?.blocks ?? {}).some(id => id.startsWith("node-"));
  });
  const nodes = new Map<string, GraphNode>(), edges = new Map<string, GraphSnapshot["edges"][number]>();
  const thoughts: GraphSnapshot["thoughts"] = [];
  const loaded = new Map<string, Promise<LoadedThought>>();
  const read = (file: TFile) => {
    if (!loaded.has(file.path)) loaded.set(file.path, loadThoughtDocument(app, file));
    return loaded.get(file.path)!;
  };
  const addNode = (file: TFile, node: DocumentNode, membership: string) => {
    const key = nodeKey(file.path, node.id);
    let value = nodes.get(key);
    if (!value) { value = { path: key, openPath: key, label: node.title, ownerPath: file.path, nodeId: node.id, x: NaN, y: NaN, degree: 0, thoughts: [], kind: "note" }; nodes.set(key, value); }
    if (!value.thoughts.includes(membership)) value.thoughts.push(membership);
    return key;
  };
  const resolve = async (owner: string, target: string, label?: string): Promise<string> => {
    const { file, anchor } = referenceFile(app, owner, target);
    const key = referenceKey(app, owner, target);
    if (file?.extension === "md" && anchor) {
      const doc = (await read(file)).doc;
      const node = anchor.startsWith("^") ? doc.nodes.find(node => node.id === anchor.slice(1)) : doc.nodes.find(node => node.title === anchor);
      if (node) return addNode(file, node, owner);
    }
    let value = nodes.get(key);
    if (!value) {
      const missing = !file || !!anchor;
      value = { path: key, openPath: file ? key : target, label: label ?? (anchor ? `失效引用：${anchor.replace(/^\^/, "")}` : file?.basename ?? target),
        ownerPath: file?.path, kind: missing ? "unresolved" : file.extension === "md" ? "note" : "attachment", thoughts: [], x: NaN, y: NaN, degree: 0 };
      nodes.set(key, value);
    }
    if (!value.thoughts.includes(owner)) value.thoughts.push(owner);
    return key;
  };
  const addEdge = (owner: string, from: string, to: string) => {
    if (from === to) return;
    const key = JSON.stringify([from, to]);
    const edge = edges.get(key) ?? { from, to, thoughts: [] };
    if (!edge.thoughts.includes(owner)) edge.thoughts.push(owner);
    edges.set(key, edge);
  };
  for (const file of files) {
    const document = await read(file);
    thoughts.push({ path: file.path, title: file.basename });
    for (const node of document.doc.nodes) addNode(file, node, file.path);
    for (const ref of document.doc.references) await resolve(file.path, ref.target, ref.label);
    for (const relation of document.doc.relations) addEdge(file.path, await resolve(file.path, relation.from), await resolve(file.path, relation.to));
    for (const node of document.doc.nodes) {
      for (const link of documentLinks(node.body)) addEdge(file.path, nodeKey(file.path, node.id), await resolve(file.path, link.target, link.label));
    }
    if (!document.doc.nodes.length && ![...nodes.values()].some(node => node.thoughts.includes(file.path))) nodes.set(`thought:${file.path}`, {
      path: `thought:${file.path}`, label: file.basename, openPath: file.path, ownerPath: file.path, x: 0, y: 0, degree: 0, thoughts: [file.path], placeholder: true,
    });
  }
  for (const edge of edges.values()) { nodes.get(edge.from)!.degree++; nodes.get(edge.to)!.degree++; }
  return { nodes: [...nodes.values()], edges: [...edges.values()], thoughts };
}
