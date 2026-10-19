import {
  App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf,
} from "obsidian";
import { BrainOSGraphView, VIEW_TYPE } from "./graph-view";
import { DEFAULT_NOTE_FOLDER, ThoughtFileExistsError, createThought } from "./thoughts";
import { GraphOptions, defaultGraphOptions, loadGraphOptions } from "./graph-options";
import { BrainOSAIProvider, UnconfiguredAIProvider } from "./ai";
import { MindViewMode } from "./mind-view-mode";

const DATA_VERSION = 5;
type BrainOSSettings = { noteFolder: string };
export type Viewport = { x: number; y: number; zoom: number };
export type SessionRecord = {
  id: string;
  title: string;
  thoughtPath?: string;
  stepKeys: string[];
  startedAt: string;
  endedAt?: string;
};
export type LayoutData = {
  version: number;
  positions: Record<string, { x: number; y: number }>;
  viewports: Record<string, Viewport>;
  settings: BrainOSSettings;
  sessions: SessionRecord[];
  activeSessionId?: string;
  graph: GraphOptions;
};
const DEFAULT_SETTINGS: BrainOSSettings = { noteFolder: DEFAULT_NOTE_FOLDER };

export default class BrainOSPlugin extends Plugin {
  layout: LayoutData = {
    version: DATA_VERSION,
    positions: {},
    viewports: {},
    settings: { ...DEFAULT_SETTINGS },
    sessions: [],
    graph: defaultGraphOptions(),
  };
  /** Provider seam for a future OpenAI/DeepSeek adapter. */
  readonly aiProvider: BrainOSAIProvider = new UnconfiguredAIProvider();
  private refreshTimer: number | undefined;
  lastMarkdownPath?: string;
  private readonly viewMode = new MindViewMode();
  private readonly headerActions = new Map<MarkdownView, HTMLElement>();
  private unloading = false;
  private creatingThought = false;

