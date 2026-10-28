import { FileView, MarkdownView, Menu, Modal, Notice, Setting, SuggestModal, TFile, WorkspaceLeaf, setIcon, requireApiVersion, setTooltip } from "obsidian";
import type BrainOSPlugin from "./main";
import { GraphEdge, GraphNode, GraphSnapshot, Point, buildSnapshot } from "./thoughts";
import { GraphLayout } from "./graph-layout";
import { defaultGraphOptions, graphForces } from "./graph-options";
import { buildVaultSnapshot, selectGraph } from "./vault-graph";
import { removeVaultLink } from "./vault-links";
import { InsertThoughtTarget, insertThoughtNode, createThoughtNode, editThoughtNode, linkThoughtNodes, readThoughtNode, referenceThoughtNode, removeThoughtNode, removeThoughtNodes, unlinkThoughtNodes } from "./thought-store";
import { splitNodeKey } from "./thought-document";
import { approachOpacity, edgeInViewport, edgeStrokeKey, graphLabelAlpha, intersectsViewport, nodeScreenRadius, wrapGraphLabel } from "./graph-rendering";
import { NodeTitleCandidate, NodeTitleSuggest } from "./node-title-suggest";
import { graphHistory } from "./graph-history";
import { isThoughtFile } from "./thought-scope";
import { titleKeyAction } from "./node-title-input";
import { isMacTrackpadPan } from "./graph-wheel";
import { ThoughtReadingLayout } from "./thought-reading-layout";
import { placeGraphLabels } from "./graph-label-placement";
import { ReadingTransition } from "./reading-transition";
import { ThoughtLaneView } from "./thought-lane-view";

export { VIEW_TYPE } from "./mind-view-mode";
import { VIEW_TYPE } from "./mind-view-mode";

type Gesture = { pointer: number; start: Point; last: Point; moved: boolean } & (
  { kind: "node"; node: GraphNode; offset: Point; displayed: Point } |
  { kind: "pan"; right?: boolean } |
  { kind: "box"; end: Point; edge?: GraphEdge } |
  { kind: "link"; node: GraphNode; end: Point }
);

type TouchPoint = { clientX: number; clientY: number };

// Keep the camera range aligned with BrainOS' native GraphCamera. A tighter
// range makes large Obsidian vaults impossible to inspect and makes the fit
// button disagree with the wheel and trackpad gestures.
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

