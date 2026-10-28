import { App, Component, MarkdownRenderer, Menu, Notice, TFile } from "obsidian";
import {
  DocumentOccurrence, NodeEditSnapshot, ThoughtDocument, appendDocumentContinuation, appendDocumentStep, nodeRevision,
  nodeKey, occurrenceTitle, parseThoughtDocument, removeDocumentNode,
} from "./thought-document";
import { buildThoughtLanes, navigateThoughtLanes, projectThoughtNodes } from "./thought-lanes";
import { graphHistory, processGraphFile } from "./graph-history";
import { editThoughtNode, loadThoughtDocument } from "./thought-store";

type LaneDraft = { visit?: DocumentOccurrence; parent?: DocumentOccurrence; branch: boolean; value: string;
  expected?: NodeEditSnapshot; index: number; previousSelection: number };
type Actions = { raw: (line: number) => void; changed: () => void };

/** Scrollable reading surface. SVG owns only tracks; native DOM owns all text and editing. */
export class ThoughtLaneView extends Component {
  private file?: TFile;
  private doc?: ThoughtDocument;
  private markdown = "";
  private selected = -1;
  private revision = 0;
  private bodyComponent?: Component;
  private observer?: ResizeObserver;
  private frame?: number;
  private busy = false;
  private draft?: LaneDraft;
  private scrollByFile = new Map<string, { top: number; selected: number }>();
  constructor(private app: App, readonly container: HTMLElement, private actions: Actions) { super(); }

