import {
  App, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting,
} from "obsidian";
import { BrainOSGraphView, VIEW_TYPE } from "./graph-view";
import { DEFAULT_NOTE_FOLDER, createThought, editThought, stepKey } from "./thoughts";

const DATA_VERSION = 1;
type BrainOSSettings = { noteFolder: string };
type LayoutData = { version: number; positions: Record<string, { x: number; y: number }>; settings: BrainOSSettings };
const DEFAULT_SETTINGS: BrainOSSettings = { noteFolder: DEFAULT_NOTE_FOLDER };

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
    this.addRibbonIcon("lightbulb", "创建新思考", () => new ThoughtModal(this.app, this).open());
    this.addCommand({ id: "open-graph", name: "打开 BrainOS 图谱", callback: () => this.activateView() });
    this.addCommand({ id: "refresh-graph", name: "刷新 BrainOS 图谱", callback: () => this.refreshViews() });
    this.addCommand({ id: "focus-current-note", name: "将图谱聚焦到当前笔记", checkCallback: (checking) => {
      const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
      if (!view || !(view instanceof BrainOSGraphView)) return false;
      if (!checking) view.focusCurrent();
      return true;
    }});
    this.addCommand({ id: "create-thought", name: "创建新思考", callback: () => new ThoughtModal(this.app, this).open() });
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

  private async appendCurrentNote() {
    const note = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    const thoughtLeaf = this.app.workspace.getLeavesOfType("markdown").find((leaf) => {
      const file = (leaf.view as MarkdownView).file;
      return file && this.app.metadataCache.getFileCache(file)?.frontmatter?.brainos_type === "thought-file";
    });
    const thought = thoughtLeaf ? (thoughtLeaf.view as MarkdownView).file : undefined;
    if (!note || !thought || note.path === thought.path) { new Notice("请同时打开一个普通笔记和一个 BrainOS 思考文件"); return; }
    await editThought(this.app, thought.path, state => {
      state.paths ??= [];
      if (!state.paths.length) state.paths.push({ id: "path-main", title: "主思路", steps: [] });
      const path = state.paths[0]; path.steps ??= [];
      const previous = path.steps[path.steps.length - 1];
      if (previous && stepKey(previous) === note.path) throw new Error("当前笔记已经是思路的最后一步");
      path.steps.push({ id: crypto.randomUUID(), atom: note.path });
    }).then(() => {
      new Notice(`已加入思考：${thought.basename}`); this.refreshViews();
    }).catch(error => new Notice(error instanceof Error ? error.message : String(error)));
  }
}

class ThoughtModal extends Modal {
  private plugin: BrainOSPlugin; private title = ""; private source = "";
  constructor(app: App, plugin: BrainOSPlugin) { super(app); this.plugin = plugin; }
  onOpen() { this.titleEl.setText("创建 BrainOS 思考"); new Setting(this.contentEl).setName("标题").addText((text) => text.setPlaceholder("一个清晰的想法").onChange((value) => this.title = value)); new Setting(this.contentEl).setName("来源（可选）").addText((text) => text.onChange((value) => this.source = value)); new Setting(this.contentEl).addButton((button) => button.setButtonText("创建").setCta().onClick(() => void this.create())); }
  private async create() {
    const title = this.title.trim(); if (!title) { new Notice("请输入标题"); return; }
    try {
      const file = await createThought(this.app, title, this.plugin.layout.settings.noteFolder, this.source);
      this.close(); this.plugin.refreshViews();
      await this.plugin.app.workspace.openLinkText(file.path, "", true);
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
  }
  onClose() { this.contentEl.empty(); }
}


class BrainOSSettingTab extends PluginSettingTab { constructor(app: App, private plugin: BrainOSPlugin) { super(app, plugin); } display() { this.containerEl.empty(); this.containerEl.createEl("h2", { text: "BrainOS Graph" }); new Setting(this.containerEl).setName("新建笔记存放位置").setDesc("创建新笔记时使用的 vault 内文件夹路径，留空则回退到 BrainOS/Thoughts。").addText((text) => text.setPlaceholder(DEFAULT_SETTINGS.noteFolder).setValue(this.plugin.layout.settings.noteFolder).onChange(async (value) => { this.plugin.layout.settings.noteFolder = value.trim() || DEFAULT_SETTINGS.noteFolder; await this.plugin.saveLayout(); })); new Setting(this.containerEl).setName("重新生成布局").setDesc("删除保存的坐标，下一次打开图谱时自动排列节点。").addButton((button) => button.setButtonText("重置").onClick(async () => { this.plugin.layout.positions = {}; await this.plugin.saveLayout(); this.plugin.refreshViews(); new Notice("图谱布局已重置"); })); } }