export class BrainOSGraphView extends FileView {
  private laneView?: ThoughtLaneView;
  private laneContainer?: HTMLElement;
  private displayMode: "lanes" | "graph" = "lanes";
  private displayTabs?: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private search!: HTMLInputElement;
  private status!: HTMLElement;
  private snapshot: GraphSnapshot = { nodes: [], edges: [], thoughts: [] };
  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];
  private thoughtPath = "";
  private previewedThoughtPath?: string;
  private readonly readingLayout = new ThoughtReadingLayout();
  private readingPositions: Record<string, Point> = {};
  private readonly readingTransition = new ReadingTransition();
  private readingRequested = false;
  private readingOffset: Point = { x: 0, y: 0 };
  private readingButton?: HTMLButtonElement;
  private zoom = 1;
  private pan: Point = { x: 0, y: 0 };
  private selected?: string;
  private selectedNodes = new Set<string>();
  private suppressContextMenu = false;
  private hoveredEdge?: GraphEdge;
  private hovered?: string;
  private gesture?: Gesture;
  private editor?: HTMLElement;
  private editingNode?: GraphNode;
  private titleSuggest?: NodeTitleSuggest;
  private busy = false;
  private refreshRevision = 0;
  private closed = false;
  private readonly forceLayout = new GraphLayout(() => {
    if (this.closed) return;
    this.startLayoutAnimation(); this.draw();
    if (!this.forceLayout.isRunning) this.scheduleLayoutSave();
  });
  private controls?: HTMLElement;
  private searchTimer?: number;
  private localCenter?: string;
  private cameraFrame?: number;
  private targetZoom?: number;
  private zoomAnchor?: Point;
  private get graphOptions() { return this.plugin.layout.graph.display; }
  private animationFrame?: number;
  private layoutSaveTimer?: number;
  private layoutSaveFingerprint = "";
  private currentViewportKey?: string;
  private initialRefreshFrame?: number;
  private rendererFrame?: number;
  private rendererLastDraw = 0;
  private readonly rendererOpacity = new Map<string, number>();
  private draftNode?: GraphNode;
  private draftParent?: string;
  private draftChild?: string;
  private composing = false;
  private touchPoints = new Map<number, TouchPoint>();
  private searchBox?: HTMLElement;
  private searchButton?: HTMLButtonElement;
  private controlsButton?: HTMLButtonElement;
  private touchPan?: { center: Point; start: Point; distance: number; zoom: number };

  constructor(leaf: WorkspaceLeaf, private plugin: BrainOSPlugin) { super(leaf); this.allowNoFile = true; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return this.file?.basename ?? "思维视图"; }
  getIcon() { return "git-branch"; }
  canAcceptExtension(extension: string) { return extension === "md"; }
  getEphemeralState() { return { ...super.getEphemeralState(), displayMode: this.displayMode, ...this.laneView?.state() }; }
  setEphemeralState(state: Record<string, unknown>) {
    super.setEphemeralState(state);
    if (state.displayMode === "lanes" || state.displayMode === "graph") this.displayMode = state.displayMode;
    this.syncDisplayMode(); this.laneView?.restore(state);
  }
  private get source() { return this.file ? "thoughts" : this.plugin.layout.graph.source; }

  async onLoadFile(file: TFile) {
    this.closeEditor();
    this.setReadingMode(false);
    this.file = file;
    this.thoughtPath = file.path;
    this.localCenter = undefined;
    this.selected = undefined; this.selectedNodes.clear(); this.hovered = undefined;
    if (this.currentViewportKey !== this.viewportKey()) this.restoreViewport();
    if (this.canvas) await this.refresh();
  }

  async onUnloadFile() { this.closeEditor(); this.persistViewport(); }

  async onRename(file: TFile) {
    await super.onRename(file);
    this.thoughtPath = file.path;
    this.localCenter = undefined;
    await this.refresh();
  }

  async onOpen() {
    this.closed = false;
    this.contentEl.empty();
    this.contentEl.addClass("brainos-graph-view");
    this.displayTabs = this.contentEl.createDiv({ cls: "brainos-display-tabs", attr: { "role": "group", "aria-label": "思考视图" } });
    for (const [mode, label] of [["lanes", "思路"], ["graph", "全局图"], ["raw", "Raw"]] as const) {
      const button = this.displayTabs.createEl("button", { text: label, attr: { "data-mode": mode, "aria-pressed": "false" } });
      button.onclick = () => {
        if (mode === "raw") { if (this.file) this.laneView?.raw(); return; }
        this.displayMode = mode; this.syncDisplayMode();
        if (mode === "lanes" && this.file) void this.laneView?.show(this.file);
        else this.resize();
      };
    }
    this.laneContainer = this.contentEl.createDiv({ cls: "brainos-lane-view" });
    this.laneView = this.addChild(new ThoughtLaneView(this.app, this.laneContainer, {
      raw: line => {
        if (!this.file) return;
        void this.plugin.openMarkdownView(this.leaf, this.file).then(async () => {
          const state = this.leaf.view.getState();
          await this.leaf.setViewState({ type: "markdown", state: { ...state, mode: "source", source: true }, active: true });
          if (this.leaf.view instanceof MarkdownView) {
            this.leaf.view.editor.setCursor({ line, ch: 0 });
            this.leaf.view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
          }
        });
      },
      changed: () => this.plugin.refreshViews(),
      loadNodes: async () => (await buildSnapshot(this.app, undefined, this.plugin.layout.settings.noteFolder)).nodes,
    }));
    const edit = this.addAction("pencil", "切换到编辑视图", () => {
      if (this.file) void this.plugin.openMarkdownView(this.leaf, this.file);
      else new Notice("先打开一篇笔记，或通过命令「BrainOS Graph：新建思考」开始");
    });
    edit.addClass("brainos-edit-view-action");
    edit.parentElement?.prepend(edit);
    const tools = this.contentEl.createDiv({ cls: "brainos-graph-tools" });
    this.searchButton = tools.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "搜索节点", "aria-expanded": "false", title: "搜索节点（⌘/Ctrl F）" } });
    setIcon(this.searchButton, "search"); this.searchButton.onclick = () => this.toggleSearch();
    this.controlsButton = tools.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "图谱设置", "aria-expanded": "false", title: "图谱设置" } });
    setIcon(this.controlsButton, "sliders-horizontal"); this.controlsButton.onclick = () => this.toggleControls();
    this.readingButton = tools.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "展开当前思考的阅读布局", "aria-pressed": "false", title: "阅读布局：理顺当前思考" } });
    setIcon(this.readingButton, "workflow");
    this.readingButton.onclick = () => {
      if (!this.thoughtPath || this.source !== "thoughts") { new Notice("请先在侧栏选择一份思考"); return; }
      this.setReadingMode(!this.readingRequested);
      this.canvas.focus();
    };
    this.searchBox = this.contentEl.createDiv({ cls: "brainos-graph-search" }); this.searchBox.hidden = true;
    this.search = this.searchBox.createEl("input", { type: "search", placeholder: "搜索节点…", attr: { "aria-label": "搜索节点" } });
    this.search.onkeydown = event => {
      if (event.key === "Escape") { event.preventDefault(); this.toggleSearch(false); }
    };
    this.search.oninput = () => {
      if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => { this.searchTimer = undefined; if (!this.closed) { this.filterSnapshot(); this.draw(); } }, 250);
    };
    this.forceLayout.configure(graphForces(this.plugin.layout.graph));
    this.canvas = this.contentEl.createEl("canvas", { cls: "brainos-graph-canvas", attr: { "aria-label": "思维视图，可用 Tab 延伸节点、Enter 创建同级节点、空格编辑节点标题" } });
    this.canvas.tabIndex = 0;
    this.status = this.contentEl.createDiv({ cls: "brainos-graph-status" });
    this.registerDomEvent(this.canvas, "pointerdown", event => this.onPointerDown(event));
    this.registerDomEvent(this.canvas, "pointermove", event => this.onPointerMove(event));
    this.registerDomEvent(this.canvas, "pointerup", event => this.onPointerUp(event));
    this.registerDomEvent(this.canvas, "pointerleave", () => { if (!this.gesture) { this.hovered = undefined; this.clearEdgeHover(); this.draw(); } });
    this.registerDomEvent(this.canvas, "pointercancel", event => this.onPointerCancel(event));
    this.registerDomEvent(this.canvas, "lostpointercapture", event => this.onPointerCancel(event));
    this.registerDomEvent(this.canvas, "wheel", event => this.onWheel(event), { passive: false });
    this.registerDomEvent(this.canvas, "dblclick", event => this.onDoubleClick(event));
    this.registerDomEvent(this.canvas, "contextmenu", event => this.onContextMenu(event));
    this.registerDomEvent(this.canvas, "keydown", event => this.onKeyDown(event));
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(this.contentEl);
    this.register(() => observer.disconnect());
    // FileView receives its active editing file in setState after onOpen.
    this.initialRefreshFrame = this.contentEl.win.requestAnimationFrame(() => {
      this.initialRefreshFrame = undefined;
      if (!this.closed && !this.file) void this.refresh();
    });
    this.canvas.focus();
    this.syncDisplayMode();
  }

  async onClose() {
    this.closed = true;
    this.refreshRevision++;
    if (this.initialRefreshFrame !== undefined) this.contentEl.win.cancelAnimationFrame(this.initialRefreshFrame);
    this.initialRefreshFrame = undefined;
    if (this.animationFrame !== undefined) this.contentEl.win.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
    if (this.layoutSaveTimer !== undefined) window.clearTimeout(this.layoutSaveTimer);
    this.layoutSaveTimer = undefined;
    this.persistLayoutPositions();
    this.persistViewport();
    if (this.searchTimer !== undefined) window.clearTimeout(this.searchTimer);
    if (this.rendererFrame !== undefined) this.contentEl.win.cancelAnimationFrame(this.rendererFrame);
    if (this.cameraFrame !== undefined) this.contentEl.win.cancelAnimationFrame(this.cameraFrame);
    this.rendererFrame = undefined; this.cameraFrame = undefined;
    this.forceLayout.dispose();
    this.controls?.remove(); this.controls = undefined;
    this.cancelGesture();
    this.closeEditor();
  }

  async refresh() {
    const revision = ++this.refreshRevision;
    const thoughtFiles = this.app.vault.getMarkdownFiles().filter(file => {
      if (!isThoughtFile(file.path, this.plugin.layout.settings.noteFolder)) return false;
      const cache = this.app.metadataCache.getFileCache(file);
      return cache?.frontmatter?.brainos_type === "thought-file" || !!cache?.listItems?.length;
    });
    const thoughts = thoughtFiles.map(file => ({ path: file.path, title: String(this.app.metadataCache.getFileCache(file)?.frontmatter?.title ?? file.basename) }));
    const snapshot = this.source === "vault"
      ? buildVaultSnapshot(this.app, thoughts, this.plugin.layout.graph.filter, this.plugin.layout.settings.noteFolder)
      : await buildSnapshot(this.app, undefined, this.plugin.layout.settings.noteFolder, this.file ?? undefined);
    if (this.closed || revision !== this.refreshRevision) return;
    this.snapshot = snapshot;
    this.forceLayout.configure(graphForces(this.plugin.layout.graph));
    if (this.thoughtPath && !snapshot.thoughts.some(thought => thought.path === this.thoughtPath)) this.thoughtPath = "";
    if (this.currentViewportKey !== this.viewportKey()) this.restoreViewport();
    this.filterSnapshot();
    if (this.selected && !this.nodes.some(node => node.path === this.selected)) this.selected = undefined;
    this.forceLayout.setSelected(this.selected);
    this.startLayoutAnimation();
    this.resize();
    this.syncDisplayMode();
    if (this.file && this.displayMode === "lanes") await this.laneView?.show(this.file);
  }

  private syncDisplayMode() {
    const lanes = !!this.file && this.source === "thoughts" && this.displayMode === "lanes";
    this.contentEl.toggleClass("brainos-show-lanes", lanes);
    if (this.laneContainer) this.laneContainer.hidden = !lanes;
    this.displayTabs?.querySelectorAll<HTMLButtonElement>("button").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.mode === (lanes ? "lanes" : "graph")));
      button.disabled = button.dataset.mode !== "graph" && !this.file;
    });
  }

  private filterSnapshot() {
    const base = this.snapshot;
    const visible = { ...base, nodes: base.nodes.filter(node => !this.plugin.layout.graph.hiddenPaths.includes(node.path)) };
    const result = selectGraph(visible, this.search?.value.trim() ?? "", this.plugin.layout.graph.filter, this.localCenter);
    this.nodes = this.draftNode ? result.nodes.filter(node => !node.placeholder) : result.nodes; this.edges = result.edges;
    this.selectedNodes = new Set([...this.selectedNodes].filter(path => this.nodes.some(node => node.path === path)));
    if (this.draftNode) {
      this.nodes.push(this.draftNode);
      if (this.draftChild) {
        this.edges = this.edges.filter(edge => edge.from !== this.draftParent || edge.to !== this.draftChild);
        this.edges.push({ from: this.draftNode.path, to: this.draftChild, thoughts: [] });
      }
      if (this.draftParent && this.nodes.some(node => node.path === this.draftParent)) this.edges.push({ from: this.draftParent, to: this.draftNode.path, thoughts: [] });
    }
    if (this.selected && !this.nodes.some(node => node.path === this.selected)) this.selected = undefined;
    if (this.hovered && !this.nodes.some(node => node.path === this.hovered)) this.hovered = undefined;
    this.forceLayout.sync(this.nodes, this.edges, this.plugin.layout.positions, this.source === "thoughts");
    this.updateReadingLayout();
    this.forceLayout.setSelected(this.selected);
    this.startLayoutAnimation();
  }

  private updateReadingLayout() {
    if (this.source !== "thoughts" || !this.thoughtPath) { this.readingPositions = {}; return; }
    const ctx = this.canvas?.getContext?.("2d");
    const family = typeof getComputedStyle === "function" && this.canvas
      ? getComputedStyle(this.canvas).getPropertyValue("--font-interface").trim() || "sans-serif" : "sans-serif";
    this.readingPositions = this.readingLayout.sync(this.thoughtPath, this.nodes, this.snapshot.steps ?? [], node => {
      const radius = nodeScreenRadius(node.weight ?? node.degree, 1, this.graphOptions.nodeSizeMultiplier);
      const fontSize = 14 + radius / 4;
      if (ctx) ctx.font = `${fontSize}px ${family}`;
      const measure = (text: string) => ctx?.measureText(text).width ?? Array.from(text).length * fontSize;
      const lines = wrapGraphLabel(node.label, measure, 300, 4);
      return { width: Math.max(radius * 2, ...lines.map(measure)), top: -radius,
        bottom: radius + 8 + lines.length * fontSize * 1.2 };
    });
  }

  private displayPoint(point: Point): Point {
    const path = (point as Partial<GraphNode>).path;
    if (path && this.gesture?.kind === "node" && this.gesture.node.path === path) return this.gesture.displayed;
    return path && this.readingTransition.get(path) || point;
  }

  private setReadingMode(reading: boolean, anchor?: GraphNode) {
    reading = reading && this.source === "thoughts" && !!this.thoughtPath;
    if (reading && !this.readingRequested) {
      const node = anchor ?? this.nodes.find(node => node.path === this.selected)
        ?? this.nodes.find(node => !!this.readingPositions[node.path]);
      const target = node && this.readingPositions[node.path];
      const point = node && this.displayPoint(node);
      // Keep the interaction anchor under the pointer as its path unfolds.
      this.readingOffset = target && point ? { x: point.x - target.x, y: point.y - target.y } : { x: 0, y: 0 };
    }
    this.readingRequested = reading;
    this.readingButton?.setAttribute("aria-pressed", String(reading));
    this.readingButton?.setAttribute("aria-label", reading ? "恢复自由布局" : "展开当前思考的阅读布局");
    this.readingButton?.setAttribute("title", reading ? "自由布局（Esc）：恢复自然分布" : "阅读布局：理顺当前思考");
    if (this.readingButton) setIcon(this.readingButton, reading ? "network" : "workflow");
    this.startLayoutAnimation();
  }

  previewThought(path?: string) {
    if (this.previewedThoughtPath === path) return;
    this.previewedThoughtPath = path;
    if (this.canvas && !this.closed) this.draw();
  }

  /** File preview is visual only: it never changes the editing destination or topology. */
  private activityFocus() {
    const focus = this.previewedThoughtPath ? undefined : this.hovered ?? this.selected;
    const thought = this.source === "thoughts" && !this.search?.value.trim() && !focus
      ? this.previewedThoughtPath ?? this.thoughtPath : undefined;
    return {
      focus, thought,
      nodes: new Set(thought ? this.nodes.filter(node => node.thoughts.includes(thought)).map(node => node.path) : []),
      edges: new Set(thought ? this.edges.filter(edge => edge.thoughts.includes(thought)) : []),
    };
  }

  private toggleSearch(show = this.searchBox?.hidden ?? true) {
    if (!this.searchBox) return;
    this.searchBox.hidden = !show;
    this.searchButton?.setAttribute("aria-expanded", String(show));
    if (show) { this.search.focus(); this.search.select(); }
    else { this.search.value = ""; this.filterSnapshot(); this.draw(); this.canvas.focus(); }
  }

  onPaneMenu(menu: Menu, source: string) {
    super.onPaneMenu(menu, source);
    if (this.file) menu.addItem(item => item.setTitle("切换到编辑视图").setIcon("pencil").onClick(() => void this.plugin.openMarkdownView(this.leaf, this.file!)));
    menu.addItem(item => item.setTitle("新建思考").setIcon("file-plus").onClick(() => void this.plugin.createNewThought()));
    menu.addSeparator();
    menu.addItem(item => item.setTitle("新建节点").setIcon("plus").onClick(() => void this.beginCreate(this.screenToWorld(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2))));
    menu.addItem(item => item.setTitle("引用已有节点…").setIcon("link").onClick(() => void this.openReferencePicker()));
    menu.addItem(item => item.setTitle("延伸节点（Tab）").setIcon("git-branch").onClick(() => void this.createRelative(true)));
    if (this.source === "thoughts" && this.thoughtPath) menu.addItem(item => item.setTitle(this.readingRequested ? "恢复自由布局" : "展开阅读布局").setIcon("workflow").onClick(() => this.setReadingMode(!this.readingRequested)));
    menu.addItem(item => item.setTitle("适配图谱（F）").setIcon("maximize").onClick(() => this.fitToView()));
    menu.addItem(item => item.setTitle("聚焦当前笔记").setIcon("focus").onClick(() => this.focusCurrent()));
    if (!this.file && this.source === "vault") menu.addItem(item => item.setTitle(this.localCenter ? "显示全部笔记" : "只看选中节点的邻域").setIcon("network").onClick(() => {
      const path = this.selected ?? this.plugin.lastMarkdownPath;
      if (!this.localCenter && !this.snapshot.nodes.some(node => node.path === path)) { new Notice("请先选中一个节点"); return; }
      this.localCenter = this.localCenter ? undefined : path;
      this.filterSnapshot(); this.fitToView();
    }));
    menu.addSeparator();
    menu.addItem(item => item.setTitle("图谱设置").setIcon("sliders-horizontal").onClick(() => this.toggleControls()));
    menu.addItem(item => item.setTitle("刷新图谱").setIcon("refresh-cw").onClick(() => void this.refresh()));
    menu.addItem(item => item.setTitle(this.plugin.activeSession ? "结束 Session" : "开始 Session").setIcon("clock").onClick(() => {
      if (this.plugin.activeSession) this.plugin.endSession();
      else this.plugin.startSession(this.thoughtPath || undefined);
    }));
    menu.addItem(item => item.setTitle("操作提示").setIcon("circle-help").onClick(() => {
      new Notice("双击空白新建 · Tab 继续 · Enter 同起点分支 · 空格编辑标题 · ⌘/Ctrl Enter 插入父节点 · Alt 拖动连线 · F 适配图谱", 10000);
    }));
  }

  private toggleControls() {
    if (this.controls) { this.controls.remove(); this.controls = undefined; this.controlsButton?.setAttribute("aria-expanded", "false"); return; }
    const panel = this.contentEl.createDiv({ cls: "brainos-graph-controls" }); this.controls = panel;
    this.controlsButton?.setAttribute("aria-expanded", "true");
    const heading = panel.createDiv({ cls: "brainos-controls-heading" });
    heading.createEl("strong", { text: "图谱设置" });
    const close = heading.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "关闭图谱设置" } });
    setIcon(close, "x"); close.onclick = () => this.toggleControls();
    const settings = this.plugin.layout.graph;
    if (!this.file) {
      new Setting(panel).setName("图谱来源").addDropdown(control => control.addOptions({ vault: "笔记双链", thoughts: "思维节点" }).setValue(this.source).onChange(value => {
        settings.source = value as "vault" | "thoughts";
        this.thoughtPath = ""; this.localCenter = undefined;
        void this.plugin.saveLayout(); void this.refresh(); this.toggleControls();
      }));
      if (this.source === "thoughts") {
        const options: Record<string, string> = { "": "全部思考" };
        for (const thought of this.snapshot.thoughts) options[thought.path] = thought.title;
        new Setting(panel).setName("当前思考").addDropdown(control => control.addOptions(options).setValue(this.thoughtPath).onChange(value => {
          this.persistViewport(); this.closeEditor(); this.thoughtPath = value; this.selectedNodes.clear(); this.selected = undefined;
          this.filterSnapshot(); this.draw();
        }));
      }
    }
    const save = () => { void this.plugin.saveLayout(); };
    const slider = (name: string, value: number, min: number, max: number, step: number, change: (value: number) => void) => {
      new Setting(panel).setName(name).addSlider(control => {
        control.setLimits(min, max, step).setValue(value);
        setTooltip(control.sliderEl, String(value));
        control.onChange(value => { change(value); setTooltip(control.sliderEl, String(value)); save(); this.draw(); });
      });
    };
    panel.createEl("h3", { text: "显示" });
    slider("节点大小", settings.display.nodeSizeMultiplier, .25, 3, .05, value => { settings.display.nodeSizeMultiplier = value; this.updateReadingLayout(); });
    slider("连线粗细", settings.display.lineSizeMultiplier, .1, 5, .1, value => settings.display.lineSizeMultiplier = value);
    slider("文字淡出阈值", settings.display.textFadeMultiplier, -3, 3, .1, value => settings.display.textFadeMultiplier = value);
    new Setting(panel).setName("显示箭头").addToggle(control => control.setValue(settings.display.showArrows).onChange(value => { settings.display.showArrows = value; save(); this.draw(); }));
    {
      panel.createEl("h3", { text: "自由布局" });
      const forces = (key: keyof typeof settings.forces, value: number) => { settings.forces[key] = value; this.forceLayout.configure(graphForces(settings)); this.startLayoutAnimation(); };
      slider("中心力", settings.forces.center, 0, 1, .01, value => forces("center", value));
      slider("排斥力", settings.forces.repel, 0, 20, .1, value => forces("repel", value));
      slider("连接力", settings.forces.link, 0, 1, .01, value => forces("link", value));
      slider("连接长度", settings.forces.distance, 30, 500, 1, value => forces("distance", value));
    }
    if (this.source === "thoughts") panel.createDiv({ cls: "setting-item-description", text: "默认自由分布。选中或编辑节点时柔和展开路径；点击空白、Esc 或切换布局按钮可恢复。拖动会带动附近节点，侧栏悬停只高亮。" });
    panel.createEl("h3", { text: "筛选" });
    new Setting(panel).setName("恢复隐藏的节点").addButton(button => button.setButtonText("恢复").onClick(() => {
      settings.hiddenPaths = []; save(); this.filterSnapshot(); this.draw();
    }));
    const toggle = (name: string, key: "showTags" | "showAttachments" | "showUnresolved" | "showOrphans" | "localIncoming" | "localOutgoing") => new Setting(panel).setName(name).addToggle(control => control.setValue(settings.filter[key]).onChange(value => { settings.filter[key] = value; save(); void this.refresh(); }));
    toggle("标签", "showTags"); toggle("附件", "showAttachments"); toggle("未创建的笔记", "showUnresolved"); toggle("孤立节点", "showOrphans");
    slider("局部图谱深度", settings.filter.localDepth, 1, 5, 1, value => { settings.filter.localDepth = value; this.filterSnapshot(); });
    toggle("局部图谱入链", "localIncoming"); toggle("局部图谱出链", "localOutgoing");
    new Setting(panel).setName("恢复默认图谱").addButton(button => button.setButtonText("重置").onClick(() => {
      const currentSource = settings.source;
      this.plugin.layout.graph = defaultGraphOptions(); this.plugin.layout.graph.source = currentSource;
      this.plugin.layout.positions = {}; this.readingLayout.clear(); this.readingTransition.clear(); this.forceLayout.reset(); this.forceLayout.configure(graphForces(this.plugin.layout.graph));
      this.controls?.remove(); this.controls = undefined; this.controlsButton?.setAttribute("aria-expanded", "false"); save(); void this.refresh();
    }));
  }

  private startLayoutAnimation() {
    if (this.closed || this.animationFrame !== undefined) return;
    this.animationFrame = this.contentEl.win.requestAnimationFrame(time => {
      this.animationFrame = undefined;
      if (this.closed) return;
      this.forceLayout.tick(this.nodes);
      const gesture = this.gesture;
      const reducedMotion = this.canvas?.ownerDocument?.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      const moving = this.readingTransition.step(this.nodes, this.readingPositions, this.readingRequested, this.zoom, time,
        this.readingOffset, gesture?.kind === "node" ? { key: gesture.node.path, point: gesture.displayed } : undefined, reducedMotion);
      this.draw();
      if (this.forceLayout.isRunning || moving) this.startLayoutAnimation();
      else this.scheduleLayoutSave();
    });
  }

  private scheduleLayoutSave() {
    if (this.layoutSaveTimer !== undefined || this.closed) return;
    this.layoutSaveTimer = window.setTimeout(() => {
      this.layoutSaveTimer = undefined;
      this.persistLayoutPositions();
    }, 500);
  }

  private persistLayoutPositions() {
    const positions = this.forceLayout.snapshot();
    if (this.draftNode) delete positions[this.draftNode.path];
    const fingerprint = JSON.stringify(positions);
    let changed = false;
    if (fingerprint !== this.layoutSaveFingerprint) {
      this.layoutSaveFingerprint = fingerprint;
      Object.assign(this.plugin.layout.positions, positions);
      changed = true;
    }
    changed = this.persistViewport() || changed;
    if (changed) void this.plugin.saveLayout();
  }

  private viewportKey() { return this.source === "thoughts" ? `thoughts:${this.plugin.layout.settings.noteFolder}` : "__all__"; }

  private restoreViewport() {
    this.currentViewportKey = this.viewportKey();
    const saved = this.plugin.layout.viewports?.[this.viewportKey()]
      ?? (this.file ? this.plugin.layout.viewports?.[`file:${this.file.path}`] : undefined);
    if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y) || !Number.isFinite(saved.zoom)) {
      this.pan = { x: 0, y: 0 };
      this.zoom = 1;
      return;
    }
    this.pan = { x: saved.x, y: saved.y };
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, saved.zoom));
  }

  private persistViewport(): boolean {
    if (!this.plugin.layout.viewports) this.plugin.layout.viewports = {};
    const next = { x: this.pan.x, y: this.pan.y, zoom: this.zoom };
    const previous = this.plugin.layout.viewports[this.viewportKey()];
    if (previous && previous.x === next.x && previous.y === next.y && previous.zoom === next.zoom) return false;
    this.plugin.layout.viewports[this.viewportKey()] = next;
    return true;
  }

  private fitToView() {
    const points = this.nodes.map(node => this.displayPoint(node)).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!points.length) {
      this.pan = { x: 0, y: 0 }; this.zoom = 1; this.persistViewport(); this.draw(); return;
    }
    const minX = Math.min(...points.map(node => node.x));
    const maxX = Math.max(...points.map(node => node.x));
    const minY = Math.min(...points.map(node => node.y));
    const maxY = Math.max(...points.map(node => node.y));
    const width = Math.max(1, maxX - minX), height = Math.max(1, maxY - minY);
    const padding = 110;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((this.canvas.clientWidth - padding) / width, (this.canvas.clientHeight - padding) / height)));
    this.pan = { x: -(minX + maxX) / 2, y: -(minY + maxY) / 2 };
    this.persistViewport();
    this.startLayoutAnimation();
    this.draw(); this.canvas?.focus();
  }

  focusCurrent() {
    const file = this.file ?? this.app.workspace.getActiveViewOfType(MarkdownView)?.file ?? this.app.vault.getAbstractFileByPath(this.plugin.lastMarkdownPath ?? "");
    if (!(file instanceof TFile)) { new Notice("当前没有打开的 Markdown 笔记"); return; }
    const node = this.nodes.find(item => item.ownerPath === file.path) ?? this.nodes.find(item => item.openPath === file.path);
    if (!node) { new Notice("当前文件未出现在所选思考图谱中"); return; }
    const point = this.displayPoint(node);
    this.setReadingMode(true, node);
    this.selectedNodes.clear(); this.selected = node.path; this.hovered = node.path; this.forceLayout.setSelected(this.selected); this.pan = { x: -point.x, y: -point.y }; this.scheduleLayoutSave(); this.startLayoutAnimation(); this.draw(); this.canvas.focus();
  }

  private resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.draw();
  }

  private worldToScreen(point: Point): Point {
    point = this.displayPoint(point);
    return { x: this.canvas.clientWidth / 2 + (point.x + this.pan.x) * this.zoom, y: this.canvas.clientHeight / 2 + (point.y + this.pan.y) * this.zoom };
  }
  private screenToWorld(x: number, y: number): Point {
    return { x: (x - this.canvas.clientWidth / 2) / this.zoom - this.pan.x, y: (y - this.canvas.clientHeight / 2) / this.zoom - this.pan.y };
  }
  private nodeAt(x: number, y: number) {
    // Compare to the drawn radius. An oversized invisible hit box otherwise
    // makes dense graphs select a neighbouring point instead of the closest.
    let closest: GraphNode | undefined;
    let closestDistance = Infinity;
    for (const node of this.nodes) {
      const point = this.worldToScreen(node);
      const radius = nodeScreenRadius(node.weight ?? node.degree, this.zoom, this.graphOptions.nodeSizeMultiplier);
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= Math.max(radius + 3, 10) && distance < closestDistance) {
        closest = node; closestDistance = distance;
      }
    }
    return closest;
  }

  private draw() {
    if (!this.canvas || this.closed) return;
    if (this.hoveredEdge && !this.edges.includes(this.hoveredEdge)) this.clearEdgeHover();
    const ctx = this.canvas.getContext("2d"); if (!ctx) return;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const colors = getComputedStyle(this.canvas);
    const color = (...properties: string[]) => {
      for (const property of properties) {
        const value = colors.getPropertyValue(property).trim();
        if (value) return value;
      }
      return "#888888";
    };
    const edgeColor = color("--graph-line", "--brainos-edge", "--background-modifier-border");
    const fill = color("--graph-node", "--text-muted");
    const accent = color("--interactive-accent", "--text-accent");
    const focusedFill = accent;
    const normal = color("--text-normal", "--graph-text");
    const text = color("--graph-text", "--text-normal");
    const dim = color("--graph-node-unresolved", "--text-faint");
    const typeColors = {
      tag: color("--graph-node-tag", "--color-green"),
      attachment: color("--graph-node-attachment", "--color-yellow"),
      unresolved: dim,
      note: fill,
    };
    const options = this.graphOptions;
    const zoom = Math.max(0.0001, this.zoom), visualScale = Math.sqrt(zoom);
    const query = this.search.value.trim().toLocaleLowerCase();
    // Empty strings match every title. Treating those as search hits used to
    // paint the entire idle graph in the highlight/accent colour.
    const matches = new Set(query ? this.nodes.filter(node => node.label.toLocaleLowerCase().includes(query)
      || node.path.toLocaleLowerCase().includes(query)).map(node => node.path) : []);
    const byPath = new Map(this.nodes.map(node => [node.path, node]));
    const activity = this.activityFocus();
    const focus = activity.focus && byPath.has(activity.focus) ? activity.focus : undefined;
    const neighbors = new Set<string>();
    if (focus) for (const edge of this.edges) {
      if (edge.from === focus) neighbors.add(edge.to);
      if (edge.to === focus) neighbors.add(edge.from);
    }
    const now = performance.now();
    const elapsed = this.rendererLastDraw ? now - this.rendererLastDraw : 16.67;
    this.rendererLastDraw = now;
    let fading = false;
    const alive = new Set<string>();
    const opacity = (key: string, target: number) => {
      if (alive.has(key)) return this.rendererOpacity.get(key)!;
      alive.add(key);
      const value = approachOpacity(this.rendererOpacity.get(key) ?? 1, target, elapsed);
      this.rendererOpacity.set(key, value);
      if (value !== target) fading = true;
      return value;
    };
    const points = new Map(this.nodes.map(node => [node.path, this.worldToScreen(node)]));
    const radii = new Map(this.nodes.map(node => [node.path,
      nodeScreenRadius(node.weight ?? node.degree, zoom, options.nodeSizeMultiplier)]));
    const directions = new Set(this.edges.map(edge => JSON.stringify([edge.from, edge.to])));
    let flowing = false;
    ctx.lineCap = "round";
    for (const edge of this.edges) {
      const a = byPath.get(edge.from), b = byPath.get(edge.to);
      const p = points.get(edge.from), q = points.get(edge.to);
      if (!a || !b || !p || !q || edge.from === edge.to) continue;
      const edgeSelected = !!this.hoveredEdge && edgeStrokeKey(edge.from, edge.to) === edgeStrokeKey(this.hoveredEdge.from, this.hoveredEdge.to);
      const edgeActive = edgeSelected || edge.from === focus || edge.to === focus || activity.edges.has(edge);
      const edgeHighlighted = edgeSelected || edge.from === focus || edge.to === focus
        || !!this.previewedThoughtPath && activity.edges.has(edge);
      const alpha = opacity("e:" + JSON.stringify([edge.from, edge.to]), !(focus || activity.thought) || edgeActive ? 1 : 0.2);
      if (!edgeInViewport(p, q, width, height, options.lineSizeMultiplier + 2)) continue;
      const dx = q.x - p.x, dy = q.y - p.y, distance = Math.hypot(dx, dy);
      if (!Number.isFinite(distance) || distance < 0.001) continue;
      const ux = dx / distance, uy = dy / distance;
      const sourceRadius = radii.get(a.path)!, targetRadius = radii.get(b.path)!;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = edgeHighlighted ? accent : activity.edges.has(edge) ? normal : edgeColor;
      // Canvas coordinates are already projected. Obsidian's world line width
      // divides by zoom, which becomes a constant screen-space thickness here.
      ctx.lineWidth = Math.max(0.1, options.lineSizeMultiplier) + (edgeSelected ? 2 : 0);
      const lane = directions.has(JSON.stringify([edge.to, edge.from])) ? 3 : 0;
      if (distance > sourceRadius + targetRadius) {
        flowing = true;
        ctx.setLineDash([8, 6]); ctx.lineDashOffset = -(now / 1000 * 28) % 14;
        ctx.beginPath();
        ctx.moveTo(p.x + ux * sourceRadius - uy * lane, p.y + uy * sourceRadius + ux * lane);
        ctx.lineTo(q.x - ux * targetRadius - uy * lane, q.y - uy * targetRadius + ux * lane);
        ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      }
      if (options.showArrows && distance > sourceRadius + targetRadius + 10) {
        const arrowAlpha = Math.max(0, Math.min(1, 2 * (zoom - 0.3)));
        ctx.globalAlpha = alpha * arrowAlpha * 0.5;
        ctx.fillStyle = edgeHighlighted ? accent : activity.edges.has(edge) ? normal : text;
        const tipX = q.x - ux * (targetRadius + 1), tipY = q.y - uy * (targetRadius + 1);
        const size = 8 * Math.sqrt(Math.max(0.1, options.lineSizeMultiplier));
        ctx.beginPath(); ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - ux * size - uy * size * 0.5, tipY - uy * size + ux * size * 0.5);
        ctx.lineTo(tipX - ux * size + uy * size * 0.5, tipY - uy * size - ux * size * 0.5);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (this.gesture?.kind === "link") {
      const point = this.worldToScreen(this.gesture.node);
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(this.gesture.end.x, this.gesture.end.y); ctx.stroke(); ctx.setLineDash([]);
    }
    const labelAlpha = graphLabelAlpha(zoom, options.textFadeMultiplier);
    const fontFamily = colors.getPropertyValue("--font-interface").trim() || colors.getPropertyValue("--font-text").trim() || "sans-serif";
    // Draw focused nodes last so a nearby dot cannot cover the active target.
    const orderedNodes = this.nodes.filter(node => node.path !== focus);
    const focusedNode = focus ? byPath.get(focus) : undefined;
    if (focusedNode) orderedNodes.push(focusedNode);
    const labels: { key: string; point: Point; radius: number; width: number; height: number; priority: number;
      gap: number; lines: string[]; alpha: number; fontSize: number; lineHeight: number }[] = [];
    for (const node of orderedNodes) {
      const point = points.get(node.path)!, radius = radii.get(node.path)!;
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const isFocus = node.path === focus, isMatch = matches.has(node.path);
      const inThought = activity.nodes.has(node.path);
      const alpha = opacity("n:" + node.path, !(focus || activity.thought) || isFocus || neighbors.has(node.path) || inThought ? 1 : 0.2);
      const kind = node.kind ?? "note";
      const circleVisible = intersectsViewport({ left: point.x - radius - 3, right: point.x + radius + 3,
        top: point.y - radius - 3, bottom: point.y + radius + 3 }, width, height);
      if (circleVisible) {
        ctx.globalAlpha = alpha * (kind === "unresolved" || node.placeholder ? 0.5 : 1);
        const highlighted = isFocus || this.selectedNodes.has(node.path) || node.path === this.selected || isMatch
          || !!this.previewedThoughtPath && inThought;
        ctx.fillStyle = highlighted ? accent : inThought ? normal : node.placeholder ? dim : typeColors[kind];
        ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill();
        if (isFocus || node.path === this.selected || this.selectedNodes.has(node.path)) {
          ctx.strokeStyle = focusedFill; ctx.globalAlpha = alpha; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(point.x, point.y, radius + 2, 0, Math.PI * 2); ctx.stroke();
        }
      }
      if (node.path === this.draftNode?.path || node.path === this.editingNode?.path) continue;
      // Sidebar preview changes colour/opacity only, including title geometry.
      const labelFocus = node.path === (this.hovered ?? this.selected);
      const alphaText = labelFocus ? 1 : labelAlpha * alpha;
      if (!labelFocus && labelAlpha <= 0.001) continue;
      const baseSize = nodeScreenRadius(node.weight ?? node.degree, 1, options.nodeSizeMultiplier);
      const labelScale = labelFocus && zoom < 1 ? 1 : visualScale;
      const fontSize = (14 + baseSize / 4) * labelScale;
      const maxWidth = Math.min(300 * labelScale, Math.max(80, width - 24));
      const lineHeight = fontSize * 1.2;
      if (!intersectsViewport({ left: point.x - maxWidth / 2, right: point.x + maxWidth / 2,
        top: point.y - radius - lineHeight * 8 - 24, bottom: point.y + radius + lineHeight * 8 + 24 }, width, height)) continue;
      ctx.font = `${fontSize}px ${fontFamily}`;
      const lines = wrapGraphLabel(node.label, value => ctx.measureText(value).width, maxWidth, labelFocus ? 8 : 4);
      labels.push({ key: node.path, point, radius, width: Math.max(1, ...lines.map(line => ctx.measureText(line).width)),
        height: lines.length * lineHeight, priority: labelFocus || isMatch || this.selectedNodes.has(node.path) ? 3 : node.thoughts.includes(this.thoughtPath) ? 2 : 1,
        gap: Math.max(8, 5 * labelScale + (labelFocus ? 15 : 0)), lines, alpha: alphaText, fontSize, lineHeight });
    }
    const labelPositions = placeGraphLabels(labels, this.nodes.flatMap(node => {
      const point = points.get(node.path)!;
      return Number.isFinite(point.x) && Number.isFinite(point.y) ? [{ key: node.path, point, radius: radii.get(node.path)! + 2 }] : [];
    }));
    for (const label of labels) {
      const rect = labelPositions.get(label.key); if (!rect || !intersectsViewport(rect, width, height)) continue;
      const center = (rect.left + rect.right) / 2;
      if (Math.abs(center - label.point.x) > 1 || rect.bottom < label.point.y) {
        ctx.strokeStyle = text; ctx.globalAlpha = label.alpha * 0.3; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(label.point.x, label.point.y);
        ctx.lineTo(Math.max(rect.left, Math.min(rect.right, label.point.x)), Math.max(rect.top, Math.min(rect.bottom, label.point.y)));
        ctx.stroke();
      }
      ctx.font = `${label.fontSize}px ${fontFamily}`;
      ctx.globalAlpha = label.alpha; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = text;
      label.lines.forEach((line, index) => ctx.fillText(line, center, rect.top + index * label.lineHeight));
    }
    for (const key of this.rendererOpacity.keys()) if (!alive.has(key)) this.rendererOpacity.delete(key);
    ctx.globalAlpha = 1;
    if (this.gesture?.kind === "box" && this.gesture.moved) {
      const { start, end } = this.gesture;
      ctx.fillStyle = accent; ctx.globalAlpha = 0.12;
      ctx.fillRect(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(end.x - start.x), Math.abs(end.y - start.y));
      ctx.strokeStyle = accent; ctx.globalAlpha = 0.9; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(end.x - start.x), Math.abs(end.y - start.y));
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    if ((fading || flowing) && this.rendererFrame === undefined && width > 0 && height > 0) {
      const animate = (time: number) => {
        this.rendererFrame = undefined;
        if (this.closed) return;
        if (time - this.rendererLastDraw < 32) { this.rendererFrame = this.contentEl.win.requestAnimationFrame(animate); return; }
        this.draw();
      };
      this.rendererFrame = this.contentEl.win.requestAnimationFrame(animate);
    }
    let empty = this.contentEl.querySelector<HTMLElement>(".brainos-graph-empty");
    if (!this.nodes.length && !empty) empty = this.contentEl.createDiv({ cls: "brainos-graph-empty", text: "双击空白，写下第一个想法" });
    if (this.nodes.length) empty?.remove();
    const selected = this.nodes.find(node => node.path === this.selected);
    this.positionDraftEditor();
    this.status.setText(this.draftNode ? "输入节点标题 · Enter 确认 · Tab 确认并延伸 · Esc 取消" : this.selectedNodes.size > 1 ? `已框选 ${this.selectedNodes.size} 个节点 · 退格键批量删除 · Esc 取消` : selected ? `${selected.label}${this.file && selected.ownerPath && selected.ownerPath !== this.file.path ? ` · 引用自 ${selected.ownerPath.split("/").pop()?.replace(/\.md$/, "")}` : ""} · Tab 继续 · Enter 同起点分支 · 空格编辑标题` : `${this.nodes.length} 个节点 · ${this.edges.length} 条连线`);
  }

  private onPointerDown(event: PointerEvent) {
    if (event.pointerType === "touch") this.touchPoints.set(event.pointerId, event);
    if (event.pointerType === "touch" && this.touchPoints.size >= 2) { this.beginTouchPan(); return; }
    if ((event.button !== 0 && event.button !== 2) || this.editor || this.busy) return;
    this.suppressContextMenu = false; this.clearEdgeHover(); this.canvas.focus();
    const rect = this.canvas.getBoundingClientRect(), point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const node = this.nodeAt(point.x, point.y);
    const base = { pointer: event.pointerId, start: point, last: point, moved: false };
    if (event.button === 2 || event.pointerType === "touch" && !node) {
      this.gesture = { ...base, kind: "pan", right: event.button === 2 };
    } else {
      this.selectedNodes.clear(); this.selected = node?.path; this.hovered = undefined;
      if (node && event.altKey && !node.placeholder) this.gesture = { ...base, kind: "link", node, end: point };
      else if (node) {
        const world = this.screenToWorld(point.x, point.y);
        const displayed = this.displayPoint(node);
        this.gesture = { ...base, kind: "node", node, displayed: { ...displayed }, offset: { x: displayed.x - world.x, y: displayed.y - world.y } };
        this.readingTransition.hold(node.path, displayed);
      } else this.gesture = { ...base, kind: "box", end: point, edge: node ? undefined : this.edgeAt(point.x, point.y) };
    }
    this.forceLayout.setSelected(this.selected);
    this.startLayoutAnimation();
    this.canvas.setPointerCapture(event.pointerId); this.draw();
  }

  private onPointerMove(event: PointerEvent) {
    if (event.pointerType === "touch") {
      this.touchPoints.set(event.pointerId, event);
      if (this.touchPoints.size >= 2) { event.preventDefault(); this.updateTouchPan(); return; }
    }
    const rect = this.canvas.getBoundingClientRect(), point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (!this.gesture) {
      const nextHover = this.nodeAt(point.x, point.y)?.path;
      const nextEdge = !nextHover && !this.editor && !this.busy ? this.edgeAt(point.x, point.y) : undefined;
      if (nextHover !== this.hovered || nextEdge !== this.hoveredEdge) {
        this.hovered = nextHover; this.hoveredEdge = nextEdge;
        if (nextEdge) this.canvas.addClass("is-edge-hovered");
        else this.canvas.removeClass("is-edge-hovered");
        this.draw();
      }
      return;
    }
    const gesture = this.gesture; if (event.pointerId !== gesture.pointer) return;
    const wasMoved = gesture.moved;
    if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 4) gesture.moved = true;
    if (!gesture.moved) return;
    this.canvas.addClass(gesture.kind === "box" ? "is-selecting" : "is-dragging");
    if (gesture.kind === "box") {
      gesture.end = point;
      const left = Math.min(gesture.start.x, point.x), right = Math.max(gesture.start.x, point.x);
      const top = Math.min(gesture.start.y, point.y), bottom = Math.max(gesture.start.y, point.y);
      this.selectedNodes = new Set(this.nodes.filter(node => {
        const p = this.worldToScreen(node);
        return !node.placeholder && p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;
      }).map(node => node.path));
      this.selected = this.selectedNodes.size === 1 ? [...this.selectedNodes][0] : undefined;
      this.forceLayout.setSelected(this.selected);
    } else if (gesture.kind === "node") {
      const world = this.screenToWorld(point.x, point.y);
      const next = { x: world.x + gesture.offset.x, y: world.y + gesture.offset.y };
      if (!wasMoved) { this.setReadingMode(false); this.forceLayout.pin(gesture.node.path, next); }
      gesture.displayed = next;
      this.readingTransition.hold(gesture.node.path, next);
      gesture.node.x = next.x; gesture.node.y = next.y;
      this.forceLayout.movePinned(gesture.node.path, { x: gesture.node.x, y: gesture.node.y });
      this.startLayoutAnimation();
    } else if (gesture.kind === "pan") {
      this.pan.x += (point.x - gesture.last.x) / this.zoom; this.pan.y += (point.y - gesture.last.y) / this.zoom;
      this.scheduleLayoutSave();
    } else gesture.end = point;
    gesture.last = point; this.draw();
  }

  private onPointerUp(event: PointerEvent) {
    if (event.pointerType === "touch") {
      this.touchPoints.delete(event.pointerId);
      if (this.touchPoints.size < 2) {
        this.touchPan = undefined;
        this.canvas.classList.remove("is-touch-panning");
      }
      if (!this.gesture || event.pointerId !== this.gesture.pointer) return;
    }
    const gesture = this.gesture; if (!gesture || event.pointerId !== gesture.pointer) return;
    this.cancelGesture();
    if (gesture.kind === "pan" && gesture.right) {
      this.suppressContextMenu = true;
      if (!gesture.moved) this.showContextMenu(event);
      return;
    }
    if (!gesture.moved) {
      if (gesture.kind === "node" && gesture.node.thoughts.includes(this.thoughtPath)) this.setReadingMode(true, gesture.node);
      if (gesture.kind === "box") {
        this.setReadingMode(false);
        const edge = gesture.edge;
        if (edge && this.edges.includes(edge)) void this.disconnectEdge(edge);
      }
      return;
    }
    if (gesture.kind === "node") { this.forceLayout.unpin(gesture.node.path); this.scheduleLayoutSave(); this.startLayoutAnimation(); }
    if (gesture.kind === "link") {
      const rect = this.canvas.getBoundingClientRect(), target = this.nodeAt(event.clientX - rect.left, event.clientY - rect.top);
      if (target && !target.placeholder && target.path !== gesture.node.path) void this.connect(gesture.node, target);
    }
  }

  private cancelGesture() {
    const gesture = this.gesture;
    if (gesture?.kind === "node") this.forceLayout.unpin(gesture.node.path);
    const pointer = this.gesture?.pointer;
    this.gesture = undefined;
    if (pointer !== undefined && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
    this.canvas?.removeClass("is-dragging"); this.canvas?.removeClass("is-selecting");
    if (!this.closed) this.draw();
  }

  private onPointerCancel(event: PointerEvent) {
    if (this.gesture?.kind === "box") { this.selectedNodes.clear(); this.selected = undefined; this.forceLayout.setSelected(undefined); }
    if (event.pointerType === "touch") this.touchPoints.delete(event.pointerId);
    this.touchPan = undefined;
    this.canvas?.classList.remove("is-touch-panning");
    this.cancelGesture();
  }

  private beginTouchPan() {
    const points = [...this.touchPoints.values()];
    if (points.length < 2) return;
    if (this.gesture) this.cancelGesture();
    const first = points[0], second = points[1], rect = this.canvas.getBoundingClientRect();
    const midpoint = { x: (first.clientX + second.clientX) / 2 - rect.left, y: (first.clientY + second.clientY) / 2 - rect.top };
    this.touchPan = {
      center: midpoint,
      start: this.screenToWorld(midpoint.x, midpoint.y),
      distance: Math.max(1, Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)),
      zoom: this.zoom,
    };
    this.canvas.classList.add("is-touch-panning");
  }

  private updateTouchPan() {
    if (!this.touchPan) { this.beginTouchPan(); return; }
    const points = [...this.touchPoints.values()];
    if (points.length < 2) return;
    const first = points[0], second = points[1], rect = this.canvas.getBoundingClientRect();
    const midpoint = { x: (first.clientX + second.clientX) / 2 - rect.left, y: (first.clientY + second.clientY) / 2 - rect.top };
    const distance = Math.max(1, Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY));
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.touchPan.zoom * distance / this.touchPan.distance));
    this.zoom = nextZoom;
    this.pan = { x: (midpoint.x - this.canvas.clientWidth / 2) / nextZoom - this.touchPan.start.x, y: (midpoint.y - this.canvas.clientHeight / 2) / nextZoom - this.touchPan.start.y };
    this.startLayoutAnimation();
    this.scheduleLayoutSave();
    this.draw();
  }

  private onWheel(event: WheelEvent) {
    event.preventDefault(); if (this.editor) return;
    const platform = this.canvas.ownerDocument?.defaultView?.navigator.platform ?? this.contentEl.ownerDocument.defaultView?.navigator.platform ?? "";
    if (isMacTrackpadPan(event, platform)) {
      // Wheel deltas are screen pixels; the camera stores its offset in world units.
      // Stop pending zoom so switching from pinch to pan cannot move the anchor.
      if (this.cameraFrame !== undefined) this.contentEl.win.cancelAnimationFrame(this.cameraFrame);
      this.cameraFrame = undefined;
      this.targetZoom = undefined;
      this.zoomAnchor = undefined;
      this.pan.x -= event.deltaX / this.zoom;
      this.pan.y -= event.deltaY / this.zoom;
      this.hovered = undefined;
      this.clearEdgeHover();
      this.scheduleLayoutSave();
      this.draw();
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    this.zoomAnchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.clientHeight : 1);
    this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (this.targetZoom ?? this.zoom) * Math.exp(-delta * .002)));
    this.animateZoom();
  }

  private animateZoom() {
    if (this.closed || this.cameraFrame !== undefined) return;
    this.cameraFrame = this.contentEl.win.requestAnimationFrame(() => {
      this.cameraFrame = undefined;
      if (this.closed || this.targetZoom === undefined || !this.zoomAnchor) return;
      const before = this.screenToWorld(this.zoomAnchor.x, this.zoomAnchor.y);
      this.zoom += (this.targetZoom - this.zoom) * .25;
      if (Math.abs(this.targetZoom - this.zoom) < .0001) { this.zoom = this.targetZoom; this.targetZoom = undefined; }
      const after = this.screenToWorld(this.zoomAnchor.x, this.zoomAnchor.y);
      this.pan.x += after.x - before.x; this.pan.y += after.y - before.y;
      this.startLayoutAnimation();
      this.draw(); this.scheduleLayoutSave();
      if (this.targetZoom !== undefined) this.animateZoom();
    });
  }

  private onDoubleClick(event: MouseEvent) {
    if (this.editor || this.busy) return;
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const node = this.nodeAt(x, y);
    if (node?.nodeId) void this.beginEdit(node);
    else if (node?.openPath) void this.app.workspace.openLinkText(node.openPath, "", false);
    else void this.beginCreate(this.screenToWorld(x, y));
  }

  private onKeyDown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.isComposing && event.key.toLowerCase() === "z" && !this.editor) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat && !this.busy) void this.undoGraphEdit(event.shiftKey);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && !this.editor) {
      event.preventDefault(); this.toggleSearch(true); return;
    }
    if (!event.isComposing && !event.altKey && !event.shiftKey && (event.metaKey || event.ctrlKey)
      && event.key === "Enter" && !this.editor && !this.busy) {
      if (this.selected) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) void this.insertParent(); }
      return;
    }
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || this.editor || this.busy) return;
    if (event.key.toLowerCase() === "f") { event.preventDefault(); this.fitToView(); return; }
    if ((event.key === "Backspace" || event.key === "Delete") && this.selectedNodes.size) {
      event.preventDefault(); event.stopPropagation(); if (!event.repeat) void this.deleteSelectedNodes(); return;
    }
    const node = this.nodes.find(item => item.path === this.selected);
    if (event.key === "Tab" || event.key === "Enter") { event.preventDefault(); void this.createRelative(event.key === "Tab"); }
    else if (event.key === " " && node) {
      event.preventDefault();
      if (!event.repeat) void this.beginEdit(node);
    }
    else if ((event.key === "Delete" || event.key === "Backspace") && node) {
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) this.removeNode(node, event.key !== "Backspace");
    }
    else if (event.key === "Escape") { this.selectedNodes.clear(); this.selected = undefined; this.forceLayout.setSelected(undefined); this.setReadingMode(false); this.draw(); }
  }

  private editingThought(node?: GraphNode): string | undefined {
    if (this.thoughtPath) return this.thoughtPath;
    if (node?.thoughts.length === 1) return node.thoughts[0];
    if (this.snapshot.thoughts.length === 1) return this.snapshot.thoughts[0].path;
    if (node) new Notice("节点属于多个思考，请先在图谱设置中选择要修改的思考");
  }

  private async createRelative(child: boolean) {
    const node = this.nodes.find(item => item.path === this.selected);
    if (!node) { await this.beginCreate(this.screenToWorld(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2)); return; }
    const thought = this.file?.path ?? this.editingThought(node);
    if (this.source === "vault" || !thought) { new Notice("请先打开一个思考文件，节点会保存在这份文件中"); return; }
    if (node.placeholder) { await this.beginCreate({ x: node.x, y: node.y }, undefined, thought); return; }
    let parent: string | undefined = node.path;
    if (!child) {
      // A graph node can have several incoming edges. Branch from the most
      // recent visit's predecessor, never an arbitrary first graph parent.
      const visits = this.snapshot.steps?.filter(step => step.thoughtPath === thought) ?? [];
      let index = visits.length - 1;
      while (index >= 0 && visits[index].key !== node.path) index--;
      parent = visits[index]?.parentKey;
    }
    const displayed = this.displayPoint(node);
    await this.beginCreate({ x: displayed.x + (child ? 240 : 0), y: displayed.y + (child ? 0 : 140) }, parent, thought, !child);
  }

  private async insertParent() {
    const node = this.nodes.find(item => item.path === this.selected);
    if (!node || node.placeholder) return;
    const thought = this.file?.path ?? this.editingThought(node);
    if (this.source === "vault" || !thought) { new Notice("请先打开一个思考文件"); return; }
    const visits = this.snapshot.steps?.filter(step => step.thoughtPath === thought) ?? [];
    let index = visits.length - 1;
    while (index >= 0 && visits[index].key !== node.path) index--;
    const child = visits[index], parentKey = child?.parentKey;
    if (!child || !parentKey) { new Notice("当前节点没有父节点，无法在中间插入"); return; }
    const parentNode = this.nodes.find(item => item.path === parentKey);
    const displayed = this.displayPoint(node), parentPoint = parentNode && this.displayPoint(parentNode);
    const point = parentPoint ? { x: (displayed.x + parentPoint.x) / 2, y: (displayed.y + parentPoint.y) / 2 }
      : { x: displayed.x - 240, y: displayed.y };
    await this.beginCreate(point, parentKey, thought, false, { child: node.path, parent: parentKey, ordinal: child.ordinal });
  }

  private async beginCreate(point: Point, parent?: string, target = this.editingThought(), newPath = false, insertion?: InsertThoughtTarget) {
    if (this.busy) return;
    target = this.file?.path ?? target;
    if (target && !isThoughtFile(target, this.plugin.layout.settings.noteFolder)) { new Notice("这篇笔记不在思考目录中"); return; }
    if (this.source === "vault" || !target) { new Notice("请先打开一个思考文件，或运行「新建思考」命令"); return; }
    this.closeEditor();
    this.selectedNodes.clear();
    this.setReadingMode(true, this.nodes.find(node => node.path === parent));
    const draft: GraphNode = { path: `draft:${crypto.randomUUID()}`, label: "", openPath: "", degree: parent ? 1 : 0, thoughts: target ? [target] : [], kind: "note", ...point };
    this.draftNode = draft; this.draftParent = parent; this.draftChild = insertion?.child;
    this.filterSnapshot();
    this.selected = draft.path;
    this.forceLayout.pin(draft.path, point);
    this.forceLayout.setSelected(draft.path);
    const form = this.contentEl.createEl("form", { cls: "brainos-node-title-editor" }); this.editor = form;
    const title = form.createEl("input", { cls: "brainos-node-title-input", placeholder: "输入名称，同名复用已有节点", attr: { "aria-label": "节点标题", autocomplete: "off", required: "" } });
    if (insertion) title.placeholder = "输入要插入的新节点名称";
    let chosen: NodeTitleCandidate | undefined;
    this.titleSuggest = new NodeTitleSuggest(this.app, title, target, async () => {
      const snapshot = await buildSnapshot(this.app, undefined, this.plugin.layout.settings.noteFolder).catch(() => ({ ...this.snapshot, nodes: this.snapshot.nodes.filter(node => !!node.ownerPath && isThoughtFile(node.ownerPath, this.plugin.layout.settings.noteFolder)) }));
      return snapshot.nodes;
    }, candidate => {
      if (this.editor !== form || this.busy) return;
      chosen = candidate; form.requestSubmit();
    }, () => this.composing, !!insertion);
    let continueAfterSave = false;
    title.addEventListener("compositionstart", () => { this.composing = true; });
    title.addEventListener("compositionend", () => { this.composing = false; });
    title.oninput = () => {
      chosen = undefined;
      title.style.width = `${Math.max(110, Math.min(420, Array.from(title.value).length * 15 + 28))}px`;
    };
    form.onkeydown = event => {
      if (event.defaultPrevented) return;
      // Let the native popover handle its navigation and selection keys.
      if (this.titleSuggest?.isShowing && ["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(event.key)) return;
      event.stopPropagation();
      const action = titleKeyAction(event);
      if (action === "none") return;
      event.preventDefault();
      if (action === "cancel") { this.closeEditor(); this.setReadingMode(false); this.draw(); return; }
      if (this.composing || !title.value.trim()) return;
      continueAfterSave = action === "continue";
      form.requestSubmit();
    };
    form.onsubmit = event => {
      event.preventDefault();
      const label = title.value.trim();
      if (!label || this.busy || this.composing) return;
      title.disabled = true;
      const shouldContinue = continueAfterSave;
      void (async () => {
        let committed = false;
        await this.runEdit(async () => {
          const parentNode = parent ? this.nodes.find(node => node.path === parent) : undefined;
          const reference = chosen?.kind === "reference" ? chosen.node : undefined;
          const key = reference ? (await referenceThoughtNode(this.app, target, reference, parentNode, newPath), reference.path)
            : insertion ? await insertThoughtNode(this.app, target, label, insertion)
            : await createThoughtNode(this.app, target, label, "", parentNode ? { key: parentNode.path, title: parentNode.label, newPath } : undefined);
          // Reusing a name keeps the original node's position.
          if (!this.snapshot.nodes.some(node => node.path === key)) this.plugin.layout.positions[key] = { x: draft.x, y: draft.y };
          const session = this.plugin.activeSession;
          if (parent && (newPath || session?.stepKeys[session.stepKeys.length - 1] !== parent)) this.plugin.recordSessionStep(parent, target);
          this.plugin.recordSessionStep(key, target);
          await this.plugin.saveLayout();
          this.closeEditor(); this.selected = key;
          this.thoughtPath = target!;
          await this.refresh(); this.plugin.refreshViews();
          this.canvas.focus(); committed = true;
        });
        title.disabled = false;
        if (!committed && this.editor === form) title.focus();
        if (committed && shouldContinue) await this.createRelative(true);
      })();
    };
    title.onblur = () => this.contentEl.win.requestAnimationFrame(() => {
      if (this.editor !== form || this.busy || this.composing) return;
      if (title.value.trim()) form.requestSubmit();
      else { this.closeEditor(); this.setReadingMode(false); this.draw(); }
    });
    this.positionDraftEditor(); this.startLayoutAnimation(); this.draw(); title.focus();
  }

  private positionDraftEditor() {
    const anchor = this.draftNode ?? this.nodes.find(node => node.path === this.editingNode?.path);
    if (!anchor || !this.editor) return;
    const point = this.worldToScreen(anchor);
    const radius = nodeScreenRadius(anchor.degree, this.zoom, this.graphOptions.nodeSizeMultiplier);
    this.editor.style.left = `${this.canvas.offsetLeft + point.x}px`;
    this.editor.style.top = `${this.canvas.offsetTop + point.y + radius + 6 + (this.editingNode ? 15 : 0)}px`;
  }

  private async beginEdit(node: GraphNode) {
    if (this.busy || node.placeholder) return;
    if (!node.nodeId) { if (node.openPath) await this.app.workspace.openLinkText(node.openPath, this.file?.path ?? "", false); return; }
    await this.runEdit(async () => {
      const original = await readThoughtNode(this.app, node.path);
      if (this.closed) return;
      this.closeEditor();
      this.selectedNodes.clear(); this.editingNode = node; this.selected = node.path; this.hovered = node.path;
      if (node.thoughts.includes(this.thoughtPath)) this.setReadingMode(true, node);
      this.forceLayout.setSelected(node.path);
      const form = this.contentEl.createEl("form", { cls: "brainos-node-title-editor" }); this.editor = form;
      const title = form.createEl("input", { cls: "brainos-node-title-input", attr: { "aria-label": "节点标题", autocomplete: "off" } });
      title.value = original.node.title;
      const resizeTitle = () => { title.style.width = `${Math.max(110, Math.min(420, Array.from(title.value).length * 15 + 28))}px`; };
      let chosen: NodeTitleCandidate | undefined;
      this.titleSuggest = new NodeTitleSuggest(this.app, title, original.file.path,
        async () => (await buildSnapshot(this.app, original.file, this.plugin.layout.settings.noteFolder)).nodes,
        candidate => {
          if (this.editor !== form || this.busy) return;
          chosen = candidate; resizeTitle(); form.requestSubmit();
        }, () => this.composing, false, node.path);
      title.oninput = () => { chosen = undefined; resizeTitle(); }; resizeTitle();
      title.addEventListener("compositionstart", () => { this.composing = true; });
      title.addEventListener("compositionend", () => { this.composing = false; });
      form.onkeydown = event => {
        if (event.defaultPrevented) return;
        if (this.titleSuggest?.isShowing && ["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(event.key)) return;
        event.stopPropagation();
        const action = titleKeyAction(event);
        if (action === "none" || this.busy) return;
        event.preventDefault();
        if (action === "cancel") { this.closeEditor(); this.setReadingMode(false); this.draw(); return; }
        if (!this.composing && title.value.trim()) form.requestSubmit();
      };
      form.onsubmit = event => {
        event.preventDefault();
        if (this.busy || this.composing || !title.value.trim()) return;
        if (title.value.trim() === original.node.title) { this.closeEditor(); this.draw(); return; }
        title.disabled = true;
        void this.runEdit(async () => {
          // A title edit preserves every occurrence's original Markdown body verbatim.
          const reuse = chosen?.kind === "reuse" && chosen.node.label === title.value.trim();
          const key = await editThoughtNode(this.app, node.path, title.value, undefined, original.node, reuse);
          if (key !== node.path) {
            const point = this.plugin.layout.positions[node.path];
            if (point) {
              if (!this.plugin.layout.positions[key]) this.plugin.layout.positions[key] = point;
              delete this.plugin.layout.positions[node.path];
            }
            for (const session of this.plugin.layout.sessions) session.stepKeys = session.stepKeys.map(step => step === node.path ? key : step);
            this.plugin.layout.graph.hiddenPaths = this.plugin.layout.graph.hiddenPaths.map(path => path === node.path ? key : path);
            this.selected = key; await this.plugin.saveLayout();
          }
          this.closeEditor(); await this.refresh(); this.plugin.refreshViews();
        }).finally(() => {
          title.disabled = false;
          if (this.editor === form) title.focus();
        });
      };
      title.onblur = () => this.contentEl.win.requestAnimationFrame(() => {
        if (this.editor !== form || this.busy || this.composing) return;
        if (title.value.trim()) form.requestSubmit();
        else { this.closeEditor(); this.setReadingMode(false); this.draw(); }
      });
      this.positionDraftEditor(); this.startLayoutAnimation(); this.draw(); title.focus(); title.select();
    });
  }

  async openReferencePicker() {
    const thought = this.file?.path ?? this.editingThought();
    if (!thought || this.source === "vault") { new Notice("请先打开一个思考文件"); return; }
    await this.runEdit(async () => {
      const snapshot = await buildSnapshot(this.app, undefined, this.plugin.layout.settings.noteFolder);
      const current = this.nodes.filter(node => node.nodeId && !!node.ownerPath && isThoughtFile(node.ownerPath, this.plugin.layout.settings.noteFolder));
      const byKey = new Map([...snapshot.nodes, ...current].filter(node => node.nodeId).map(node => [node.path, node]));
      const parent = this.nodes.find(node => node.path === this.selected && node.nodeId);
      new NodeReferenceModal(this.app, [...byKey.values()], node => {
        void this.runEdit(async () => {
          await referenceThoughtNode(this.app, thought, node, parent);
          this.selectedNodes.clear(); this.selected = node.path; this.plugin.recordSessionStep(node.path, thought);
          await this.refresh(); this.plugin.refreshViews(); this.canvas.focus();
        });
      }).open();
    });
  }

  cancelNodeEditing() { this.closeEditor(); this.setReadingMode(false); this.draw(); }

  private closeEditor() {
    this.clearEdgeHover();
    this.titleSuggest?.dispose(); this.titleSuggest = undefined;
    this.editingNode = undefined;
    this.editor?.remove(); this.editor = undefined;
    if (this.draftNode) {
      const path = this.draftNode.path;
      this.forceLayout.unpin(path);
      this.draftNode = undefined; this.draftParent = undefined; this.draftChild = undefined;
      this.nodes = this.nodes.filter(node => node.path !== path);
      this.edges = this.edges.filter(edge => edge.from !== path && edge.to !== path);
      if (this.selected === path) this.selected = undefined;
      if (!this.closed) this.filterSnapshot();
    }
    this.composing = false;
    if (!this.closed) this.canvas?.focus();
  }

  private async undoGraphEdit(redo = false) {
    if (this.busy) return;
    this.busy = true;
    try {
      const history = graphHistory(this.app);
      if (await (redo ? history.redo() : history.undo())) {
        this.closeEditor(); await this.refresh(); this.plugin.refreshViews(); this.canvas.focus();
      }
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
    finally { this.busy = false; }
  }

  private async runEdit(action: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    try {
      await graphHistory(this.app).record(action, {
        capture: () => ({
          positions: JSON.parse(JSON.stringify(this.plugin.layout.positions)) as Record<string, Point>,
          steps: this.plugin.layout.sessions.map(session => [...session.stepKeys]),
          selected: this.selected, selectedNodes: [...this.selectedNodes],
        }),
        restore: async (value, previous) => {
          for (const key of new Set([...Object.keys(value.positions), ...Object.keys(previous.positions)])) {
            if (JSON.stringify(value.positions[key]) === JSON.stringify(previous.positions[key])) continue;
            if (value.positions[key]) this.plugin.layout.positions[key] = { ...value.positions[key] };
            else delete this.plugin.layout.positions[key];
          }
          value.steps.forEach((steps, index) => {
            const session = this.plugin.layout.sessions[index];
            if (session && JSON.stringify(steps) !== JSON.stringify(previous.steps[index])) session.stepKeys = [...steps];
          });
          this.selected = value.selected; this.selectedNodes = new Set(value.selectedNodes);
          await this.plugin.saveLayout();
        },
      });
    } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
    finally { this.busy = false; }
  }

  private async connect(from: GraphNode, to: GraphNode) {
    const thought = this.file?.path ?? this.editingThought(from);
    if (this.source === "vault" || !thought) { new Notice("请在思考文件内组合节点；全库图谱仅用于查看笔记双链"); return; }
    if (from.placeholder || to.placeholder) return;
    await this.runEdit(async () => {
      await linkThoughtNodes(this.app, thought, from, to);
      const session = this.plugin.activeSession;
      if (session?.stepKeys[session.stepKeys.length - 1] !== from.path) this.plugin.recordSessionStep(from.path, thought);
      this.plugin.recordSessionStep(to.path, thought);
      await this.refresh(); this.plugin.refreshViews();
    });
  }

  private async deleteSelectedNodes() {
    if (this.busy || !this.selectedNodes.size) return;
    const selected = [...this.selectedNodes];
    if (this.source === "vault") {
      this.plugin.layout.graph.hiddenPaths = [...new Set([...this.plugin.layout.graph.hiddenPaths, ...selected])];
      this.selectedNodes.clear(); this.selected = undefined; await this.plugin.saveLayout(); this.filterSnapshot(); this.draw(); return;
    }
    const thought = this.file?.path ?? this.thoughtPath;
    if (!thought) { new Notice("请先选择要修改的思考文件"); return; }
    await this.runEdit(async () => {
      await removeThoughtNodes(this.app, thought, selected);
      this.selectedNodes.clear(); this.selected = undefined; await this.refresh(); this.plugin.refreshViews();
    });
  }

  private removeNode(node: GraphNode, confirm = true) {
    if (this.source === "vault") {
      this.plugin.layout.graph.hiddenPaths.push(node.path);
      this.selected = undefined; void this.plugin.saveLayout(); this.filterSnapshot(); this.draw(); return;
    }
    if (node.placeholder) return;
    const thought = this.file?.path ?? this.editingThought(node); if (!thought) return;
    const owned = splitNodeKey(node.path)?.file === thought;
    const remove = () => this.runEdit(async () => {
      await removeThoughtNode(this.app, thought, node.path);
      this.selected = undefined; await this.refresh(); this.plugin.refreshViews();
    });
    if (confirm) new RemoveNodeModal(this.app, node.label, owned, remove).open();
    else void remove();
  }

  private edgeAt(x: number, y: number): GraphEdge | undefined {
    const byPath = new Map(this.nodes.map(node => [node.path, node]));
    let closest: GraphEdge | undefined, distance = 8 + this.graphOptions.lineSizeMultiplier / 2;
    for (const edge of this.edges) {
      const a = byPath.get(edge.from), b = byPath.get(edge.to); if (!a || !b) continue;
      const p = this.worldToScreen(a), q = this.worldToScreen(b), dx = q.x - p.x, dy = q.y - p.y;
      const length = dx * dx + dy * dy; if (!Number.isFinite(length) || length < 0.001) continue;
      const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / length));
      const next = Math.hypot(x - p.x - t * dx, y - p.y - t * dy);
      if (next < distance) { distance = next; closest = edge; }
    }
    return closest;
  }

  private clearEdgeHover() {
    this.hoveredEdge = undefined; this.canvas?.removeClass("is-edge-hovered");
  }

  private async disconnectEdge(edge: GraphEdge) {
    if (this.busy) return;
    const thought = this.file?.path || this.thoughtPath || (edge.thoughts.length === 1 ? edge.thoughts[0] : undefined);
    if (this.source !== "vault" && !thought) { new Notice("连线属于多个思考，请先选择要修改的思考"); return; }
    if (this.source !== "vault" && !edge.thoughts.includes(thought!)) { new Notice("此连线属于其他思考，请先在侧栏选择对应文件"); return; }
    await this.runEdit(async () => {
      if (this.source === "vault") {
        const directions = this.edges.filter(value => edgeStrokeKey(value.from, value.to) === edgeStrokeKey(edge.from, edge.to));
        for (const direction of directions) await removeVaultLink(this.app, direction.from, direction.to);
      } else await unlinkThoughtNodes(this.app, thought!, edge.from, edge.to, true);
      this.clearEdgeHover(); await this.refresh(); this.plugin.refreshViews(); this.canvas.focus();
    });
  }

  private onContextMenu(event: MouseEvent) {
    event.preventDefault();
    if (this.gesture?.kind === "pan" && this.gesture.right || this.suppressContextMenu && event.button === 2) return;
    this.showContextMenu(event);
  }

  private showContextMenu(event: MouseEvent) {
    event.preventDefault(); if (this.editor || this.busy) return;
    this.clearEdgeHover();
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const node = this.nodeAt(x, y), menu = new Menu();
    if (node) {
      this.selectedNodes.clear(); this.selected = node.path; this.forceLayout.setSelected(this.selected); this.startLayoutAnimation(); this.draw();
      menu.addItem(item => item.setTitle("编辑节点").setIcon("pencil").onClick(() => void this.beginEdit(node)));
      menu.addItem(item => item.setTitle("打开来源 Markdown").setIcon("file-text").onClick(() => void this.app.workspace.openLinkText(node.openPath, "", false)));
      menu.addItem(item => item.setTitle("引用已有节点…").setIcon("link").onClick(() => void this.openReferencePicker()));
      menu.addItem(item => item.setTitle("延伸节点（Tab）").setIcon("git-branch").onClick(() => void this.createRelative(true)));
      menu.addItem(item => item.setTitle("从这里另开一路").setIcon("git-fork").onClick(() => {
        const point = this.displayPoint(node);
        void this.beginCreate({ x: point.x + 240, y: point.y + 140 }, node.path, this.editingThought(node), true);
      }));
      menu.addItem(item => item.setTitle(this.source === "vault" ? "从图谱隐藏" : node.ownerPath === this.file?.path ? "删除此节点…" : "从当前思考移除引用…").setIcon("unlink").onClick(() => this.removeNode(node)));
    } else {
      const edge = this.edgeAt(x, y);
      if (!edge) return;
      menu.addItem(item => item.setTitle("断开此连线").setIcon("unlink").onClick(() => void this.disconnectEdge(edge)));
    }
    menu.showAtMouseEvent(event);
  }
}

class RemoveNodeModal extends Modal {
  constructor(app: BrainOSPlugin["app"], private label: string, private owned: boolean, private remove: () => Promise<void>) { super(app); }
  onOpen() {
    this.titleEl.setText(`移除「${this.label}」？`);
    this.contentEl.createEl("p", { text: this.owned ? "删除本文件中这个名称的全部记录及相邻连线。其他思考对它的引用会显示为失效；不会删除思考文件。" : "仅移除本思考中的引用及相邻关系，来源节点的标题和正文保持不变。" });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText("取消").onClick(() => this.close()))
      .addButton(button => {
        if (requireApiVersion("1.13.0")) button.setDestructive();
        else button.setClass("mod-warning");
        button.setButtonText(this.owned ? "删除节点" : "移除引用").onClick(() => { this.close(); void this.remove(); });
      });
  }
  onClose() { this.contentEl.empty(); }
}

class NodeReferenceModal extends SuggestModal<GraphNode> {
  constructor(app: BrainOSPlugin["app"], private nodes: GraphNode[], private choose: (node: GraphNode) => void) {
    super(app); this.setPlaceholder("搜索已有节点，引用到当前思考…");
  }
  getSuggestions(query: string) {
    const tokens = query.trim().toLocaleLowerCase().split(/\s+/);
    return this.nodes.filter(node => tokens.every(token => `${node.label} ${node.ownerPath}`.toLocaleLowerCase().includes(token))).slice(0, 50);
  }
  renderSuggestion(node: GraphNode, el: HTMLElement) {
    el.createDiv({ text: node.label });
    el.createDiv({ cls: "brainos-node-editor-target", text: node.ownerPath ?? "" });
  }
  onChooseSuggestion(node: GraphNode) { this.choose(node); }
}
