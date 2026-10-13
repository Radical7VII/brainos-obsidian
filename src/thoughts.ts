import { App, TFile, normalizePath } from "obsidian";

export type Point = { x: number; y: number };
/// 一行文本就是一个节点；缩进表示父节点指向子节点。
export type OutlineRow = { text: string; depth: number };
export type GraphNode = Point & { path: string; label: string; openPath: string; degree: number; thoughts: string[]; placeholder?: boolean };
export type GraphEdge = { from: string; to: string; thoughts: string[] };
export type GraphSnapshot = { nodes: GraphNode[]; edges: GraphEdge[]; thoughts: { path: string; title: string }[] };

/// 新思考文件直接放到资料库根目录，和 BrainOS 的 `<标题>.md` 约定一致。
export const DEFAULT_THOUGHT_FOLDER = "";
export const THOUGHT_STATE_FOLDER = ".brainos/thoughts/.state";

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const LEGACY_STATE = /<!--\s*brainos-state\s*\n([\s\S]*?)\n-->/;
const HEADING = /^#+\s/;
const LIST_MARKER = /^[-*+]\s+/;

/// BrainOS 旧格式：步骤里的 `atom` 是被引用的笔记键（可能是路径）。
function legacyRows(markdown: string): OutlineRow[] | undefined {
  const match = markdown.match(LEGACY_STATE);
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[1]) as { paths?: { steps?: Record<string, unknown>[] }[] };
    if (!Array.isArray(value.paths)) return undefined;
    const rows: OutlineRow[] = [];
    for (const path of value.paths) {
      for (const step of path.steps ?? []) {
        const key = String(step.atom ?? step.nodeID ?? step.node ?? "").trim();
        if (key) rows.push({ text: atomLabel(key), depth: 0 });
      }
    }
    return rows;
  } catch { return undefined; }
}

export function atomLabel(key: string) {
  const last = key.split("/").pop() ?? key;
  return last.replace(/\.thought\.md$/i, "").replace(/\.md$/i, "") || key;
}

/// 解析思考文件的逐行大纲：空行与 Markdown 标题不算节点。
export function parseOutline(markdown: string): OutlineRow[] {
  const legacy = legacyRows(markdown);
  if (legacy) return legacy;
  const body = markdown.replace(FRONTMATTER, "").replace(HTML_COMMENT, "");
  const rows: OutlineRow[] = [];
  const widths: number[] = [];
  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    const indent = raw.match(/^[ \t]*/)![0];
    const width = [...indent].reduce((total, char) => total + (char === "\t" ? 4 : 1), 0);
    let text = raw.slice(indent.length).trim();
    if (LIST_MARKER.test(text)) text = text.replace(LIST_MARKER, "");
    text = text.replace(/&#x20;/g, " ").trim();
    if (!text || HEADING.test(text)) continue;
    if (text.startsWith("[[") && text.endsWith("]]") && text.length > 4) {
      text = atomLabel(text.slice(2, -2));
    }
    while (widths.length && widths[widths.length - 1] >= width) widths.pop();
    rows.push({ text, depth: widths.length });
    widths.push(width);
  }
  return rows;
}

export function outlineText(rows: OutlineRow[]) {
  return rows.map((row) => "    ".repeat(row.depth) + row.text).join("\n");
}

/// 最近的、缩进更浅的前一行，就是这一行的父节点。
export function parentIndex(rows: OutlineRow[], index: number): number | undefined {
  if (!rows[index] || rows[index].depth <= 0) return undefined;
  for (let i = index - 1; i >= 0; i--) if (rows[i].depth < rows[index].depth) return i;
  return undefined;
}

/// 父节点子树（含全部更深缩进的子行）之后的位置。
export function subtreeEnd(rows: OutlineRow[], index: number): number {
  let end = index + 1;
  while (end < rows.length && rows[end].depth > rows[index].depth) end++;
  return end;
}

export function thoughtTitle(file: TFile) {
  return file.basename.replace(/\.thought$/i, "") || file.basename;
}

function targetFolder(folder: string) {
  return normalizePath(folder.trim().replace(/^\/+|\/+$/g, ""));
}

