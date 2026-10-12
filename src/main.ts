import {
  App, ItemView, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile,
  WorkspaceLeaf, normalizePath, setIcon
} from "obsidian";

const VIEW_TYPE = "brainos-graph-view";
const DATA_VERSION = 1;

type GraphNode = { path: string; label: string; openPath: string; x: number; y: number; degree: number };
type GraphEdge = { from: string; to: string };
type BrainOSSettings = { noteFolder: string };
type LayoutData = { version: number; positions: Record<string, { x: number; y: number }>; settings: BrainOSSettings };
type GraphSnapshot = { nodes: GraphNode[]; edges: GraphEdge[] };

const DEFAULT_SETTINGS: BrainOSSettings = { noteFolder: "BrainOS/Thoughts" };

export default class BrainOSPlugin extends Plugin {
  layout: LayoutData = { version: DATA_VERSION, positions: {}, settings: { ...DEFAULT_SETTINGS } };
  private refreshTimer: number | undefined;

  async onload() {
    const saved = await this.loadData() as Partial<LayoutData> | null;
    this.layout = {
      version: DATA_VERSION,
      positions: saved?.positions ?? {},
      settings: { ...DEFAULT_SETTINGS, ...(saved?.settings ?? {}) },
    };
    this.registerView(VIEW_TYPE, (leaf) => new BrainOSGraphView(leaf, this));
    this.addRibbonIcon("git-branch", "打开 BrainOS 图谱", () => this.activateView());
    this.addCommand({ id: "open-graph", name: "打开 BrainOS 图谱", callback: () => this.activateView() });
    this.addCommand({ id: "refresh-graph", name: "刷新 BrainOS 图谱", callback: () => this.refreshViews() });
    this.addCommand({ id: "focus-current-note", name: "将图谱聚焦到当前笔记", checkCallback: (checking) => {
      const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
      if (!view || !(view instanceof BrainOSGraphView)) return false;
      if (!checking) view.focusCurrent();
      return true;
    }});
    this.addCommand({ id: "create-thought", name: "创建 BrainOS 思考", callback: () => new ThoughtModal(this.app, this).open() });
    this.addCommand({ id: "append-current-note", name: "将当前笔记加入当前思考", callback: () => void this.appendCurrentNote() });
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("modify", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRefresh()));
    this.addSettingTab(new BrainOSSettingTab(this.app, this));
  }

  onunload() { if (this.refreshTimer) window.clearTimeout(this.refreshTimer); }

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  scheduleRefresh() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.refreshViews(), 350);
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof BrainOSGraphView) void view.refresh();
    }
  }

  async saveLayout() { await this.saveData(this.layout); }

  private async appendCurrentNote() {
    const note = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    const thoughtLeaf = this.app.workspace.getLeavesOfType("markdown").find((leaf) => {
      const file = (leaf.view as MarkdownView).file;
      return file && this.app.metadataCache.getFileCache(file)?.frontmatter?.brainos_type === "thought-file";
    });
    const thought = thoughtLeaf ? (thoughtLeaf.view as MarkdownView).file : undefined;
    if (!note || !thought || note.path === thought.path) { new Notice("请同时打开一个普通笔记和一个 BrainOS 思考文件"); return; }
    const source = await this.app.vault.read(thought); const state = parseThoughtState(source) ?? { paths: [], draft: "", viewport: { x: 0, y: 0, zoom: 1 } };
    state.paths ??= [];
    if (!state.paths.length) state.paths.push({ id: "path-main", title: "主思路", steps: [] });
    const path = state.paths[0]; path.steps ??= [];
    const previous = path.steps[path.steps.length - 1] as Record<string, unknown> | undefined;
    if (String(previous?.atom ?? "") === note.path) { new Notice("当前笔记已经是思路的最后一步"); return; }
    path.steps.push({ id: crypto.randomUUID(), atom: note.path });
    await this.app.vault.modify(thought, updateThoughtState(source, state));
    new Notice(`已加入思考：${thought.basename}`); this.refreshViews();
  }
}

class BrainOSGraphView extends ItemView {
  private plugin: BrainOSPlugin;
  private canvas!: HTMLCanvasElement;
  private search!: HTMLInputElement;
  private snapshot: GraphSnapshot = { nodes: [], edges: [] };
  private zoom = 1;
  private pan = { x: 0, y: 0 };
  private selected: string | undefined;
  private drag: { path: string; offsetX: number; offsetY: number } | undefined;
  private moving = false;