  async onload() {
    const saved = await this.loadData() as Partial<LayoutData> | null;
    const savedPositions = isRecord(saved?.positions)
      ? Object.fromEntries(Object.entries(saved.positions).filter(([, point]) => isPoint(point)))
      : {};
    const savedViewports = isRecord(saved?.viewports)
      ? Object.fromEntries(Object.entries(saved.viewports).filter(([, viewport]) => isViewport(viewport)))
      : {};
    this.layout = {
      version: DATA_VERSION,
      positions: savedPositions,
      viewports: savedViewports,
      settings: { ...DEFAULT_SETTINGS, ...(saved?.settings ?? {}) },
      sessions: Array.isArray(saved?.sessions) ? saved.sessions : [],
      activeSessionId: saved?.activeSessionId,
      graph: loadGraphOptions(saved?.graph),
    };
    this.lastMarkdownPath = this.app.workspace.getActiveFile()?.path;
    this.registerEvent(this.app.workspace.on("file-open", file => {
      if (file?.extension === "md") this.lastMarkdownPath = file.path;
      this.syncHeaderActions();
    }));
    this.registerView(VIEW_TYPE, (leaf) => new BrainOSGraphView(leaf, this));
    this.app.workspace.onLayoutReady(() => this.syncHeaderActions());
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncHeaderActions()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncHeaderActions()));
    this.addRibbonIcon("git-branch", "切换思维视图", () => void this.toggleMindView());
    this.addCommand({ id: "toggle-mind-view", name: "切换编辑／思维视图", checkCallback: checking => {
      const supported = !!this.app.workspace.getActiveViewOfType(MarkdownView)?.file || !!this.app.workspace.getActiveViewOfType(BrainOSGraphView)?.file;
      if (supported && !checking) void this.toggleMindView();
      return supported;
    }});
    this.addCommand({ id: "open-graph", name: "打开 BrainOS 图谱", callback: () => this.activateView() });
    this.addCommand({ id: "refresh-graph", name: "刷新 BrainOS 图谱", callback: () => this.refreshViews() });
    this.addCommand({ id: "focus-current-note", name: "将图谱聚焦到当前笔记", checkCallback: (checking) => {
      const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
      if (!view || !(view instanceof BrainOSGraphView)) return false;
      if (!checking) view.focusCurrent();
      return true;
    }});
    this.addCommand({ id: "create-thought", name: "新建思考", callback: () => void this.createNewThought() });
    this.addCommand({ id: "reference-node", name: "引用已有节点到当前思考", checkCallback: checking => {
      const view = this.app.workspace.getActiveViewOfType(BrainOSGraphView);
      if (!view?.file) return false;
      if (!checking) void view.openReferencePicker();
      return true;
    }});
    this.addCommand({ id: "start-session", name: "开始 BrainOS Session", callback: () => this.startSession() });
    this.addCommand({ id: "end-session", name: "结束 BrainOS Session", checkCallback: (checking) => {
      const active = this.activeSession;
      if (!active) return false;
      if (!checking) this.endSession();
      return true;
    }});
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("modify", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRefresh()));
    this.addSettingTab(new BrainOSSettingTab(this.app, this));
  }

  onunload() {
    this.unloading = true;
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    for (const action of this.headerActions.values()) action.remove();
    this.headerActions.clear();
    // Leave ordinary Markdown tabs usable when the plugin is disabled.
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const file = (leaf.view as BrainOSGraphView).file;
      if (file) void this.viewMode.showMarkdown(leaf, file.path);
    }
  }

  private syncHeaderActions() {
    if (this.unloading) return;
    const views = new Set<MarkdownView>();
    this.app.workspace.iterateAllLeaves(leaf => {
      if (!(leaf.view instanceof MarkdownView)) return;
      const view = leaf.view;
      views.add(view);
      const existing = this.headerActions.get(view);
      if (existing?.isConnected) return;
      existing?.remove();
      const action = view.addAction("git-branch", "切换到思维视图", () => void this.openMindView(leaf, view.file));
      action.addClass("brainos-mind-view-action");
      // addAction owns the native header; place our switch just before its existing actions.
      action.parentElement?.prepend(action);
      this.headerActions.set(view, action);
    });
    for (const [view, action] of this.headerActions) {
      if (!views.has(view)) { action.remove(); this.headerActions.delete(view); }
    }
  }

  async openMindView(leaf: WorkspaceLeaf, file: TFile | null) {
    if (!file || file.extension !== "md") return;
    this.lastMarkdownPath = file.path;
    await this.viewMode.showMind(leaf, file.path);
  }

  async openMarkdownView(leaf: WorkspaceLeaf, file: TFile) {
    await this.viewMode.showMarkdown(leaf, file.path);
    this.syncHeaderActions();
  }

  async toggleMindView() {
    const mind = this.app.workspace.getActiveViewOfType(BrainOSGraphView);
    if (mind?.file) { await this.openMarkdownView(mind.leaf, mind.file); return; }
    const markdown = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (markdown?.file) { await this.openMindView(markdown.leaf, markdown.file); return; }
    await this.activateView();
  }

  async createNewThought(title = "未命名思考") {
    if (this.creatingThought) return false;
    this.creatingThought = true;
    try {
      const file = await createThought(this.app, title, this.layout.settings.noteFolder);
      const leaf = this.app.workspace.getLeaf("tab");
      await this.openMindView(leaf, file);
      await this.app.workspace.revealLeaf(leaf);
      this.refreshViews();
      return true;
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
      if (title === "未命名思考" && error instanceof ThoughtFileExistsError) {
        new ThoughtNameModal(this.app, this).open();
      }
      return false;
    } finally { this.creatingThought = false; }
  }

  async activateView() {
    const workspace = this.app.workspace;
    const mainRoot = workspace.rootSplit;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE);
    const mainLeaf = leaves.find((leaf) => leaf.getRoot() === mainRoot);
    // 早期版本把视图挂在右侧栏。残留的侧栏实例直接关掉，统一由主区域的标签页承载。
    for (const leaf of leaves) {
      const root = leaf.getRoot();
      if (root === workspace.leftSplit || root === workspace.rightSplit) leaf.detach();
    }
    if (mainLeaf) { await workspace.revealLeaf(mainLeaf); return; }
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
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

  get activeSession(): SessionRecord | undefined {
    return this.layout.sessions.find(session => session.id === this.layout.activeSessionId && !session.endedAt)
      ?? this.layout.sessions.find(session => !session.endedAt);
  }

  startSession(thoughtPath?: string) {
    if (this.activeSession) {
      new Notice("已有一个 BrainOS Session 正在记录");
      return;
    }
    const path = thoughtPath?.trim() || undefined;
    const thoughtFile = path ? this.app.vault.getAbstractFileByPath(path) : undefined;
    const thoughtTitle = thoughtFile instanceof TFile
      ? this.app.metadataCache.getFileCache(thoughtFile)?.frontmatter?.title
      : undefined;
    const title = path
      ? String(thoughtTitle ?? path)
      : "未命名 Session";
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      title: path ? `从「${title}」开始` : "未命名 Session",
      ...(path ? { thoughtPath: path } : {}),
      stepKeys: [],
      startedAt: new Date().toISOString(),
    };
    this.layout.sessions.unshift(session);
    this.layout.activeSessionId = session.id;
    void this.saveLayout();
    new Notice(`Session 已开始：${session.title}`);
    this.refreshViews();
  }

  endSession() {
    const session = this.activeSession;
    if (!session) return;
    session.endedAt = new Date().toISOString();
    this.layout.activeSessionId = undefined;
    void this.saveLayout();
    new Notice(`Session 已保存：${session.stepKeys.length} 步`);
    this.refreshViews();
  }

  recordSessionStep(stepPath: string, thoughtPath?: string) {
    const session = this.activeSession;
    if (!session) return;
    if (thoughtPath && !session.thoughtPath) session.thoughtPath = thoughtPath;
    session.stepKeys.push(stepPath);
    void this.saveLayout();
  }


}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y)
    && Math.abs(value.x as number) <= 1e7 && Math.abs(value.y as number) <= 1e7;
}

