/** Delegate events from Obsidian's native file explorer, including virtualized rows. */
export class ThoughtExplorer {
  private hoveredPath?: string;
  constructor(private callbacks: {
    accepts: (path: string) => boolean;
    preview: (path?: string) => void;
    select: (path: string) => boolean;
  }) {}

  private path(target: EventTarget | null): string | undefined {
    const element = target as Element | null;
    const row = element?.closest?.(".nav-file-title[data-path], .nav-file[data-path]");
    if (!row?.closest(".workspace-leaf-content[data-type='file-explorer']")) return;
    const path = row.getAttribute("data-path");
    return path && this.callbacks.accepts(path) ? path : undefined;
  }

  over(event: MouseEvent) {
    const path = this.path(event.target);
    if (!path || path === this.hoveredPath) return;
    this.hoveredPath = path;
    this.callbacks.preview(path);
  }

  out(event: MouseEvent) {
    const path = this.path(event.relatedTarget);
    if (path === this.hoveredPath) return;
    this.hoveredPath = path;
    this.callbacks.preview(path);
  }

  click(event: MouseEvent) {
    // Preserve native modified-click, multi-selection and new-tab actions.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const path = this.path(event.target);
    if (!path || !this.callbacks.select(path)) return;
    event.preventDefault(); event.stopPropagation();
  }
}