  constructor(leaf: WorkspaceLeaf, plugin: BrainOSPlugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "BrainOS 图谱"; }
  getIcon() { return "git-branch"; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("brainos-graph-view");
    const toolbar = this.contentEl.createDiv({ cls: "brainos-graph-toolbar" });
    const refresh = toolbar.createEl("button", { attr: { "aria-label": "刷新图谱" } }); setIcon(refresh, "refresh-cw");
    refresh.onclick = () => void this.refresh();
    const focus = toolbar.createEl("button", { text: "聚焦当前" }); focus.onclick = () => this.focusCurrent();
    this.search = toolbar.createEl("input", { type: "search", placeholder: "搜索原子…", attr: { "aria-label": "搜索原子" } });
    this.search.addEventListener("input", () => this.draw());
    this.canvas = this.contentEl.createEl("canvas", { cls: "brainos-graph-canvas" });
    this.canvas.tabIndex = 0;
    this.registerDomEvent(this.canvas, "pointerdown", (event) => this.onPointerDown(event));
    this.registerDomEvent(this.canvas, "pointermove", (event) => this.onPointerMove(event));
    this.registerDomEvent(this.canvas, "pointerup", (event) => this.onPointerUp(event));
    this.registerDomEvent(this.canvas, "pointerleave", (event) => this.onPointerUp(event));
    this.registerDomEvent(this.canvas, "wheel", (event) => this.onWheel(event));
    this.registerDomEvent(this.canvas, "dblclick", (event) => this.onDoubleClick(event));
    this.registerDomEvent(window, "resize", () => this.resize());
    this.resize();
    await this.refresh();
  }

  async refresh() {
    this.snapshot = await buildSnapshot(this.app);
    this.ensurePositions();
    this.resize();
  }

  focusCurrent() {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    if (!file) { new Notice("当前没有打开的 Markdown 笔记"); return; }
    const node = this.snapshot.nodes.find((item) => item.openPath === file.path);
    if (!node) { new Notice("当前文件尚未出现在 BrainOS 思考图谱中"); return; }
    this.selected = node.path;
    this.pan = { x: -node.x, y: -node.y };
    this.draw();
  }

  private ensurePositions() {
    const nodes = this.snapshot.nodes;
    const radius = Math.max(180, Math.sqrt(nodes.length) * 85);
    nodes.forEach((node, index) => {
      const saved = this.plugin.layout.positions[node.path];
      if (saved) { node.x = saved.x; node.y = saved.y; return; }
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const r = radius * Math.sqrt((index + 1) / Math.max(1, nodes.length));
      node.x = Math.cos(angle) * r; node.y = Math.sin(angle) * r;
      this.plugin.layout.positions[node.path] = { x: node.x, y: node.y };
    });
  }