async function uniquePath(app: App, title: string, folder: string) {
  const normalized = targetFolder(folder);
  if (normalized) await ensureFolder(app, normalized);
  const safe = title.replace(/[\\/:*?"<>|\r\n]/g, "-").trim().replace(/[. ]+$/g, "") || "未命名思考";
  const base = normalizePath(`${normalized}/${safe}.md`.replace(/^\/+/, ""));
  if (!app.vault.getAbstractFileByPath(base)) return base;
  for (let i = 2; ; i++) {
    const path = normalizePath(`${normalized}/${safe} ${i}.md`.replace(/^\/+/, ""));
    if (!app.vault.getAbstractFileByPath(path)) return path;
  }
}

export async function ensureFolder(app: App, folder: string) {
  const normalized = targetFolder(folder);
  let current = "";
  for (const part of normalized.split("/")) {
    if (!part) continue;
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}

export async function createThought(app: App, title: string, folder: string) {
  const path = await uniquePath(app, title, folder);
  return app.vault.create(path, "");
}

/// 读取 BrainOS 写入的身份缓存，把 BrainOS 新建的普通 `<标题>.md` 也认成思考文件。
/// `.brainos/` 是隐藏目录，不在 vault 索引里，只能走底层 adapter。
async function cachedThoughtPaths(app: App): Promise<Set<string>> {
  const paths = new Set<string>();
  let listing: { files: string[] };
  try { listing = await app.vault.adapter.list(THOUGHT_STATE_FOLDER); } catch { return paths; }
  for (const file of listing.files) {
    if (!file.endsWith(".json")) continue;
    try {
      const value = JSON.parse(await app.vault.adapter.read(file)) as { filename?: string };
      if (value.filename) paths.add(normalizePath(value.filename));
    } catch { /* 损坏的缓存忽略 */ }
  }
  return paths;
}

/// 思考文件：`<标题>.md` 大纲。旧的 `.thought.md`、frontmatter 标记、BrainOS 缓存和插件自己新建的文件都算。
export async function listThoughtFiles(app: App, folder: string, known: string[]): Promise<TFile[]> {
  const normalized = targetFolder(folder);
  const cached = await cachedThoughtPaths(app);
  const recorded = new Set(known.map((path) => normalizePath(path)));
  return app.vault.getMarkdownFiles().filter((file) => {
    if (recorded.has(file.path) || cached.has(file.path)) return true;
    if (/\.thought\.md$/i.test(file.path)) return true;
    if (app.metadataCache.getFileCache(file)?.frontmatter?.brainos_type === "thought-file") return true;
    return normalized.length > 0 && file.path.startsWith(normalized + "/");
  });
}

export async function buildSnapshot(app: App, thoughts: TFile[]): Promise<GraphSnapshot> {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const list: GraphSnapshot["thoughts"] = [];
  for (const file of thoughts) {
    const title = thoughtTitle(file);
    list.push({ path: file.path, title });
    const rows = parseOutline(await app.vault.cachedRead(file));
    if (!rows.length) {
      nodes.set(`thought:${file.path}`, { path: `thought:${file.path}`, label: title, openPath: file.path, x: 0, y: 0, degree: 0, thoughts: [file.path], placeholder: true });
      continue;
    }
    for (let i = 0; i < rows.length; i++) {
      const key = rows[i].text;
      const node = nodes.get(key) ?? { path: key, label: key, openPath: file.path, x: 0, y: 0, degree: 0, thoughts: [] };
      if (!node.thoughts.includes(file.path)) node.thoughts.push(file.path);
      nodes.set(key, node);
      const parent = parentIndex(rows, i);
      if (parent === undefined) continue;
      const from = rows[parent].text;
      if (from === key) continue;
      const edgeKey = JSON.stringify([from, key]);
      const edge = edges.get(edgeKey) ?? { from, to: key, thoughts: [] };
      if (!edge.thoughts.includes(file.path)) edge.thoughts.push(file.path);
      edges.set(edgeKey, edge);
    }
  }
  for (const edge of edges.values()) { nodes.get(edge.from)!.degree++; nodes.get(edge.to)!.degree++; }
  return { nodes: [...nodes.values()], edges: [...edges.values()], thoughts: list };
}

/// 只保留作者写下的正文大纲；旧的 frontmatter/状态块在写入时一并迁移掉。
export async function editOutline(app: App, path: string, edit: (rows: OutlineRow[]) => OutlineRow[] | void) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new Error("思考文件已不存在");
  await app.vault.process(file, (markdown) => {
    const rows = parseOutline(markdown);
    return outlineText(edit(rows) ?? rows);
  });
}

/// 在 `index` 处插入一行并回写文件。
export async function appendRoot(app: App, thought: string, text: string) {
  await editOutline(app, thought, (rows) => { rows.push({ text, depth: 0 }); });
}

export async function addChild(app: App, thought: string, parentText: string | undefined, text: string) {
  await editOutline(app, thought, (rows) => {
    const parent = parentText === undefined ? -1 : rows.findIndex((row) => row.text === parentText);
    if (parent >= 0) { rows.splice(subtreeEnd(rows, parent), 0, { text, depth: rows[parent].depth + 1 }); return; }
    rows.push({ text, depth: 0 });
  });
}

export async function addSibling(app: App, thought: string, siblingText: string, text: string) {
  await editOutline(app, thought, (rows) => {
    const sibling = rows.findIndex((row) => row.text === siblingText);
    if (sibling >= 0) { rows.splice(subtreeEnd(rows, sibling), 0, { text, depth: rows[sibling].depth }); return; }
    rows.push({ text, depth: 0 });
  });
}

/// 相同文字是同一个节点，所以改名会改掉这份思考里该文字的所有出现。
export async function renameNode(app: App, thought: string, from: string, to: string) {
  await editOutline(app, thought, (rows) => {
    let changed = false;
    for (const row of rows) if (row.text === from) { row.text = to; changed = true; }
    if (!changed) throw new Error("节点已不存在");
  });
}

/// 删除这份思考里该节点的所有出现，连同它们各自的子行。
export async function removeNode(app: App, thought: string, text: string) {
  await editOutline(app, thought, (rows) => {
    let changed = false;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].text !== text) continue;
      rows.splice(i, subtreeEnd(rows, i) - i);
      changed = true;
    }
    if (!changed) throw new Error("节点已不存在");
  });
}
