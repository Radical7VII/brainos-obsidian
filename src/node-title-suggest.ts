import { AbstractInputSuggest, App, prepareFuzzySearch } from "obsidian";
import { GraphNode } from "./thoughts";

export type NodeTitleCandidate = { kind: "create"; title: string } | { kind: "reuse" | "reference"; node: GraphNode };

/** Native input popover: keyboard navigation, mouse selection and theme styling. */
export class NodeTitleSuggest extends AbstractInputSuggest<NodeTitleCandidate> {
  private disposed = false;
  private showing = false;
  get isShowing() { return this.showing; }
  open() { if (!this.disposed) { this.showing = true; super.open(); } }
  close() { this.showing = false; super.close(); }
  private candidates?: Promise<GraphNode[]>;

  constructor(app: App, input: HTMLInputElement, private owner: string,
    private loadNodes: () => Promise<GraphNode[]>, private choose: (candidate: NodeTitleCandidate) => void,
    private isComposing: () => boolean, private insertion = false) {
    super(app, input);
    this.limit = 50;
  }

  async getSuggestions(query: string): Promise<NodeTitleCandidate[]> {
    if (this.disposed || this.isComposing()) return [];
    const title = query.trim();
    if (!title) return [];
    this.candidates ??= this.loadNodes().catch(() => { this.candidates = undefined; return []; });
    const nodes = await this.candidates;
    if (this.disposed || this.isComposing()) return [];
    const unique = [...new Map(nodes.filter(node => node.nodeId && node.ownerPath && !node.placeholder).map(node => [node.path, node])).values()];
    const search = prepareFuzzySearch(title);
    const matches = unique.map(node => ({ node, match: search(`${node.label} ${node.ownerPath}`) }))
      .filter(item => item.match).sort((a, b) => Number(b.node.ownerPath === this.owner) - Number(a.node.ownerPath === this.owner)
        || b.match!.score - a.match!.score).slice(0, 49);
    const options: NodeTitleCandidate[] = this.insertion ? [] : matches.map(({ node }) => ({ kind: node.ownerPath === this.owner ? "reuse" : "reference", node }));
    if (!unique.some(node => node.ownerPath === this.owner && node.label === title)) options.push({ kind: "create", title });
    return options;
  }

  renderSuggestion(candidate: NodeTitleCandidate, el: HTMLElement) {
    el.addClass("mod-complex");
    const content = el.createDiv({ cls: "suggestion-content" });
    content.createDiv({ cls: "suggestion-title", text: candidate.kind === "create" ? candidate.title : candidate.node.label });
    content.createDiv({ cls: "suggestion-note", text: candidate.kind === "create" ? "新建节点" : candidate.kind === "reuse" ? "复用当前思考中的节点" : `引用自 ${candidate.node.ownerPath}` });
  }

  selectSuggestion(candidate: NodeTitleCandidate, event: MouseEvent | KeyboardEvent) {
    if (this.disposed || this.isComposing() || (event as KeyboardEvent).isComposing) return;
    this.setValue(candidate.kind === "create" ? candidate.title : candidate.node.label);
    this.close();
    this.choose(candidate);
  }

  dispose() { this.disposed = true; this.close(); }
}
