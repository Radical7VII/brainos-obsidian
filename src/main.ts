import {
  App, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, WorkspaceLeaf, setIcon,
} from "obsidian";
import { BrainOSGraphView, VIEW_TYPE } from "./graph-view";
import { DEFAULT_NOTE_FOLDER, createThought } from "./thoughts";
import { GraphOptions, defaultGraphOptions, loadGraphOptions } from "./graph-options";
import { BrainOSAIProvider, UnconfiguredAIProvider } from "./ai";
import { FolderSuggest } from "./folder-suggest";
import { isThoughtFile } from "./thought-scope";
import { MindViewMode } from "./mind-view-mode";
import { ThoughtExplorer } from "./thought-explorer";

const DATA_VERSION = 6;
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
  private readonly newTabActions = new Map<WorkspaceLeaf, HTMLElement>();
  private unloading = false;
  private creatingThought = false;
  private readonly explorerDocuments = new WeakSet<Document>();
  private readonly explorer = new ThoughtExplorer({
    accepts: path => isThoughtFile(path, this.layout.settings.noteFolder)
      && this.app.vault.getAbstractFileByPath(path) instanceof TFile,
    preview: path => {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        if (leaf.view instanceof BrainOSGraphView) leaf.view.previewThought(path);
      }
    },
    select: path => {
      const view = this.activeGraphView();
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!view || !(file instanceof TFile)) return false;
      void this.openMindView(view.leaf, file);
      return true;
    },
  });

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
    // The shared thinking canvas is now the default; keep the optional vault-link mode.
    if ((saved?.version ?? 0) < DATA_VERSION) this.layout.graph.source = "thoughts";
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
    for (const action of this.newTabActions.values()) action.remove();
    this.newTabActions.clear();
    // Leave ordinary Markdown tabs usable when the plugin is disabled.
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const file = (leaf.view as BrainOSGraphView).file;
      if (file) void this.viewMode.showMarkdown(leaf, file.path);
    }
  }

  refreshIntegrations() { this.syncHeaderActions(); }

  private activeGraphView() {
    const view = this.app.workspace.getActiveViewOfType?.(BrainOSGraphView)
      ?? this.app.workspace.getMostRecentLeaf?.()?.view;
    return view instanceof BrainOSGraphView ? view : undefined;
  }

  private syncHeaderActions() {
    if (this.unloading) return;
    this.syncExplorerEvents();
    this.syncNewTabActions();
    const views = new Set<MarkdownView>();
    this.app.workspace.iterateAllLeaves(leaf => {
      if (!(leaf.view instanceof MarkdownView) || !leaf.view.file || !isThoughtFile(leaf.view.file.path, this.layout.settings.noteFolder)) return;
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

  private syncExplorerEvents() {
    const documents = new Set<Document>();
    if (typeof document !== "undefined") documents.add(document);
    this.app.workspace.iterateAllLeaves?.(leaf => {
      const doc = leaf.view.containerEl?.ownerDocument;
      if (doc) documents.add(doc);
    });
    for (const doc of documents) {
      if (this.explorerDocuments.has(doc)) continue;
      this.explorerDocuments.add(doc);
      this.registerDomEvent(doc, "mouseover", event => this.explorer.over(event));
      this.registerDomEvent(doc, "mouseout", event => this.explorer.out(event));
      this.registerDomEvent(doc, "click", event => this.explorer.click(event), true);
    }
  }

  private syncNewTabActions() {
    if (this.unloading) return;
    const leaves = new Set(this.app.workspace.getLeavesOfType("empty"));
    for (const [leaf, action] of this.newTabActions) {
      if (!leaves.has(leaf) || !action.isConnected) {
        action.remove(); this.newTabActions.delete(leaf);
      }
    }
    for (const leaf of leaves) {
      if (this.newTabActions.has(leaf)) continue;
      // EmptyView has no public extension API; use its native action list.
      const list = leaf.view.containerEl.querySelector<HTMLElement>(".empty-state-action-list");
      if (!list) continue;
      // Obsidian's EmptyView uses an unexported text-icon component, not ButtonComponent.
      // Match its markup so the active theme supplies all styling.
      const button = list.createDiv({
        cls: "text-icon-button tappable mod-pill empty-state-action brainos-new-thought-action",
        attr: { tabindex: "0", role: "button", "aria-label": "新建思考" },
      });
      setIcon(button.createSpan({ cls: "text-button-icon" }), "git-branch");
      button.createSpan({ cls: "text-button-label", text: "新建思考" });
      button.onclick = () => { void this.createNewThought("未命名思考", leaf); };
      button.onkeydown = event => {
        if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); button.click();
        }
      };
      this.newTabActions.set(leaf, button);
    }
  }

  async openMindView(leaf: WorkspaceLeaf, file: TFile | null) {
    if (!file || file.extension !== "md") return;
    if (!isThoughtFile(file.path, this.layout.settings.noteFolder)) { new Notice("这篇笔记不在思考目录中，请先在插件设置中选择对应目录"); return; }
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

  async createNewThought(title = "未命名思考", targetLeaf?: WorkspaceLeaf) {
    if (this.creatingThought) return false;
    this.creatingThought = true;
    try {
      const file = await createThought(this.app, title, this.layout.settings.noteFolder);
      const shared = this.activeGraphView()
        ?? this.app.workspace.getLeavesOfType(VIEW_TYPE).map(leaf => leaf.view).find(view => view instanceof BrainOSGraphView);
      const leaf = shared?.leaf ?? (targetLeaf?.view.getViewType() === "empty" ? targetLeaf : this.app.workspace.getLeaf("tab"));
      await this.openMindView(leaf, file);
      await this.app.workspace.revealLeaf(leaf);
      this.refreshViews();
      return true;
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
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
    const thoughtTitle: unknown = thoughtFile instanceof TFile
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

class BrainOSSettingTab extends PluginSettingTab {
  private folderSuggest?: FolderSuggest;
  constructor(app: App, private plugin: BrainOSPlugin) {
    super(app, plugin);
    plugin.register(() => this.folderSuggest?.dispose());
  }
  hide() { this.folderSuggest?.dispose(); this.folderSuggest = undefined; }
  getSettingDefinitions() {
    return [
      { name: "思考目录", desc: "填写笔记库内的文件夹路径，例如 BrainOS/思考。新思考保存到这里，节点检索仅包含此目录及子目录的 Markdown；留空使用整个笔记库。",
        render: (setting: Setting) => { this.hide(); this.renderFolder(setting); return () => this.hide(); } },
      { name: "重新生成布局", desc: "删除保存的坐标，下一次打开图谱时自动排列节点。",
        render: (setting: Setting) => this.renderReset(setting) },
    ];
  }
  // Obsidian < 1.13 uses this fallback; newer versions index and render definitions.
  display() {
    this.hide(); this.containerEl.empty();
    for (const definition of this.getSettingDefinitions()) {
      definition.render(new Setting(this.containerEl).setName(definition.name).setDesc(definition.desc));
    }
  }
  private renderFolder(setting: Setting) {
    setting.addText(text => {
        const updateFolder = async (value: string) => {
          const folder = value.trim();
          this.plugin.layout.settings.noteFolder = folder;
          await this.plugin.saveLayout();
          for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
            const view = leaf.view;
            if (!(view instanceof BrainOSGraphView)) continue;
            if (view.file && !isThoughtFile(view.file.path, folder)) await this.plugin.openMarkdownView(leaf, view.file);
            else { view.cancelNodeEditing(); }
          }
          this.plugin.refreshIntegrations(); this.plugin.refreshViews();
        };
        text.setPlaceholder("例如 BrainOS/思考；留空使用根目录").setValue(this.plugin.layout.settings.noteFolder).onChange(updateFolder);
        this.folderSuggest = new FolderSuggest(this.app, text.inputEl,
          () => this.app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder).map(folder => folder.path),
          updateFolder);
      });
  }
  private renderReset(setting: Setting) {
    setting.addButton(button => button.setButtonText("重置").onClick(async () => {
        this.plugin.layout.positions = {}; await this.plugin.saveLayout(); this.plugin.refreshViews(); new Notice("图谱布局已重置");
      }));
  }
}
