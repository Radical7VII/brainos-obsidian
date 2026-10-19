import { App, TFile, TFolder, normalizePath } from "obsidian";

export type Point = { x: number; y: number };
export type ThoughtStep = Record<string, unknown>;
export type ThoughtPath = { id?: string; title?: string; steps?: ThoughtStep[] };
export type ThoughtState = { paths?: ThoughtPath[]; draft?: string; viewport?: Point & { zoom: number } };
export type GraphNode = Point & { path: string; label: string; openPath: string; degree: number; thoughts: string[]; placeholder?: boolean; ownerPath?: string; nodeId?: string; kind?: "note" | "unresolved" | "tag" | "attachment"; weight?: number; tags?: string[] };
export type GraphEdge = { from: string; to: string; thoughts: string[] };
export type ThoughtVisit = { key: string; title: string; body: string; thoughtPath: string; pathIndex: number; ordinal: number };
export type GraphSnapshot = { nodes: GraphNode[]; edges: GraphEdge[]; thoughts: { path: string; title: string }[]; steps?: ThoughtVisit[] };
export const DEFAULT_NOTE_FOLDER = "";
const STATE_BLOCK = /<!--\s*brainos-state\s*\n([\s\S]*?)\n-->/;

/** Sanitize filenames only; node names remain ordinary text. */
export function nodeTitle(value: string): string {
  return value.replace(/[\\/:*?"<>|\r\n]/g, "-").trim().replace(/[. ]+$/g, "") || "未命名";
}

export function stepKey(step: ThoughtStep): string {
  // Native BrainOS writes `nodeID`; older exports and third-party importers
  // have used the other spellings below. Keep the raw value as a string so a
  // path, wikilink target, or UUID can all be resolved by buildSnapshot.
  return String(
    step.atom ?? step.nodeID ?? step.nodeId ?? step.node_id ??
    step.atomID ?? step.atomId ?? step.atom_id ?? step.node ??
    step.path ?? step.filePath ?? step.file ?? "",
  ).trim();
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

export { buildThoughtSnapshot as buildSnapshot } from "./thought-store";

function targetFolder(folder: string) {
  const value = folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (value.split("/").some(part => part === ".." || part === ".")) throw new Error("请使用笔记库内的文件夹路径");
  return value ? normalizePath(value) : "";
}

export async function ensureFolder(app: App, folder: string) {
  const normalized = targetFolder(folder);
  if (!normalized) return;
  let current = "";
  for (const part of normalized.split("/")) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}

export async function createThought(app: App, title: string, folder: string) {
  const normalized = targetFolder(folder);
  await ensureFolder(app, normalized);
  const parent = normalized ? app.vault.getFolderByPath(normalized) : app.vault.getRoot();
  if (!parent) throw new Error("新思考存放文件夹不存在");
  // Obsidian's native creation flow handles filename normalization and collisions.
  // This internal API is not included in the public Obsidian type declarations.
  const fileManager = app.fileManager as typeof app.fileManager & {
    createNewMarkdownFile(parent: TFolder, name?: string, content?: string): Promise<TFile>;
  };
  return fileManager.createNewMarkdownFile(parent, title.trim() || "未命名思考", "");
}