  private resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.draw();
  }

  private worldToScreen(node: GraphNode) {
    return { x: this.canvas.clientWidth / 2 + (node.x + this.pan.x) * this.zoom, y: this.canvas.clientHeight / 2 + (node.y + this.pan.y) * this.zoom };
  }
  private screenToWorld(x: number, y: number) {
    return { x: (x - this.canvas.clientWidth / 2) / this.zoom - this.pan.x, y: (y - this.canvas.clientHeight / 2) / this.zoom - this.pan.y };
  }
  private nodeAt(x: number, y: number) {
    return [...this.snapshot.nodes].reverse().find((node) => { const p = this.worldToScreen(node); return Math.hypot(p.x - x, p.y - y) <= Math.max(10, 13 * this.zoom); });
  }

  private draw() {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d"); if (!ctx) return;
    const dpr = window.devicePixelRatio || 1; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    const colors = getComputedStyle(this.canvas); const edge = colors.getPropertyValue("--text-muted") || "#888"; const accent = colors.getPropertyValue("--interactive-accent") || "#7c3aed"; const text = colors.getPropertyValue("--text-normal") || "#222";
    const query = this.search?.value.trim().toLocaleLowerCase() ?? "";
    const matches = new Set(this.snapshot.nodes.filter((node) => node.label.toLocaleLowerCase().includes(query) || node.path.toLocaleLowerCase().includes(query)).map((node) => node.path));
    ctx.lineWidth = 1; ctx.strokeStyle = edge;
    for (const link of this.snapshot.edges) { const a = this.snapshot.nodes.find((n) => n.path === link.from); const b = this.snapshot.nodes.find((n) => n.path === link.to); if (!a || !b) continue; const p = this.worldToScreen(a), q = this.worldToScreen(b); ctx.globalAlpha = query && (!matches.has(a.path) || !matches.has(b.path)) ? .18 : .55; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
    for (const node of this.snapshot.nodes) { const p = this.worldToScreen(node); const active = node.path === this.selected || matches.has(node.path); const radius = Math.max(5, Math.min(12, 5 + node.degree * .7)); ctx.globalAlpha = query && !matches.has(node.path) ? .18 : 1; ctx.fillStyle = node.path === this.selected ? accent : (active ? accent : text); ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill(); if (active || !query) { ctx.font = "12px var(--font-text)"; ctx.textAlign = "center"; ctx.fillStyle = text; ctx.fillText(node.label.slice(0, 32), p.x, p.y + radius + 15); } }
    ctx.globalAlpha = 1;
    const empty = this.contentEl.querySelector(".brainos-graph-empty");
    if (!this.snapshot.nodes.length && !empty) this.contentEl.createDiv({ cls: "brainos-graph-empty", text: "还没有思考文件。使用命令创建一个思考。" });
    if (this.snapshot.nodes.length) empty?.remove();
  }

  private onPointerDown(event: PointerEvent) { const rect = this.canvas.getBoundingClientRect(); const x = event.clientX - rect.left, y = event.clientY - rect.top; const node = this.nodeAt(x, y); this.canvas.setPointerCapture(event.pointerId); if (node) { const world = this.screenToWorld(x, y); this.drag = { path: node.path, offsetX: node.x - world.x, offsetY: node.y - world.y }; this.selected = node.path; } else { this.moving = true; this.drag = undefined; } this.draw(); }
  private onPointerMove(event: PointerEvent) { const rect = this.canvas.getBoundingClientRect(); const x = event.clientX - rect.left, y = event.clientY - rect.top; if (this.drag) { const node = this.snapshot.nodes.find((item) => item.path === this.drag?.path); if (!node) return; const world = this.screenToWorld(x, y); node.x = world.x + this.drag.offsetX; node.y = world.y + this.drag.offsetY; this.plugin.layout.positions[node.path] = { x: node.x, y: node.y }; this.draw(); } else if (this.moving) { this.pan.x += event.movementX / this.zoom; this.pan.y += event.movementY / this.zoom; this.draw(); } }
  private onPointerUp(event: PointerEvent) { if (this.drag || this.moving) void this.plugin.saveLayout(); this.drag = undefined; this.moving = false; this.canvas.releasePointerCapture?.(event.pointerId); }
  private onWheel(event: WheelEvent) { event.preventDefault(); const rect = this.canvas.getBoundingClientRect(); const before = this.screenToWorld(event.clientX - rect.left, event.clientY - rect.top); this.zoom = Math.max(.2, Math.min(3, this.zoom * (event.deltaY > 0 ? .9 : 1.1))); const after = this.screenToWorld(event.clientX - rect.left, event.clientY - rect.top); this.pan.x += after.x - before.x; this.pan.y += after.y - before.y; this.draw(); }
  private onDoubleClick(event: MouseEvent) { const rect = this.canvas.getBoundingClientRect(); const node = this.nodeAt(event.clientX - rect.left, event.clientY - rect.top); if (node) void this.app.workspace.openLinkText(node.openPath, "", false); }
}

async function buildSnapshot(app: App): Promise<GraphSnapshot> {
  // Obsidian's metadataCache is the index. We only consider files explicitly
  // marked as BrainOS thought files; ordinary vault notes and their wikilinks
  // do not become graph nodes by accident.
  const files = app.vault.getMarkdownFiles().filter((file) => app.metadataCache.getFileCache(file)?.frontmatter?.brainos_type === "thought-file");
  const nodesByPath = new Map<string, GraphNode>(); const edges = new Map<string, GraphEdge>();
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file); const title = String(cache?.frontmatter?.title ?? file.basename.replace(/\.thought$/, ""));
    const text = await app.vault.cachedRead(file); const state = parseThoughtState(text);
    const paths = state?.paths ?? [];
    let stepCount = 0;
    for (const thoughtPath of paths) {
      const steps = Array.isArray(thoughtPath?.steps) ? thoughtPath.steps : [];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i] as Record<string, unknown>; const key = String(step.atom ?? step.nodeID ?? step.node ?? "").trim(); if (!key) continue;
        const resolved = resolveAtom(app, key); const node = nodesByPath.get(key) ?? { path: key, label: resolved.label, openPath: resolved.openPath ?? file.path, x: 0, y: 0, degree: 0 };
        node.openPath = resolved.openPath ?? file.path; node.label = resolved.label; nodesByPath.set(key, node); stepCount++;
        if (i > 0) { const prev = steps[i - 1] as Record<string, unknown>; const previous = String(prev.atom ?? prev.nodeID ?? prev.node ?? "").trim(); if (previous && previous !== key) edges.set(`${previous}→${key}`, { from: previous, to: key }); }
      }
    }
    if (!stepCount) nodesByPath.set(`thought:${file.path}`, { path: `thought:${file.path}`, label: title, openPath: file.path, x: 0, y: 0, degree: 0 });
  }
  const nodes = [...nodesByPath.values()];
  for (const edge of edges.values()) { const a = nodes.find((node) => node.path === edge.from); const b = nodes.find((node) => node.path === edge.to); if (a) a.degree++; if (b) b.degree++; }
  return { nodes, edges: [...edges.values()] };
}