  onload() {
    this.registerDomEvent(this.container, "keydown", event => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || event.isComposing || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, [contenteditable=true]")) return;
      event.preventDefault(); event.stopPropagation();
      const history = graphHistory(this.app);
      void (event.shiftKey ? history.redo() : history.undo()).then(async changed => {
        if (changed && this.file) { this.actions.changed(); await this.show(this.file); }
      }).catch(error => new Notice(error instanceof Error ? error.message : String(error)));
    });
  }

  async show(file: TFile) {
    const revision = ++this.revision;
    const loaded = await loadThoughtDocument(this.app, file);
    if (revision !== this.revision) return;
    const changedFile = this.file?.path !== file.path;
    if (changedFile) {
      if (this.file) this.scrollByFile.set(this.file.path, { top: this.container.scrollTop, selected: this.selected });
      this.selected = this.scrollByFile.get(file.path)?.selected ?? -1;
      this.draft = undefined;
      this.container.scrollTop = this.scrollByFile.get(file.path)?.top ?? 0;
    }
    this.file = file; this.markdown = loaded.markdown; this.doc = loaded.doc;
    if (this.draft && !changedFile) return;
    if (this.selected >= this.doc.occurrences.length) this.selected = -1;
    await this.render();
    if (changedFile && this.container.closest(".workspace-leaf.mod-active")) this.focusSelected();
  }

  raw() {
    const visit = this.doc?.occurrences[this.selected];
    this.actions.raw(visit ? this.markdown.slice(0, visit.start).split("\n").length - 1 : 0);
  }

  state() { return { selected: this.selected, scrollTop: this.container.scrollTop }; }
  restore(state: Record<string, unknown>) {
    if (typeof state.selected === "number" && Number.isInteger(state.selected) && state.selected >= -1 && state.selected < (this.doc?.occurrences.length ?? 0)) this.selected = state.selected;
    void this.render().then(() => { if (typeof state.scrollTop === "number" && Number.isFinite(state.scrollTop)) this.container.scrollTop = state.scrollTop; });
  }

  private focusSelected() {
    this.container.querySelector<HTMLButtonElement>(`[data-visit="${Math.max(0, this.selected)}"]`)?.focus({ preventScroll: true });
  }

  private async render() {
    let doc = this.doc;
    const file = this.file, draft = this.draft;
    if (!doc || !file) return;
    if (draft && !draft.visit) {
      let placeholder = "新想法";
      while (doc.nodes.some(node => node.title === placeholder)) placeholder += "·";
      const from = draft.parent && occurrenceTitle(draft.parent);
      const preview = draft.branch && from ? appendDocumentStep(appendDocumentStep(this.markdown, from, "", true), placeholder)
        : appendDocumentContinuation(this.markdown, from, placeholder);
      doc = parseThoughtDocument(preview); draft.index = doc.occurrences.length - 1;
      this.selected = draft.index;
    }
    const projection = projectThoughtNodes(doc, this.selected);
    doc = projection.doc;
    const selectedRow = projection.sourceIndices.indexOf(this.selected);
    const revision = ++this.revision;
    this.observer?.disconnect();
    if (this.bodyComponent) this.removeChild(this.bodyComponent);
    const component = this.addChild(new Component()); this.bodyComponent = component;
    const top = this.container.scrollTop;
    this.container.empty();
    const heading = this.container.createDiv({ cls: "brainos-lanes-heading" });
    heading.createEl("h2", { text: file.basename });
    heading.createDiv({ cls: "brainos-lanes-caption", text: `${this.doc!.nodes.length} 个节点 · ${this.doc!.occurrences.length} 次记录 · 自上而下阅读` });
    const add = heading.createEl("button", { text: "新想法", cls: "brainos-lanes-add" });
    add.onclick = () => this.edit();

    if (!doc.occurrences.length) {
      this.container.createDiv({ cls: "brainos-lanes-empty", text: "从一个想法开始。创建节点后，可以继续延伸或另开分支。" }); return;
    }
    const layout = buildThoughtLanes(doc);
    const trackWidth = Math.max(104, Math.min(156, 48 + layout.laneCount * 24));
    const reading = this.container.createDiv({ cls: "brainos-lanes-reading" });
    reading.style.setProperty("--brainos-track-width", trackWidth + "px");
    const svg = this.container.doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.addClass("brainos-lanes-tracks"); svg.setAttribute("aria-hidden", "true"); reading.appendChild(svg);
    const anchors: HTMLElement[] = [];
    const jump = (rowIndex: number) => {
      if (this.draft) return;
      const index = projection.sourceIndices[rowIndex];
      this.selected = index;
      void this.render().then(() => {
        const button = this.container.querySelector<HTMLButtonElement>(`[data-visit="${index}"]`);
        button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: "nearest" });
      });
    };
    for (const [rowIndex, visit] of doc.occurrences.entries()) {
      const index = projection.sourceIndices[rowIndex];
      const row = reading.createEl("article", { cls: "brainos-lanes-row" });
      row.toggleClass("is-selected", index === this.selected);
      const button = row.createEl("button", { cls: "brainos-lanes-node", text: visit.title,
        attr: { "data-visit": String(index), "aria-expanded": String(index === this.selected) } });
      if (draft?.index === index) {
        button.hidden = true;
        anchors.push(this.renderInput(row, draft));
      } else anchors.push(button);
      button.onclick = () => { if (this.draft) return; this.selected = this.selected === index ? -1 : index; void this.render().then(() => this.container.querySelector<HTMLButtonElement>(`[data-visit="${index}"]`)?.focus({ preventScroll: true })); };
      button.onkeydown = event => {
        if (this.draft || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault(); event.stopPropagation();
          jump(navigateThoughtLanes(layout, rowIndex, event.key));
        } else if (["Tab", "Enter", " ", "F2"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); if (event.repeat) return;
          this.selected = index;
          if (event.key === "Tab") this.edit(undefined, visit);
          else if (event.key === "Enter") {
            const incoming = layout.edges.filter(e => e.to === rowIndex), parent = incoming[incoming.length - 1];
            this.edit(undefined, parent ? doc.occurrences[parent.from] : undefined, true);
          } else if (visit.target) this.raw(); else this.edit(visit);
        } else if (event.key === "Escape") { event.preventDefault(); this.selected = -1; void this.render().then(() => this.container.querySelector<HTMLButtonElement>(`[data-visit="${index}"]`)?.focus()); }
      };
      button.oncontextmenu = event => {
        event.preventDefault(); if (this.draft) return;
        this.selected = index;
        const menu = new Menu();
        menu.addItem(item => item.setTitle("继续思考 · Tab").onClick(() => this.edit(undefined, visit)));
        menu.addItem(item => item.setTitle("从这里另开分支").onClick(() => this.edit(undefined, visit, true)));
        menu.addItem(item => item.setTitle("编辑标题 · Space").onClick(() => visit.target ? this.raw() : this.edit(visit)));
        menu.addItem(item => item.setTitle("查看 Raw").onClick(() => this.raw()));
        menu.addItem(item => item.setTitle("删除节点").onClick(() => { void this.change(text => removeDocumentNode(text, visit.id)); }));
        menu.showAtMouseEvent(event);
      };
      if (draft?.index === index && !draft.visit) continue;
      const meta = row.createDiv({ cls: "brainos-lanes-meta" });
      const previous = layout.rows[rowIndex].revisit;
      if (previous !== undefined) {
        const back = meta.createEl("button", { text: "↩ 再次经过 · 查看首次记录", cls: "brainos-lanes-link" }); back.onclick = () => jump(previous);
      } else {
        const incoming = layout.edges.filter(edge => edge.to === rowIndex).length;
        meta.setText(incoming > 1 ? `汇合 · ${incoming} 条路径` : index === 0 ? "起点" : "");
      }
      for (const target of layout.rows[rowIndex].returns) {
        const back = meta.createEl("button", { text: "↩ 回到「" + doc.occurrences[target].title + "」", cls: "brainos-lanes-link" }); back.onclick = () => jump(target);
      }
      for (const target of layout.rows[rowIndex].missing) meta.createSpan({ text: "→ " + target + "（尚无本地记录）" });
      if (this.selected !== index) continue;
      const details = row.createDiv({ cls: "brainos-lanes-details" });
      const records = this.doc?.nodes.find(node => node.id === visit.id)?.occurrences ?? [visit];
      for (const record of records.filter(record => record.body)) {
        const body = details.createDiv({ cls: "brainos-lanes-body" });
        if (records.filter(record => record.body).length > 1) body.createDiv({ cls: "brainos-lanes-caption", text: `记录 ${record.ordinal + 1}` });
        await MarkdownRenderer.render(this.app, record.body, body.createDiv({ cls: "markdown-rendered" }), file.path, component);
        if (revision !== this.revision) return;
      }
      const connections = details.createDiv({ cls: "brainos-lanes-connections" });
      for (const edge of layout.edges.filter(e => e.from === rowIndex)) {
        const link = connections.createEl("button", { cls: "brainos-lanes-link", text: "→ " + doc.occurrences[edge.to].title }); link.onclick = () => jump(edge.to);
      }
    }
    const draw = () => {
      if (!this.container.isShown()) return;
      const rect = reading.getBoundingClientRect();
      const points = anchors.map((b, i) => ({ x: 24 + layout.rows[i].lane * (layout.laneCount > 5 ? 100 / (layout.laneCount - 1) : 24), y: b.getBoundingClientRect().top - rect.top + b.offsetHeight / 2 }));
      svg.replaceChildren(); svg.setAttribute("viewBox", `0 0 ${trackWidth} ${reading.offsetHeight}`);
      svg.setAttribute("width", String(trackWidth)); svg.setAttribute("height", String(reading.offsetHeight));
      const make = (tag: string, attrs: Record<string, string>) => {
        const el = this.container.doc.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
        svg.appendChild(el); return el;
      };
      for (const edge of layout.edges) {
        const a = points[edge.from], b = points[edge.to], x = 24 + edge.lane * (layout.laneCount > 5 ? 100 / (layout.laneCount - 1) : 24);
        const bend = Math.min(16, (b.y - a.y) / 4);
        make("path", { d: `M ${a.x} ${a.y} C ${a.x} ${a.y + bend}, ${x} ${a.y + bend}, ${x} ${a.y + bend * 2} L ${x} ${b.y - bend * 2} C ${x} ${b.y - bend}, ${b.x} ${b.y - bend}, ${b.x} ${b.y}`,
          class: edge.from === selectedRow || edge.to === selectedRow ? "is-active" : "" });
      }
      points.forEach((p, i) => { make("circle", { cx: String(p.x), cy: String(p.y), r: i === selectedRow ? "5" : "4", class: i === selectedRow ? "is-active" : "" }); });
    };
    this.observer = new ResizeObserver(draw); this.observer.observe(reading);
    if (this.frame !== undefined) this.container.win.cancelAnimationFrame(this.frame);
    this.frame = this.container.win.requestAnimationFrame(draw);
    this.container.scrollTop = top;
  }

  private edit(visit?: DocumentOccurrence, parent?: DocumentOccurrence, branch = false) {
    if (!this.doc || this.busy) return;
    if (this.draft) { this.container.querySelector<HTMLInputElement>(".brainos-lanes-title-input")?.focus(); return; }
    const node = visit && this.doc.nodes.find(n => n.id === visit.id);
    const expected = visit && node ? { title: node.title, body: visit.body, ordinal: visit.ordinal, revision: nodeRevision(node) } : undefined;
    const previousSelection = this.selected;
    this.draft = { visit, parent, branch, value: visit?.title ?? "", expected, index: visit ? this.doc.occurrences.indexOf(visit) : -1, previousSelection };
    if (visit) this.selected = this.draft.index;
    void this.render().then(() => {
      const input = this.container.querySelector<HTMLInputElement>(".brainos-lanes-title-input");
      input?.focus(); input?.select(); input?.scrollIntoView({ block: "nearest" });
    }).catch(error => { this.draft = undefined; new Notice(error instanceof Error ? error.message : String(error)); });
  }

  private renderInput(row: HTMLElement, draft: LaneDraft) {
    const input = row.createEl("input", { cls: "brainos-lanes-title-input", type: "text", value: draft.value,
      attr: { "aria-label": draft.visit ? "编辑节点名称" : "新节点名称", placeholder: "输入节点名称…", autocomplete: "off" } });
    row.createDiv({ cls: "brainos-lanes-input-hint", text: "Enter 确认 · Tab 确认并继续 · Esc 取消" });
    let composing = false;
    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("compositionend", () => { composing = false; draft.value = input.value; });
    input.oninput = () => { draft.value = input.value; };
    input.onkeydown = event => {
      event.stopPropagation();
      if (composing || event.isComposing || event.keyCode === 229 || event.repeat) return;
      if (event.key === "Escape") {
        event.preventDefault(); this.selected = draft.previousSelection; this.draft = undefined;
        void this.render().then(() => this.focusSelected());
      } else if (event.key === "Enter" || event.key === "Tab" && !event.shiftKey) {
        event.preventDefault(); draft.value = input.value;
        if (input.value.trim()) void this.saveDraft(event.key === "Tab");
      }
    };
    return input;
  }

  private async saveDraft(continueEditing: boolean) {
    const draft = this.draft, file = this.file;
    if (!draft || !file || this.busy) return;
    const input = this.container.querySelector<HTMLInputElement>(".brainos-lanes-title-input");
    this.busy = true; if (input) input.disabled = true;
    let saved = false;
    try {
      await graphHistory(this.app).record(async () => {
        if (draft.visit) await editThoughtNode(this.app, nodeKey(file.path, draft.visit.id), draft.value, undefined, draft.expected);
        else await processGraphFile(this.app, file, text => {
          if (draft.parent && !parseThoughtDocument(text).nodes.some(n => n.id === draft.parent!.id)) throw new Error("起点已不存在，请刷新后重试");
          const from = draft.parent && occurrenceTitle(draft.parent);
          const next = draft.branch && from ? appendDocumentStep(appendDocumentStep(text, from, "", true), draft.value)
            : appendDocumentContinuation(text, from, draft.value);
          this.selected = parseThoughtDocument(next).occurrences.length - 1;
          return next;
        });
      });
      this.draft = undefined; await this.show(file); this.actions.changed(); saved = true;
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
      if (input) { input.disabled = false; input.focus(); }
    } finally { this.busy = false; }
    if (saved) {
      const visit = this.doc?.occurrences[this.selected];
      if (continueEditing && visit) this.edit(undefined, visit);
      else { this.focusSelected(); this.container.querySelector(`[data-visit="${this.selected}"]`)?.scrollIntoView({ block: "nearest" }); }
    }
  }

  private async change(edit: (text: string) => string, propagate = false) {
    if (!this.file || this.busy) return;
    this.busy = true;
    try {
      const file = this.file;
      await graphHistory(this.app).record(() => processGraphFile(this.app, file, text => {
        const next = edit(text);
        if (propagate) this.selected = parseThoughtDocument(next).occurrences.length - 1;
        return next;
      }));
      this.actions.changed(); await this.show(file);
    }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error)); if (propagate) throw error; }
    finally { this.busy = false; }
  }

  onunload() { this.revision++; this.observer?.disconnect(); if (this.frame !== undefined) this.container.win.cancelAnimationFrame(this.frame); }
}
