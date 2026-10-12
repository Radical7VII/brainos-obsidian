import { App, TFile, normalizePath } from "obsidian";

export type Point = { x: number; y: number };
export type ThoughtStep = Record<string, unknown>;
export type ThoughtPath = { id?: string; title?: string; steps?: ThoughtStep[] };
export type ThoughtState = { paths?: ThoughtPath[]; draft?: string; viewport?: Point & { zoom: number } };
export type GraphNode = Point & { path: string; label: string; openPath: string; degree: number; thoughts: string[]; placeholder?: boolean };
export type GraphEdge = { from: string; to: string; thoughts: string[] };
export type GraphSnapshot = { nodes: GraphNode[]; edges: GraphEdge[]; thoughts: { path: string; title: string }[] };
export const DEFAULT_NOTE_FOLDER = "BrainOS/Thoughts";
const STATE_BLOCK = /<!--\s*brainos-state\s*\n([\s\S]*?)\n-->/;

export function stepKey(step: ThoughtStep): string {
  return String(step.atom ?? step.nodeID ?? step.node ?? "").trim();
}

export function parseThoughtState(markdown: string): ThoughtState | null {
  const match = markdown.match(STATE_BLOCK);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.paths !== undefined && (!Array.isArray(value.paths) || value.paths.some((path: ThoughtPath) =>
      !path || typeof path !== "object" || (path.steps !== undefined && (!Array.isArray(path.steps) || path.steps.some(step => !step || typeof step !== "object")))))) return null;
    return value as ThoughtState;
  } catch { return null; }
}

export function updateThoughtState(markdown: string, state: ThoughtState): string {
  if (!STATE_BLOCK.test(markdown)) throw new Error("思考文件缺少 brainos-state，无法保存图谱修改");
  return markdown.replace(STATE_BLOCK, () => `<!-- brainos-state\n${JSON.stringify(state, null, 2)}\n-->`);
}

export async function editThought(app: App, path: string, edit: (state: ThoughtState) => void) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new Error("思考文件已不存在");
  await app.vault.process(file, markdown => {
    const state = parseThoughtState(markdown);
    if (!state) throw new Error("思考状态缺失或损坏，请先修复 brainos-state；原文件未修改");
    edit(state);
    return updateThoughtState(markdown, state);
  });
}

export function addRoute(state: ThoughtState, keys: string[], title: string) {
  state.paths ??= [];
  state.paths.push({ id: crypto.randomUUID(), title, steps: keys.map(atom => ({ id: crypto.randomUUID(), atom })) });
}

// Splitting, rather than filtering, prevents A→B→C from silently becoming A→C.
export function splitRoutes(state: ThoughtState, removeNode?: string, removeEdge?: { from: string; to: string }) {
  const paths: ThoughtPath[] = [];
  for (const path of state.paths ?? []) {
    let segment: ThoughtStep[] = [];
    let first = true;
    const flush = () => {
      if (!segment.length) return;
      paths.push({ ...path, id: first ? path.id : crypto.randomUUID(), steps: segment });
      first = false;
      segment = [];
    };
    for (const step of path.steps ?? []) {
      const key = stepKey(step);
      if (key === removeNode) { flush(); continue; }
      const previous = segment[segment.length - 1];
      if (removeEdge && previous && stepKey(previous) === removeEdge.from && key === removeEdge.to) flush();
      segment.push(step);
    }
    flush();
  }
  state.paths = paths;
}

export async function buildSnapshot(app: App): Promise<GraphSnapshot> {
  const files = app.vault.getMarkdownFiles().filter(file => app.metadataCache.getFileCache(file)?.frontmatter?.brainos_type === "thought-file");
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const thoughts: GraphSnapshot["thoughts"] = [];
  for (const file of files) {
    const title = String(app.metadataCache.getFileCache(file)?.frontmatter?.title ?? file.basename.replace(/\.thought$/, ""));
    thoughts.push({ path: file.path, title });
    const state = parseThoughtState(await app.vault.cachedRead(file));
    let count = 0;
    for (const route of state?.paths ?? []) {
      let previous = "";
      for (const step of route.steps ?? []) {
        const key = stepKey(step);
        if (!key) { previous = ""; continue; }
        const resolved = app.vault.getAbstractFileByPath(key);
        const atom = resolved instanceof TFile ? resolved : app.metadataCache.getFirstLinkpathDest(key, file.path);
        const node = nodes.get(key) ?? { path: key, label: atom?.basename ?? key, openPath: atom?.path ?? file.path, x: 0, y: 0, degree: 0, thoughts: [] };
        if (!node.thoughts.includes(file.path)) node.thoughts.push(file.path);
        nodes.set(key, node); count++;
        if (previous && previous !== key) {
          const edgeKey = JSON.stringify([previous, key]);
          const edge = edges.get(edgeKey) ?? { from: previous, to: key, thoughts: [] };
          if (!edge.thoughts.includes(file.path)) edge.thoughts.push(file.path);
          edges.set(edgeKey, edge);
        }
        previous = key;
      }
    }
    if (!count) nodes.set(`thought:${file.path}`, { path: `thought:${file.path}`, label: title, openPath: file.path, x: 0, y: 0, degree: 0, thoughts: [file.path], placeholder: true });
  }
  for (const edge of edges.values()) { nodes.get(edge.from)!.degree++; nodes.get(edge.to)!.degree++; }
  return { nodes: [...nodes.values()], edges: [...edges.values()], thoughts };
}

function targetFolder(folder: string) {
  return normalizePath(folder.trim().replace(/^\/+|\/+$/g, "")) || DEFAULT_NOTE_FOLDER;
}

export async function ensureFolder(app: App, folder: string) {
  const normalized = targetFolder(folder);
  let current = "";
  for (const part of normalized.split("/")) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}

async function uniquePath(app: App, title: string, folder: string, suffix: string) {
  const normalized = targetFolder(folder);
  await ensureFolder(app, normalized);
  const safe = title.replace(/[\\/:*?"<>|\r\n]/g, "-").trim().replace(/[. ]+$/g, "") || "未命名";
  const base = normalizePath(`${normalized}/${safe}${suffix}`);
  if (!app.vault.getAbstractFileByPath(base)) return base;
  for (let i = 2; ; i++) {
    const path = normalizePath(`${normalized}/${safe} ${i}${suffix}`);
    if (!app.vault.getAbstractFileByPath(path)) return path;
  }
}

export async function createThought(app: App, title: string, folder: string, source = "") {
  const path = await uniquePath(app, title, folder, ".thought.md");
  const now = new Date().toISOString();
  const state: ThoughtState = { paths: [], draft: "", viewport: { x: 0, y: 0, zoom: 1 } };
  return app.vault.create(path, `---\nbrainos_type: thought-file\nversion: 1\nid: ${crypto.randomUUID()}\ntitle: ${JSON.stringify(title)}\ncreated_at: ${now}\nupdated_at: ${now}\nstatus: active\n${source.trim() ? `source: ${JSON.stringify(source.trim())}\n` : ""}---\n\n# ${title}\n\n## 思路\n\n尚未形成思路。\n\n<!-- brainos-state\n${JSON.stringify(state, null, 2)}\n-->\n`);
}

export async function createAtom(app: App, title: string, body: string, folder: string) {
  const path = await uniquePath(app, title, folder, ".md");
  return app.vault.create(path, `# ${title}\n\n${body.trim()}\n`);
}
