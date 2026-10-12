import { ItemView, MarkdownView, Menu, Modal, Notice, Setting, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type BrainOSPlugin from "./main";
import { GraphEdge, GraphNode, GraphSnapshot, Point, addRoute, buildSnapshot, createAtom, createThought, editThought, parseThoughtState, splitRoutes } from "./thoughts";

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
    this.search = toolbar.createEl("input", { type: "search", placeholder: "搜索原子…", attr: { "aria-label": "搜索原子" } });
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
    const snapshot = await buildSnapshot(this.app);
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

  focusCurrent() {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    if (!file) { new Notice("当前没有打开的 Markdown 笔记"); return; }
    const node = this.nodes.find(item => item.openPath === file.path);
    if (!node) { new Notice("当前文件未出现在所选思考图谱中"); return; }
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
      ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill();
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

  private editingThought(node?: GraphNode): string | undefined {
    if (this.thoughtPath) return this.thoughtPath;
    if (node?.thoughts.length === 1) return node.thoughts[0];
    if (this.snapshot.thoughts.length === 1) return this.snapshot.thoughts[0].path;
    if (node) new Notice("节点属于多个思考，请先在工具栏选择要修改的思考");
  }

  private async createRelative(child: boolean) {
    const node = this.nodes.find(item => item.path === this.selected);
    if (!node) { await this.beginCreate(this.screenToWorld(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2)); return; }
    const thought = this.editingThought(node); if (!thought) return;
    if (node.placeholder) { await this.beginCreate({ x: node.x, y: node.y }, undefined, thought); return; }
    const parent = child ? node.path : this.edges.find(edge => edge.to === node.path && edge.thoughts.includes(thought))?.from;
    await this.beginCreate({ x: node.x + (child ? 150 : 0), y: node.y + (child ? 0 : 100) }, parent, thought);
  }

  private async beginCreate(point: Point, parent?: string, target = this.editingThought()) {
    if (this.busy) return;
    this.closeEditor();
    const form = this.openEditor(point, parent ? "延伸节点" : "新建节点");
    form.createDiv({ cls: "brainos-node-editor-target", text: target ? `保存到：${this.snapshot.thoughts.find(thought => thought.path === target)?.title ?? target}` : "保存时自动创建一个新的思考文件" });
    const title = form.createEl("input", { placeholder: "节点标题", attr: { "aria-label": "节点标题", required: "" } });
    const body = form.createEl("textarea", { placeholder: "笔记内容（Markdown，可选）", attr: { "aria-label": "节点内容" } });
    const controls = form.createDiv({ cls: "brainos-node-editor-actions" });
    const cancel = controls.createEl("button", { text: "取消", attr: { type: "button" } }); cancel.onclick = () => this.closeEditor();
    const save = controls.createEl("button", { text: "创建", cls: "mod-cta", attr: { type: "submit" } });
    form.onsubmit = event => {
      event.preventDefault();
      const label = title.value.trim(); if (!label || this.busy) return;
      save.disabled = true;
      void this.runEdit(async () => {
        let thought = target;
        // Check the existing state before creating a note; a corrupt thought must not orphan new content.
        if (thought) {
          const file = this.app.vault.getAbstractFileByPath(thought);
          if (!(file instanceof TFile) || !parseThoughtState(await this.app.vault.read(file))) throw new Error("思考状态缺失或损坏，请先修复 brainos-state");
        } else thought = (await createThought(this.app, label, this.plugin.layout.settings.noteFolder)).path;
        const atom = await createAtom(this.app, label, body.value, this.plugin.layout.settings.noteFolder);
        try {
          await editThought(this.app, thought, state => addRoute(state, parent ? [parent, atom.path] : [atom.path], label));
        } catch (error) {
          new Notice(`新笔记已保留在 ${atom.path}，但未加入思考`); throw error;
        }
        this.plugin.layout.positions[atom.path] = point;
        await this.plugin.saveLayout();
        this.thoughtPath = thought; this.selected = atom.path;
        this.closeEditor(); await this.refresh(); this.plugin.refreshViews();
      }).finally(() => { save.disabled = false; });
    };
    title.focus();
  }

  private async beginEdit(node: GraphNode) {
    if (this.busy) return;
    const file = this.app.vault.getAbstractFileByPath(node.openPath);
    if (!(file instanceof TFile)) { new Notice("节点没有对应的 Markdown 笔记"); return; }
    await this.runEdit(async () => {
      const original = await this.app.vault.read(file);
      if (this.closed) return;
      this.closeEditor();
      const form = this.openEditor(node, `编辑：${node.label}`);
      const body = form.createEl("textarea", { cls: "brainos-node-editor-document", attr: { "aria-label": "笔记 Markdown" } }); body.value = original;
      const controls = form.createDiv({ cls: "brainos-node-editor-actions" });
      const cancel = controls.createEl("button", { text: "取消", attr: { type: "button" } }); cancel.onclick = () => this.closeEditor();
      const save = controls.createEl("button", { text: "保存", cls: "mod-cta", attr: { type: "submit" } });
      form.onsubmit = event => {
        event.preventDefault(); if (this.busy) return; save.disabled = true;
        void this.runEdit(async () => {
          await this.app.vault.process(file, current => {
            if (current !== original) throw new Error("笔记已在其他位置修改。请取消并重新打开编辑，避免覆盖内容");
            return body.value;
          });
          this.closeEditor(); await this.refresh(); this.plugin.refreshViews();
        }).finally(() => { save.disabled = false; });
      };
      body.focus();
    });
  }

  private openEditor(point: Point, heading: string): HTMLFormElement {
    const form = this.contentEl.createEl("form", { cls: "brainos-node-editor" }); this.editor = form;
    form.createEl("strong", { text: heading });
    const screen = this.worldToScreen(point);
    form.style.left = `${Math.max(8, Math.min(this.contentEl.clientWidth - 348, screen.x - 160))}px`;
    form.style.top = `${Math.max(60, Math.min(this.contentEl.clientHeight - 340, screen.y + 65))}px`;
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

  private async connect(from: GraphNode, to: GraphNode) {
    const thought = this.editingThought(from); if (!thought) return;
    if (this.edges.some(edge => edge.from === from.path && edge.to === to.path && edge.thoughts.includes(thought))) return;
    await this.runEdit(async () => {
      await editThought(this.app, thought, state => addRoute(state, [from.path, to.path], `${from.label} → ${to.label}`));
      await this.refresh(); this.plugin.refreshViews();
    });
  }

  private removeNode(node: GraphNode) {
    if (node.placeholder) { new Notice("这是空思考的入口；可以延伸新节点或打开思考文件"); return; }
    const thought = this.editingThought(node); if (!thought) return;
    new RemoveNodeModal(this.app, node.label, () => this.runEdit(async () => {
      await editThought(this.app, thought, state => splitRoutes(state, node.path));
      this.selected = undefined; await this.refresh(); this.plugin.refreshViews();
    })).open();
  }

  private onContextMenu(event: MouseEvent) {
    event.preventDefault(); if (this.editor || this.busy) return;
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const node = this.nodeAt(x, y), menu = new Menu();
    if (node) {
      this.selected = node.path; this.draw();
      menu.addItem(item => item.setTitle("编辑笔记").setIcon("pencil").onClick(() => void this.beginEdit(node)));
      menu.addItem(item => item.setTitle("打开笔记").setIcon("file-text").onClick(() => void this.app.workspace.openLinkText(node.openPath, "", false)));
      menu.addItem(item => item.setTitle("延伸节点（Tab）").setIcon("git-branch").onClick(() => void this.createRelative(true)));
      menu.addItem(item => item.setTitle("从当前思考移除…").setIcon("unlink").onClick(() => this.removeNode(node)));
    } else {
      menu.addItem(item => item.setTitle("在这里新建节点").setIcon("plus").onClick(() => void this.beginCreate(this.screenToWorld(x, y))));
      const byPath = new Map(this.nodes.map(item => [item.path, item]));
      const edge = this.edges.find(item => {
        const a = byPath.get(item.from), b = byPath.get(item.to); if (!a || !b) return false;
        const p = this.worldToScreen(a), q = this.worldToScreen(b), dx = q.x - p.x, dy = q.y - p.y;
        const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(x - p.x - t * dx, y - p.y - t * dy) < 7;
      });
      if (edge) menu.addItem(item => item.setTitle("断开此连线").setIcon("unlink").onClick(() => {
        const thought = this.thoughtPath || (edge.thoughts.length === 1 ? edge.thoughts[0] : undefined);
        if (!thought) { new Notice("连线属于多个思考，请先选择要修改的思考"); return; }
        void this.runEdit(async () => { await editThought(this.app, thought, state => splitRoutes(state, undefined, edge)); await this.refresh(); this.plugin.refreshViews(); });
      }));
    }
    menu.showAtMouseEvent(event);
  }
}

class RemoveNodeModal extends Modal {
  constructor(app: BrainOSPlugin["app"], private label: string, private remove: () => Promise<void>) { super(app); }
  onOpen() {
    this.titleEl.setText(`移除「${this.label}」？`);
    this.contentEl.createEl("p", { text: "仅移除当前思考中的节点引用及相邻连线。原 Markdown 笔记及其他思考不变；不会自动连接前后节点。" });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText("取消").onClick(() => this.close()))
      .addButton(button => button.setButtonText("移除引用").setWarning().onClick(() => { this.close(); void this.remove(); }));
  }
  onClose() { this.contentEl.empty(); }
}
