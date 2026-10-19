import { AbstractInputSuggest, App } from "obsidian";

/** An editable path field with Obsidian's native folder suggestion popover. */
export class FolderSuggest extends AbstractInputSuggest<string> {
  private disposed = false;
  constructor(app: App, input: HTMLInputElement, private folders: () => string[],
    private choose: (path: string) => void | Promise<void>) {
    super(app, input);
  }

  getSuggestions(query: string) {
    if (this.disposed) return [];
    const value = query.trim().replace(/\\/g, "/").toLocaleLowerCase();
    return ["/", ...new Set(this.folders().filter(path => path && path !== "/").sort((a, b) => a.localeCompare(b)))]
      .filter(path => path.toLocaleLowerCase().includes(value));
  }

  renderSuggestion(path: string, el: HTMLElement) { el.setText(path); }

  selectSuggestion(path: string, event: MouseEvent | KeyboardEvent) {
    if (this.disposed || (event as KeyboardEvent).isComposing) return;
    const value = path === "/" ? "" : path;
    this.setValue(value); this.close();
    void this.choose(value);
  }

  dispose() { this.disposed = true; this.close(); }
}