type ThoughtState = { paths?: Array<{ id?: string; title?: string; steps?: Array<Record<string, unknown>> }>; draft?: string; viewport?: { x: number; y: number; zoom: number } };

function parseThoughtState(markdown: string): ThoughtState | null {
  const match = markdown.match(/<!--\s*brainos-state\s*\n([\s\S]*?)\n-->/);
  if (!match) return null;
  try { return JSON.parse(match[1]) as ThoughtState; } catch { return null; }
}

function updateThoughtState(markdown: string, state: ThoughtState) {
  const json = JSON.stringify(state, null, 2); const block = `<!-- brainos-state\n${json}\n-->`;
  return markdown.replace(/<!--\s*brainos-state\s*\n[\s\S]*?\n-->/, block);
}

function resolveAtom(app: App, key: string): { label: string; openPath?: string } {
  const abstract = app.vault.getAbstractFileByPath(key);
  if (abstract instanceof TFile) return { label: abstract.basename, openPath: abstract.path };
  const resolved = app.metadataCache.getFirstLinkpathDest(key, "");
  if (resolved) return { label: resolved.basename, openPath: resolved.path };
  return { label: key };
}

class ThoughtModal extends Modal {
  private plugin: BrainOSPlugin; private title = ""; private source = "";
  constructor(app: App, plugin: BrainOSPlugin) { super(app); this.plugin = plugin; }
  onOpen() { this.titleEl.setText("创建 BrainOS 思考"); new Setting(this.contentEl).setName("标题").addText((text) => text.setPlaceholder("一个清晰的想法").onChange((value) => this.title = value)); new Setting(this.contentEl).setName("来源（可选）").addText((text) => text.onChange((value) => this.source = value)); new Setting(this.contentEl).addButton((button) => button.setButtonText("创建").setCta().onClick(() => void this.create())); }
  private async create() { const title = this.title.trim(); if (!title) { new Notice("请输入标题"); return; } const path = await uniqueThoughtPath(this.plugin.app, title, this.plugin.layout.settings.noteFolder); const now = new Date().toISOString(); const source = this.source.trim() ? `source: ${JSON.stringify(this.source.trim())}\n` : ""; const state = JSON.stringify({ paths: [], draft: "", viewport: { x: 0, y: 0, zoom: 1 } }, null, 2); const body = `---\nbrainos_type: thought-file\nversion: 1\nid: ${crypto.randomUUID()}\ntitle: ${JSON.stringify(title)}\ncreated_at: ${now}\nupdated_at: ${now}\nstatus: active\n${source}---\n\n# ${title}\n\n## 思路\n\n尚未形成思路。\n\n<!-- brainos-state\n${state}\n-->\n`; await ensureFolder(this.plugin.app, this.plugin.layout.settings.noteFolder); await this.plugin.app.vault.create(path, body); this.close(); await this.plugin.app.workspace.openLinkText(path, "", true); }
  onClose() { this.contentEl.empty(); }
}

async function ensureFolder(app: App, folder: string) { if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder); }
async function uniqueThoughtPath(app: App, title: string, folder: string) { const targetFolder = normalizePath(folder.trim().replace(/^\/+|\/+$/g, "")) || DEFAULT_SETTINGS.noteFolder; await ensureFolder(app, targetFolder); const safe = title.replace(/[\\/:*?"<>|]/g, "-"); const base = normalizePath(`${targetFolder}/${safe}.thought.md`); if (!app.vault.getAbstractFileByPath(base)) return base; for (let i = 2; ; i++) { const path = normalizePath(`${targetFolder}/${safe} ${i}.thought.md`); if (!app.vault.getAbstractFileByPath(path)) return path; } }

class BrainOSSettingTab extends PluginSettingTab { constructor(app: App, private plugin: BrainOSPlugin) { super(app, plugin); } display() { this.containerEl.empty(); this.containerEl.createEl("h2", { text: "BrainOS Graph" }); new Setting(this.containerEl).setName("笔记存放位置").setDesc("创建 BrainOS 思考时使用的 vault 内文件夹路径。").addText((text) => text.setPlaceholder(DEFAULT_SETTINGS.noteFolder).setValue(this.plugin.layout.settings.noteFolder).onChange(async (value) => { this.plugin.layout.settings.noteFolder = value.trim() || DEFAULT_SETTINGS.noteFolder; await this.plugin.saveLayout(); })); new Setting(this.containerEl).setName("重新生成布局").setDesc("删除保存的坐标，下一次打开图谱时自动排列节点。").addButton((button) => button.setButtonText("重置").onClick(async () => { this.plugin.layout.positions = {}; await this.plugin.saveLayout(); this.plugin.refreshViews(); new Notice("图谱布局已重置"); })); } }
