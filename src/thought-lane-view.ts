import { App, Component, MarkdownRenderer, Menu, Notice, TFile } from "obsidian";
import {
  DocumentOccurrence, NodeEditSnapshot, ThoughtDocument, appendDocumentContinuation, appendDocumentStep,
  nodeKey, occurrenceTitle, parseThoughtDocument, removeDocumentNode, wikiLink,
} from "./thought-document";
import { buildThoughtLanes, navigateThoughtLanes, projectThoughtNodes, thoughtLaneParent } from "./thought-lanes";
import { graphHistory, processGraphFile } from "./graph-history";
import { editThoughtNode, loadThoughtDocument, readThoughtNode, readThoughtOccurrence } from "./thought-store";
import { NodeTitleCandidate, NodeTitleSuggest } from "./node-title-suggest";
import type { GraphNode } from "./thoughts";

type LaneDraft = { visit?: DocumentOccurrence; parent?: DocumentOccurrence; branch: boolean; value: string;
  body?: string; editKey?: string; expected?: NodeEditSnapshot; index: number; previousSelection: number; candidate?: NodeTitleCandidate };
type Actions = { raw: (line: number) => void; changed: () => void; loadNodes: () => Promise<GraphNode[]> };
let nextLaneViewID = 0;

/** Scrollable reading surface. SVG owns only tracks; native DOM owns all text and editing. */
export class ThoughtLaneView extends Component {
  private readonly viewID = ++nextLaneViewID;
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
  private titleSuggest?: NodeTitleSuggest;
  private scrollByFile = new Map<string, { top: number; selected: number }>();
  constructor(private app: App, readonly container: HTMLElement, private actions: Actions) { super(); }

  onload() {
    this.container.tabIndex = -1;
    this.registerDomEvent(this.container, "keydown", event => {
      if (event.target !== this.container || this.draft || this.busy || event.isComposing || event.repeat
        || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault(); event.stopPropagation(); this.edit();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); this.focusSelected();
      }
    });
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
    (this.container.querySelector<HTMLButtonElement>(`[data-visit="${Math.max(0, this.selected)}"]`) ?? this.container).focus({ preventScroll: true });
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
    this.titleSuggest?.dispose(); this.titleSuggest = undefined;
    this.observer?.disconnect();
    if (this.bodyComponent) this.removeChild(this.bodyComponent);
    const component = this.addChild(new Component()); this.bodyComponent = component;
    const top = this.container.scrollTop;
    const hadFocus = this.container.contains(this.container.doc.activeElement);
    this.container.empty();
    const heading = this.container.createDiv({ cls: "brainos-lanes-heading" });
    heading.createEl("h2", { text: file.basename });
    heading.createDiv({ cls: "brainos-lanes-caption", text: `${this.doc!.nodes.length} 个节点 · ${this.doc!.occurrences.length} 次记录 · 自上而下阅读` });
    if (!this.doc!.occurrences.length) {
      const add = heading.createEl("button", { text: "新想法", cls: "brainos-lanes-add" });
      add.onclick = () => { void this.edit(); };
    }

