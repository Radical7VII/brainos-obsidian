import { ItemView, MarkdownView, Menu, Modal, Notice, Setting, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type BrainOSPlugin from "./main";
import { GraphEdge, GraphNode, GraphSnapshot, Point, addChild, addSibling, appendRoot, buildSnapshot, createThought, listThoughtFiles, removeNode, renameNode } from "./thoughts";

export const VIEW_TYPE = "brainos-graph-view";

type Gesture = { pointer: number; start: Point; last: Point; moved: boolean } & (
  { kind: "node"; node: GraphNode; offset: Point } |
  { kind: "pan" } |
  { kind: "link"; node: GraphNode; end: Point }
);

export class BrainOSGraphView extends ItemView {
  private canvas!: HTMLCanvasElement;
  private search!: HTMLInputElement;
  private thoughtSelect!: HTMLSelectElement;
  private status!: HTMLElement;
  private snapshot: GraphSnapshot = { nodes: [], edges: [], thoughts: [] };
  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];
  private thoughtPath = "";
  private zoom = 1;
  private pan: Point = { x: 0, y: 0 };
  private selected?: string;
  private gesture?: Gesture;
  private editor?: HTMLElement;
  private busy = false;
  private refreshRevision = 0;
  private closed = false;

  constructor(leaf: WorkspaceLeaf, private plugin: BrainOSPlugin) { super(leaf); }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "BrainOS 图谱"; }
  getIcon() { return "git-branch"; }

  async onOpen() {
    this.closed = false;
    this.contentEl.empty();
    this.contentEl.addClass("brainos-graph-view");
    const toolbar = this.contentEl.createDiv({ cls: "brainos-graph-toolbar" });
    this.thoughtSelect = toolbar.createEl("select", { attr: { "aria-label": "当前思考" } });
    this.thoughtSelect.onchange = () => {
      this.thoughtPath = this.thoughtSelect.value;
      this.selected = undefined;
      this.closeEditor();
      this.filterSnapshot();
      this.draw();
    };
    const create = toolbar.createEl("button", { text: "新建节点" });
    create.onclick = () => void this.beginCreate(this.screenToWorld(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2));
    const extend = toolbar.createEl("button", { text: "延伸节点", attr: { title: "选中节点后按 Tab" } });
    extend.onclick = () => void this.createRelative(true);
    const refresh = toolbar.createEl("button", { attr: { "aria-label": "刷新图谱" } });
    setIcon(refresh, "refresh-cw"); refresh.onclick = () => void this.refresh();
    const focus = toolbar.createEl("button", { text: "聚焦当前" }); focus.onclick = () => this.focusCurrent();
    this.search = toolbar.createEl("input", { type: "search", placeholder: "搜索节点…", attr: { "aria-label": "搜索节点" } });
    this.search.oninput = () => this.draw();
    this.canvas = this.contentEl.createEl("canvas", { cls: "brainos-graph-canvas", attr: { "aria-label": "BrainOS 可编辑图谱" } });
    this.canvas.tabIndex = 0;
    this.status = this.contentEl.createDiv({ cls: "brainos-graph-status" });
    this.registerDomEvent(this.canvas, "pointerdown", event => this.onPointerDown(event));
    this.registerDomEvent(this.canvas, "pointermove", event => this.onPointerMove(event));
    this.registerDomEvent(this.canvas, "pointerup", event => this.onPointerUp(event));
    this.registerDomEvent(this.canvas, "pointercancel", () => this.cancelGesture());
    this.registerDomEvent(this.canvas, "lostpointercapture", () => this.cancelGesture());
    this.registerDomEvent(this.canvas, "wheel", event => this.onWheel(event), { passive: false });
    this.registerDomEvent(this.canvas, "dblclick", event => this.onDoubleClick(event));
    this.registerDomEvent(this.canvas, "contextmenu", event => this.onContextMenu(event));
    this.registerDomEvent(this.canvas, "keydown", event => this.onKeyDown(event));
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(this.contentEl);
    this.register(() => observer.disconnect());
    await this.refresh();
  }

  async onClose() {
    this.closed = true;
    this.refreshRevision++;
    this.cancelGesture();
    this.closeEditor();
  }

  async refresh() {
    const revision = ++this.refreshRevision;
    const thoughts = await listThoughtFiles(this.app, this.plugin.layout.settings.thoughtFolder, this.plugin.layout.thoughts);
    const snapshot = await buildSnapshot(this.app, thoughts);
    if (this.closed || revision !== this.refreshRevision) return;
    this.snapshot = snapshot;
    if (this.thoughtPath && !snapshot.thoughts.some(thought => thought.path === this.thoughtPath)) this.thoughtPath = "";
    this.thoughtSelect.empty();
    this.thoughtSelect.createEl("option", { text: "全部思考", value: "" });
    for (const thought of snapshot.thoughts) this.thoughtSelect.createEl("option", { text: `${thought.title} — ${thought.path}`, value: thought.path });
    this.thoughtSelect.value = this.thoughtPath;
    const radius = Math.max(180, Math.sqrt(snapshot.nodes.length) * 85);
    snapshot.nodes.forEach((node, index) => {
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const r = radius * Math.sqrt((index + 1) / Math.max(1, snapshot.nodes.length));
      const position = this.plugin.layout.positions[node.path] ?? { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
      Object.assign(node, position);
      this.plugin.layout.positions[node.path] = { ...position };
    });
    this.filterSnapshot();
    if (this.selected && !this.nodes.some(node => node.path === this.selected)) this.selected = undefined;
    this.resize();
  }

  private filterSnapshot() {
    this.nodes = this.thoughtPath ? this.snapshot.nodes.filter(node => node.thoughts.includes(this.thoughtPath)) : this.snapshot.nodes;
    this.edges = this.thoughtPath ? this.snapshot.edges.filter(edge => edge.thoughts.includes(this.thoughtPath)) : this.snapshot.edges;
  }

  /// 工具栏当前选中的思考文件；「全部思考」时为空。
  currentThought() { return this.thoughtPath; }

  focusCurrent() {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    if (!file) { new Notice("当前没有打开的 Markdown 文件"); return; }
    if (this.snapshot.thoughts.some(thought => thought.path === file.path)) {
      this.thoughtPath = file.path; this.selected = undefined; this.closeEditor();
      this.thoughtSelect.value = file.path; this.filterSnapshot(); this.draw();
      return;
    }
    const node = this.nodes.find(item => item.path === file.basename);
    if (!node) { new Notice("当前文件不是思考文件，也没有同名节点"); return; }
    this.selected = node.path; this.pan = { x: -node.x, y: -node.y }; this.draw();
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
    return { x: this.canvas.clientWidth / 2 + (point.x + this.pan.x) * this.zoom, y: this.canvas.clientHeight / 2 + (point.y + this.pan.y) * this.zoom };
  }
  private screenToWorld(x: number, y: number): Point {
    return { x: (x - this.canvas.clientWidth / 2) / this.zoom - this.pan.x, y: (y - this.canvas.clientHeight / 2) / this.zoom - this.pan.y };
  }
  private nodeAt(x: number, y: number) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const point = this.worldToScreen(this.nodes[i]);
      if (Math.hypot(point.x - x, point.y - y) <= Math.max(10, Math.min(12, 5 + this.nodes[i].degree * .7))) return this.nodes[i];
    }
  }

  private draw() {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d"); if (!ctx) return;
    const dpr = window.devicePixelRatio || 1; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    const colors = getComputedStyle(this.canvas);
    const edgeColor = colors.getPropertyValue("--text-muted") || "#888";
    const accent = colors.getPropertyValue("--interactive-accent") || "#7c3aed";
    const text = colors.getPropertyValue("--text-normal") || "#222";
    const query = this.search.value.trim().toLocaleLowerCase();
    const matches = new Set(this.nodes.filter(node => node.label.toLocaleLowerCase().includes(query) || node.path.toLocaleLowerCase().includes(query)).map(node => node.path));
    const byPath = new Map(this.nodes.map(node => [node.path, node]));
    ctx.lineWidth = 1; ctx.strokeStyle = edgeColor;
    for (const edge of this.edges) {
      const a = byPath.get(edge.from), b = byPath.get(edge.to); if (!a || !b) continue;
      const p = this.worldToScreen(a), q = this.worldToScreen(b);
      ctx.globalAlpha = query && (!matches.has(a.path) || !matches.has(b.path)) ? .18 : .55;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      const angle = Math.atan2(q.y - p.y, q.x - p.x), tip = { x: q.x - Math.cos(angle) * 15, y: q.y - Math.sin(angle) * 15 };
      ctx.beginPath(); ctx.moveTo(tip.x - Math.cos(angle - .5) * 7, tip.y - Math.sin(angle - .5) * 7); ctx.lineTo(tip.x, tip.y); ctx.lineTo(tip.x - Math.cos(angle + .5) * 7, tip.y - Math.sin(angle + .5) * 7); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (this.gesture?.kind === "link") {
      const point = this.worldToScreen(this.gesture.node);
      ctx.strokeStyle = accent; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(this.gesture.end.x, this.gesture.end.y); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const node of this.nodes) {
      const point = this.worldToScreen(node), radius = Math.max(5, Math.min(12, 5 + node.degree * .7));
      ctx.globalAlpha = query && !matches.has(node.path) ? .18 : 1;
      ctx.fillStyle = node.placeholder ? edgeColor : accent; ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill();
      if (node.path === this.selected) { ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(point.x, point.y, radius + 5, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1; }
      ctx.font = `12px ${colors.getPropertyValue("--font-text") || "sans-serif"}`; ctx.textAlign = "center"; ctx.fillStyle = text;
      ctx.fillText(node.label.slice(0, 32), point.x, point.y + radius + 15);
    }
    ctx.globalAlpha = 1;
    let empty = this.contentEl.querySelector<HTMLElement>(".brainos-graph-empty");
    if (!this.nodes.length && !empty) empty = this.contentEl.createDiv({ cls: "brainos-graph-empty", text: "双击空白处或点击「新建节点」，开始一个思考。" });
    if (this.nodes.length) empty?.remove();
    const selected = this.nodes.find(node => node.path === this.selected);
    this.status.setText(selected ? `已选：${selected.label} · Tab 延伸 · Enter 同级 · 空格编辑 · Alt 拖动连线 · 右键更多` : "双击空白创建 · 拖动节点移动 · 拖动空白平移 · 滚轮缩放");
  }

  private onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || this.editor || this.busy) return;
    this.canvas.focus();
    const rect = this.canvas.getBoundingClientRect(), point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const node = this.nodeAt(point.x, point.y);
    const base = { pointer: event.pointerId, start: point, last: point, moved: false };
    if (node) {
      this.selected = node.path;
      const world = this.screenToWorld(point.x, point.y);
      this.gesture = event.altKey && !node.placeholder ? { ...base, kind: "link", node, end: point } : { ...base, kind: "node", node, offset: { x: node.x - world.x, y: node.y - world.y } };
    } else { this.selected = undefined; this.gesture = { ...base, kind: "pan" }; }
    this.canvas.setPointerCapture(event.pointerId); this.draw();
  }

  private onPointerMove(event: PointerEvent) {
    const gesture = this.gesture; if (!gesture || event.pointerId !== gesture.pointer) return;
    const rect = this.canvas.getBoundingClientRect(), point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 4) gesture.moved = true;
    if (!gesture.moved) return;
    this.canvas.addClass("is-dragging");
    if (gesture.kind === "node") {
      const world = this.screenToWorld(point.x, point.y);
      gesture.node.x = world.x + gesture.offset.x; gesture.node.y = world.y + gesture.offset.y;
      this.plugin.layout.positions[gesture.node.path] = { x: gesture.node.x, y: gesture.node.y };
    } else if (gesture.kind === "pan") {
      this.pan.x += (point.x - gesture.last.x) / this.zoom; this.pan.y += (point.y - gesture.last.y) / this.zoom;
    } else gesture.end = point;
    gesture.last = point; this.draw();
  }

  private onPointerUp(event: PointerEvent) {
    const gesture = this.gesture; if (!gesture || event.pointerId !== gesture.pointer) return;
    this.cancelGesture();
    if (!gesture.moved) return;
    if (gesture.kind === "node") void this.runEdit(() => this.plugin.saveLayout());
    if (gesture.kind === "link") {
      const rect = this.canvas.getBoundingClientRect(), target = this.nodeAt(event.clientX - rect.left, event.clientY - rect.top);
      if (target && !target.placeholder && target.path !== gesture.node.path) void this.connect(gesture.node, target);
    }
  }

  private cancelGesture() {
    const pointer = this.gesture?.pointer;
    this.gesture = undefined;
    if (pointer !== undefined && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
    this.canvas?.removeClass("is-dragging");
    if (!this.closed) this.draw();
  }

  private onWheel(event: WheelEvent) {
    event.preventDefault(); if (this.editor) return;
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const before = this.screenToWorld(x, y);
    this.zoom = Math.max(.2, Math.min(3, this.zoom * (event.deltaY > 0 ? .9 : 1.1)));
    const after = this.screenToWorld(x, y); this.pan.x += after.x - before.x; this.pan.y += after.y - before.y; this.draw();
  }

  private onDoubleClick(event: MouseEvent) {
    if (this.editor || this.busy) return;
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const node = this.nodeAt(x, y);
    if (node) void this.app.workspace.openLinkText(node.openPath, "", false);
    else void this.beginCreate(this.screenToWorld(x, y));
  }

  private onKeyDown(event: KeyboardEvent) {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || this.editor || this.busy) return;
    const node = this.nodes.find(item => item.path === this.selected);
    if (event.key === "Tab" || event.key === "Enter") { event.preventDefault(); void this.createRelative(event.key === "Tab"); }
    else if (event.key === " " && node) { event.preventDefault(); void this.beginEdit(node); }
    else if ((event.key === "Delete" || event.key === "Backspace") && node) { event.preventDefault(); this.removeNode(node); }
    else if (event.key === "Escape") { this.selected = undefined; this.draw(); }
  }

  /// 优先用工具栏选中的思考；否则只有唯一归属时才自动落盘。
  private editingThought(node?: GraphNode): string | undefined {
    if (this.thoughtPath) return this.thoughtPath;
    if (node?.placeholder) return node.thoughts[0];
    if (node?.thoughts.length === 1) return node.thoughts[0];
    if (this.snapshot.thoughts.length === 1) return this.snapshot.thoughts[0].path;
    if (node) new Notice("节点属于多个思考，请先在工具栏选择要写入的思考");
  }

  private async createRelative(child: boolean) {
    const node = this.nodes.find(item => item.path === this.selected);
    if (!node) { await this.beginCreate(this.screenToWorld(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2)); return; }
    const thought = this.editingThought(node); if (!thought) return;
    if (node.placeholder) { await this.beginCreate({ x: node.x, y: node.y }, {}, thought); return; }
    if (child) await this.beginCreate({ x: node.x + 150, y: node.y }, { parent: node.path }, thought);
    else await this.beginCreate({ x: node.x, y: node.y + 100 }, { after: node.path }, thought);
  }

  private async beginCreate(point: Point, options: { parent?: string; after?: string } = {}, target = this.editingThought()) {
    if (this.busy) return;
    this.closeEditor();
    const form = this.openEditor(point, options.parent ? "延伸节点" : options.after ? "同级节点" : "新建节点");
    form.createDiv({ cls: "brainos-node-editor-target", text: target ? `写入：${this.snapshot.thoughts.find(thought => thought.path === target)?.title ?? target}` : "写入时自动新建一个思考文件" });
    const title = form.createEl("input", { placeholder: "一行文字就是节点", attr: { "aria-label": "节点文字", required: "" } });
    const controls = form.createDiv({ cls: "brainos-node-editor-actions" });
    const cancel = controls.createEl("button", { text: "取消", attr: { type: "button" } }); cancel.onclick = () => this.closeEditor();
    const save = controls.createEl("button", { text: "创建", cls: "mod-cta", attr: { type: "submit" } });
    form.onsubmit = event => {
      event.preventDefault();
      const label = title.value.trim(); if (!label || this.busy) return;
      save.disabled = true;
      void this.runEdit(async () => {
        let thought = target;
        if (thought) {
          if (!(this.app.vault.getAbstractFileByPath(thought) instanceof TFile)) throw new Error("思考文件已不存在");
        } else {
          const file = await createThought(this.app, label, this.plugin.layout.settings.thoughtFolder);
          this.plugin.layout.thoughts.push(file.path);
          thought = file.path;
        }
        if (options.parent !== undefined) await addChild(this.app, thought, options.parent, label);
        else if (options.after !== undefined) await addSibling(this.app, thought, options.after, label);
        else await appendRoot(this.app, thought, label);
        this.plugin.layout.positions[label] = point;
        await this.plugin.saveLayout();
        this.thoughtPath = thought; this.selected = label;
        this.closeEditor(); await this.refresh(); this.plugin.refreshViews();
      }).finally(() => { save.disabled = false; });
    };
    title.focus();
  }

  private async beginEdit(node: GraphNode) {
    if (this.busy) return;
    if (node.placeholder) { new Notice("这是空思考的入口；可以延伸新节点"); return; }
    const thought = this.editingThought(node); if (!thought) return;
    this.closeEditor();
    const form = this.openEditor(node, `编辑：${node.label}`);
    const field = form.createEl("input", { attr: { "aria-label": "节点文字" } }); field.value = node.label;
    form.createDiv({ cls: "brainos-node-editor-target", text: "相同文字共用一个节点；改名会改掉这份思考里该文字的所有出现。" });
    const controls = form.createDiv({ cls: "brainos-node-editor-actions" });
    const cancel = controls.createEl("button", { text: "取消", attr: { type: "button" } }); cancel.onclick = () => this.closeEditor();
    const save = controls.createEl("button", { text: "保存", cls: "mod-cta", attr: { type: "submit" } });
    form.onsubmit = event => {
      event.preventDefault();
      const value = field.value.trim(); if (!value || this.busy) return;
      save.disabled = true;
      void this.runEdit(async () => {
        if (value !== node.label) await renameNode(this.app, thought, node.label, value);
        this.selected = value;
        this.closeEditor(); await this.refresh(); this.plugin.refreshViews();
      }).finally(() => { save.disabled = false; });
    };
    field.focus();
  }

  private openEditor(point: Point, heading: string): HTMLFormElement {
    const form = this.contentEl.createEl("form", { cls: "brainos-node-editor" }); this.editor = form;
    form.createEl("strong", { text: heading });
    const screen = this.worldToScreen(point);
    form.style.left = `${Math.max(8, Math.min(this.contentEl.clientWidth - 348, screen.x - 160))}px`;
    form.style.top = `${Math.max(60, Math.min(this.contentEl.clientHeight - 240, screen.y + 65))}px`;
    form.onkeydown = event => {
      event.stopPropagation();
      if (event.key === "Escape" && !this.busy) { event.preventDefault(); this.closeEditor(); }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); form.requestSubmit(); }
    };
    return form;
  }

  private closeEditor() {
    this.editor?.remove(); this.editor = undefined;
    if (!this.closed) this.canvas?.focus();
  }

  private async runEdit(action: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    try { await action(); } catch (error) { new Notice(error instanceof Error ? error.message : String(error)); }
    finally { this.busy = false; }
  }

  /// 连线就是让目标成为来源的子行；再次连线已存在的父子会被跳过。
  private async connect(from: GraphNode, to: GraphNode) {
    const thought = this.editingThought(from); if (!thought) return;
    if (this.edges.some(edge => edge.from === from.path && edge.to === to.path && edge.thoughts.includes(thought))) return;
    await this.runEdit(async () => {
      await addChild(this.app, thought, from.path, to.path);
      await this.refresh(); this.plugin.refreshViews();
    });
  }

  private removeNode(node: GraphNode) {
    if (node.placeholder) { new Notice("这是空思考的入口；可以延伸新节点或打开思考文件"); return; }
    const thought = this.editingThought(node); if (!thought) return;
    new RemoveNodeModal(this.app, node.label, () => this.runEdit(async () => {
      await removeNode(this.app, thought, node.path);
      this.selected = undefined; await this.refresh(); this.plugin.refreshViews();
    })).open();
  }

  private onContextMenu(event: MouseEvent) {
    event.preventDefault(); if (this.editor || this.busy) return;
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const node = this.nodeAt(x, y), menu = new Menu();
    if (node) {
      this.selected = node.path; this.draw();
      menu.addItem(item => item.setTitle("编辑这一行").setIcon("pencil").onClick(() => void this.beginEdit(node)));
      menu.addItem(item => item.setTitle("打开思考文件").setIcon("file-text").onClick(() => void this.app.workspace.openLinkText(node.openPath, "", false)));
      menu.addItem(item => item.setTitle("延伸节点（Tab）").setIcon("git-branch").onClick(() => void this.createRelative(true)));
      menu.addItem(item => item.setTitle("从当前思考删除…").setIcon("trash").onClick(() => this.removeNode(node)));
    } else {
      menu.addItem(item => item.setTitle("在这里新建节点").setIcon("plus").onClick(() => void this.beginCreate(this.screenToWorld(x, y))));
    }
    menu.showAtMouseEvent(event);
  }
}

class RemoveNodeModal extends Modal {
  constructor(app: BrainOSPlugin["app"], private label: string, private remove: () => Promise<void>) { super(app); }
  onOpen() {
    this.titleEl.setText(`删除「${this.label}」？`);
    this.contentEl.createEl("p", { text: "会从当前思考的大纲文件里删掉这一行，连同它缩进更深的所有子行。其他思考与文件不变。" });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText("取消").onClick(() => this.close()))
      .addButton(button => button.setButtonText("删除").setWarning().onClick(() => { this.close(); void this.remove(); }));
  }
  onClose() { this.contentEl.empty(); }
}
