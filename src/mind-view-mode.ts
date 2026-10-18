import type { WorkspaceLeaf } from "obsidian";

export const VIEW_TYPE = "brainos-graph-view";

/** Keep each leaf's native Markdown mode, selection and scroll while in mind view. */
export class MindViewMode {
  private markdown = new WeakMap<WorkspaceLeaf, { file: string; state: Record<string, unknown>; ephemeral: Record<string, unknown> }>();
  private switching = new WeakSet<WorkspaceLeaf>();

  async showMind(leaf: WorkspaceLeaf, file: string) {
    if (this.switching.has(leaf)) return;
    this.switching.add(leaf);
    try {
      if (leaf.view.getViewType() === "markdown") {
        const state = leaf.view.getState();
        if (state.file === file) this.markdown.set(leaf, { file, state: { ...state }, ephemeral: leaf.view.getEphemeralState() });
      }
      await leaf.setViewState({ type: VIEW_TYPE, state: { file }, active: true });
    } finally { this.switching.delete(leaf); }
  }

  async showMarkdown(leaf: WorkspaceLeaf, file: string) {
    if (this.switching.has(leaf)) return;
    this.switching.add(leaf);
    try {
      const saved = this.markdown.get(leaf);
      const sameFile = saved?.file === file;
      await leaf.setViewState({ type: "markdown", state: sameFile ? { ...saved.state, file } : { file, mode: "source" }, active: true });
      if (sameFile) leaf.view.setEphemeralState(saved.ephemeral);
    } finally { this.switching.delete(leaf); }
  }
}