    if (!doc.occurrences.length) {
      this.container.createDiv({ cls: "brainos-lanes-empty", text: "从一个想法开始。创建节点后，可以继续延伸或另开分支。" }); return;
    }
    const layout = buildThoughtLanes(doc);
    const trackWidth = Math.max(72, Math.min(156, 48 + layout.laneCount * 24));
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
      row.toggleClass("is-editing", draft?.index === index);
      row.toggleClass("is-reference", !!visit.target);
      const button = row.createEl("button", { cls: "brainos-lanes-node", text: visit.title,
        attr: { "data-visit": String(index), "aria-label": visit.title, "aria-expanded": String(index === this.selected) } });
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
        } else if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault(); event.stopPropagation();
          if (!event.repeat && this.selected === index) void this.deleteNode(visit.id);
        } else if (["Tab", "Enter", " ", "F2"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); if (event.repeat) return;
          this.selected = index;
          if (event.key === "Tab") this.edit(undefined, visit);
          else if (event.key === "Enter") {
            this.edit(undefined, thoughtLaneParent(this.doc!, index), true);
          } else void this.edit(visit);
        } else if (event.key === "Escape") { event.preventDefault(); this.selected = -1; void this.render().then(() => this.container.querySelector<HTMLButtonElement>(`[data-visit="${index}"]`)?.focus()); }
      };
      button.oncontextmenu = event => {
        event.preventDefault(); if (this.draft) return;
        this.selected = index;
        const menu = new Menu();
        menu.addItem(item => item.setTitle("继续思考 · Tab").onClick(() => this.edit(undefined, visit)));
        menu.addItem(item => item.setTitle("从这里另开分支").onClick(() => this.edit(undefined, visit, true)));
        menu.addItem(item => item.setTitle(visit.target ? "编辑来源节点 · Space" : "编辑节点 · Space").onClick(() => { void this.edit(visit); }));
        menu.addItem(item => item.setTitle("查看 Raw").onClick(() => this.raw()));
        menu.addItem(item => item.setTitle(visit.target ? "移除当前引用 · Backspace / Delete" : "删除节点 · Backspace / Delete").onClick(() => { void this.deleteNode(visit.id); }));
        menu.showAtMouseEvent(event);
      };
      if (draft?.index === index) continue;
      const meta = row.createDiv({ cls: "brainos-lanes-meta" });
      if (visit.target) meta.createSpan({ cls: "brainos-lanes-origin", text: "↗ 引用 · " + (visit.target.split("#")[0] || file.path).replace(/\.md$/, "") });
      const previous = layout.rows[rowIndex].revisit;
      if (previous !== undefined) {
        const back = meta.createEl("button", { text: "↩ 再次经过 · 查看首次记录", cls: "brainos-lanes-link" }); back.onclick = () => jump(previous);
      } else {
        const incoming = layout.edges.filter(edge => edge.to === rowIndex).length;
        meta.createSpan({ text: incoming > 1 ? `汇合 · ${incoming} 条路径` : incoming === 0 ? "起点" : "" });
      }
      for (const target of layout.rows[rowIndex].returns) {
        const back = meta.createEl("button", { text: "↩ 回到「" + doc.occurrences[target].title + "」", cls: "brainos-lanes-link" }); back.onclick = () => jump(target);
      }
      for (const target of layout.rows[rowIndex].missing) meta.createSpan({ text: "→ " + target + "（尚无本地记录）" });
      if (this.selected !== index) continue;
      const details = row.createDiv({ cls: "brainos-lanes-details" });
      details.id = `brainos-lane-${this.viewID}-details-${index}`;
      button.setAttribute("aria-controls", details.id);
      const localRecords = this.doc?.nodes.find(node => node.id === visit.id)?.occurrences ?? [visit];
      let records = localRecords;
      let sourcePath = file.path;
      if (visit.target) {
        const source = details.createDiv({ cls: "brainos-lanes-source" });
        try {
          const resolved = await readThoughtOccurrence(this.app, file.path, visit);
          if (revision !== this.revision) return;
          records = resolved.occurrences; sourcePath = resolved.file.path;
          source.createDiv({ cls: "brainos-lanes-caption", text: "来源 · " + sourcePath + " · 编辑将同步修改来源" });
          const open = source.createEl("button", { cls: "brainos-lanes-link", text: "↗ 打开来源思考",
            attr: { "aria-label": "打开来源思考：" + sourcePath } });
          open.onclick = () => { void this.app.workspace.openLinkText(sourcePath, file.path, true).catch(error => new Notice(String(error))); };
          if (!records.some(record => record.body)) source.createDiv({ cls: "brainos-lanes-caption", text: "来源想法暂无正文" });
        } catch {
          if (revision !== this.revision) return;
          records = [];
          source.createDiv({ cls: "brainos-lanes-reference-error", text: "无法读取来源想法。引用仍保留，可检查来源文件或在 Raw 中修正链接。" });
        }
      }
      const renderRecords = async (entries: DocumentOccurrence[], owner: string, annotation = false) => {
        const bodies = entries.filter(record => record.body);
        for (const record of bodies) {
          const body = details.createDiv({ cls: "brainos-lanes-body" });
          if (annotation || bodies.length > 1) body.createDiv({ cls: "brainos-lanes-caption",
            text: annotation ? "当前思考的补充" : `记录 ${record.ordinal + 1}` });
          await MarkdownRenderer.render(this.app, record.body, body.createDiv({ cls: "markdown-rendered" }), owner, component);
          if (revision !== this.revision) return;
        }
      };
      await renderRecords(records, sourcePath);
      if (revision !== this.revision) return;
      if (visit.target) await renderRecords(localRecords, file.path, true);
      if (revision !== this.revision) return;
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
    if (hadFocus && !draft) this.focusSelected();
  }

  private async edit(visit?: DocumentOccurrence, parent?: DocumentOccurrence, branch = false) {
    if (!this.doc || this.busy) return;
    if (this.draft) { this.container.querySelector<HTMLInputElement>(".brainos-lanes-title-input")?.focus(); return; }
    const file = this.file;
    if (!file) return;
    let loaded: Awaited<ReturnType<typeof readThoughtOccurrence>> | undefined;
    if (visit) {
      this.busy = true;
      try { loaded = await readThoughtOccurrence(this.app, file.path, visit); }
      catch (error) { new Notice(error instanceof Error ? error.message : String(error)); return; }
      finally { this.busy = false; }
      if (this.file !== file) return;
    }
    const node = loaded?.node;
    const expected = node ? { title: node.title, body: node.body, ordinal: node.ordinal, revision: node.revision } : undefined;
    const previousSelection = this.selected;
    this.draft = { visit, parent, branch, value: node?.title ?? "", body: node?.body, editKey: loaded?.key,
      expected, index: visit ? this.doc.occurrences.indexOf(visit) : -1, previousSelection };
    if (visit) this.selected = this.draft.index;
    void this.render().then(() => {
      const input = this.container.querySelector<HTMLInputElement>(".brainos-lanes-title-input");
      input?.focus(); input?.select(); input?.scrollIntoView({ block: "nearest" });
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    }).catch(error => { this.draft = undefined; new Notice(error instanceof Error ? error.message : String(error)); });
  }

  private renderInput(row: HTMLElement, draft: LaneDraft) {
    const input = row.createEl("input", { cls: "brainos-lanes-title-input", type: "text", value: draft.value,
      attr: { "aria-label": draft.visit ? "编辑节点名称" : "新节点名称", placeholder: "输入节点名称…", autocomplete: "off" } });
    if (draft.visit?.target) row.createDiv({ cls: "brainos-lanes-input-hint", text: "正在编辑来源想法，修改会同步到所有引用。" });
    const cancelDraft = () => {
      if (this.busy) return;
      this.selected = draft.previousSelection; this.draft = undefined;
      void this.render().then(() => this.focusSelected());
    };
    const body = draft.visit ? row.createEl("textarea", { cls: "brainos-lanes-body-input", value: draft.body ?? "",
      attr: { "aria-label": "编辑节点正文", placeholder: "补充想法…", rows: "3" } }) : undefined;
    if (body) {
      body.oninput = () => { draft.body = body.value; };
      body.onkeydown = event => {
        event.stopPropagation();
        if (event.isComposing || event.keyCode === 229 || event.repeat) return;
        if (event.key === "Escape") { event.preventDefault(); cancelDraft(); }
        else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault(); if (draft.value.trim()) void this.saveDraft(false);
        } else if (event.key === "Tab" && !event.shiftKey) {
          event.preventDefault(); if (draft.value.trim()) void this.saveDraft(true);
        } else if (event.key === "ArrowUp" && body.selectionStart === 0 && body.selectionEnd === 0) {
          event.preventDefault(); input.focus();
        }
      };
    }
    let composing = false;
    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("compositionend", () => { composing = false; draft.value = input.value; });
    if (!draft.visit?.target) this.titleSuggest = new NodeTitleSuggest(this.app, input, this.file!.path,
      async () => (await this.actions.loadNodes()).filter(node => node.kind !== "unresolved"),
      candidate => {
        if (this.draft !== draft || this.busy) return;
        draft.candidate = candidate; draft.value = candidate.node.label;
        void this.saveDraft(false);
      }, () => composing, false, draft.visit ? nodeKey(this.file!.path, draft.visit.id) : undefined);
    input.oninput = () => { draft.value = input.value; draft.candidate = undefined; };
    input.onkeydown = event => {
      if (event.defaultPrevented) return;
      if (this.titleSuggest?.isShowing && ["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(event.key)) return;
      event.stopPropagation();
      if (composing || event.isComposing || event.keyCode === 229 || event.repeat) return;
      if (event.key === "ArrowDown" && body) {
        event.preventDefault(); body.focus();
      } else if (event.key === "Escape") {
        event.preventDefault(); cancelDraft();
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
    const candidate = draft.candidate;
    const input = this.container.querySelector<HTMLInputElement>(".brainos-lanes-title-input");
    this.busy = true; if (input) input.disabled = true;
    let saved = false;
    try {
      await graphHistory(this.app).record(async () => {
        if (candidate) await readThoughtNode(this.app, candidate.node.path);
        if (draft.visit) await editThoughtNode(this.app, draft.editKey ?? nodeKey(file.path, draft.visit.id), draft.value, draft.body, draft.expected, candidate?.kind === "reuse");
        else await processGraphFile(this.app, file, text => {
          if (draft.parent && !parseThoughtDocument(text).nodes.some(n => n.id === draft.parent!.id)) throw new Error("起点已不存在，请刷新后重试");
          const from = draft.parent && occurrenceTitle(draft.parent);
          const title = candidate?.kind === "reference" ? wikiLink(candidate.node.ownerPath!, candidate.node.label) : draft.value;
          const next = draft.branch && from ? appendDocumentStep(appendDocumentStep(text, from, "", true), title)
            : appendDocumentContinuation(text, from, title);
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

  private async deleteNode(id: string) {
    if (!this.doc || this.draft || this.busy) return;
    const row = projectThoughtNodes(this.doc, this.selected).doc.occurrences.findIndex(visit => visit.id === id);
    if (row < 0) return;
    if (await this.change(text => {
      const next = removeDocumentNode(text, id);
      const projected = projectThoughtNodes(parseThoughtDocument(next));
      this.selected = projected.sourceIndices[Math.min(row, projected.sourceIndices.length - 1)] ?? -1;
      return next;
    })) this.focusSelected();
  }

  private async change(edit: (text: string) => string) {
    if (!this.file || this.busy) return;
    this.busy = true;
    try {
      const file = this.file;
      await graphHistory(this.app).record(() => processGraphFile(this.app, file, text => {
        return edit(text);
      }));
      this.actions.changed(); await this.show(file);
      return true;
    }
    catch (error) { new Notice(error instanceof Error ? error.message : String(error)); return false; }
    finally { this.busy = false; }
  }

  onunload() { this.revision++; this.titleSuggest?.dispose(); this.observer?.disconnect(); if (this.frame !== undefined) this.container.win.cancelAnimationFrame(this.frame); }
}