function isViewport(value: unknown): value is Viewport {
  return isRecord(value)
    && Number.isFinite(value.x) && Number.isFinite(value.y)
    && Math.abs(value.x as number) <= 1e7 && Math.abs(value.y as number) <= 1e7
    && Number.isFinite(value.zoom)
    && (value.zoom as number) > 0 && (value.zoom as number) <= 100;
}

class ThoughtNameModal extends Modal {
  constructor(app: App, private plugin: BrainOSPlugin) { super(app); }
  onOpen() {
    this.titleEl.setText("已有未命名思考，为新思考取个名字");
    const form = this.contentEl.createEl("form");
    const input = form.createEl("input", { type: "text", placeholder: "思考名称", attr: { "aria-label": "思考名称", required: "" } });
    const create = form.createEl("button", { text: "创建", cls: "mod-cta", attr: { type: "submit" } });
    form.onsubmit = event => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      if (title === "未命名思考") { new Notice("请为新思考使用另一个名称"); return; }
      if (create.disabled) return;
      create.disabled = true;
      void this.plugin.createNewThought(title).then(created => {
        if (created) this.close();
        else { create.disabled = false; input.focus(); }
      });
    };
    input.focus();
  }
  onClose() { this.contentEl.empty(); }
}

class BrainOSSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: BrainOSPlugin) { super(app, plugin); }
  display() {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "BrainOS Graph" });
    new Setting(this.containerEl).setName("新思考存放位置")
      .setDesc("直接使用这个笔记库内路径，不追加子文件夹；留空存到笔记库根目录。")
      .addText(text => text.setPlaceholder("留空使用根目录").setValue(this.plugin.layout.settings.noteFolder)
        .onChange(async value => { this.plugin.layout.settings.noteFolder = value.trim(); await this.plugin.saveLayout(); }));
    new Setting(this.containerEl).setName("重新生成布局")
      .setDesc("删除保存的坐标，下一次打开图谱时自动排列节点。")
      .addButton(button => button.setButtonText("重置").onClick(async () => {
        this.plugin.layout.positions = {}; await this.plugin.saveLayout(); this.plugin.refreshViews(); new Notice("图谱布局已重置");
      }));
  }
}
