import { AbstractInputSuggest, App, prepareFuzzySearch } from "obsidian";
import { GraphNode } from "./thoughts";

export type NodeTitleCandidate = { kind: "reuse" | "reference"; node: GraphNode };

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
    private isComposing: () => boolean, private insertion = false, private editingKey?: string) {
    super(app, input);
    this.limit = 50;
    // Some IMEs send their final input event before compositionend.
    // Refresh after composition state listeners have run, without requiring another keystroke.
    input.addEventListener("compositionend", () => queueMicrotask(() => {
      if (!this.disposed) input.dispatchEvent(new Event("input", { bubbles: true }));
    }));
  }

  async getSuggestions(query: string): Promise<NodeTitleCandidate[]> {
    if (this.disposed) return [];
    const title = query.trim();
    if (!title && !this.editingKey) return [];
    this.candidates ??= this.loadNodes().catch(() => { this.candidates = undefined; return []; });
    const nodes = await this.candidates;
    if (this.disposed) return [];
    const unique = [...new Map(nodes.filter(node => node.nodeId && node.ownerPath && !node.placeholder
      && (!this.editingKey || (node.ownerPath === this.owner && node.path !== this.editingKey))).map(node => [node.path, node])).values()];
    const search = prepareFuzzySearch(title);
    const matches = unique.map(node => ({ node, match: title ? search(node.label) : { score: 0 } }))
      .filter(item => item.match).sort((a, b) => Number(b.node.ownerPath === this.owner) - Number(a.node.ownerPath === this.owner)
        || b.match!.score - a.match!.score).slice(0, 49);
    const options: NodeTitleCandidate[] = this.insertion ? [] : matches.map(({ node }) => ({ kind: node.ownerPath === this.owner ? "reuse" : "reference", node }));
    return options;
  }

  renderSuggestion(candidate: NodeTitleCandidate, el: HTMLElement) {
    el.addClass("mod-complex");
    const content = el.createDiv({ cls: "suggestion-content" });
    content.createDiv({ cls: "suggestion-title", text: candidate.node.label });
    content.createDiv({ cls: "suggestion-note", text: candidate.node.ownerPath ?? "" });
  }

  selectSuggestion(candidate: NodeTitleCandidate, event: MouseEvent | KeyboardEvent) {
    if (this.disposed || this.isComposing() || (event as KeyboardEvent).isComposing) return;
    this.setValue(candidate.node.label);
    this.close();
    this.choose(candidate);
  }

  dispose() { this.disposed = true; this.close(); }
}
