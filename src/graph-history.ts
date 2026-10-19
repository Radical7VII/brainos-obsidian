import type { App, TFile } from "obsidian";

type Change = { file: TFile; before: string; after: string };
type Entry = { changes: Change[]; undoState?: () => Promise<void>; redoState?: () => Promise<void> };
type State<T> = { capture(): T; restore(value: T, previous: T): Promise<void> };
const histories = new WeakMap<App, GraphHistory>();

export function graphHistory(app: App) {
  let history = histories.get(app);
  if (!history) { history = new GraphHistory(app); histories.set(app, history); }
  return history;
}

/** Track only explicit graph writes, without replacing Vault methods or native editor history. */
export async function processGraphFile(app: App, file: TFile, edit: (text: string) => string) {
  let before = "", after = "";
  await app.vault.process(file, current => { before = current; after = edit(current); return after; });
  if (before !== after) graphHistory(app).track({ file, before, after });
}

class GraphHistory {
  private undoEntries: Entry[] = [];
  private redoEntries: Entry[] = [];
  private active?: Map<string, Change>;
  private interrupted = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private app: App) {}

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }

  track(change: Change) {
    if (!this.active) return;
    const previous = this.active.get(change.file.path);
    if (previous && previous.after !== change.before) this.interrupted = true;
    this.active.set(change.file.path, { ...change, before: previous?.before ?? change.before });
  }

  record<T>(action: () => Promise<void>, state?: State<T>) {
    return this.serial(async () => {
      const before = state?.capture();
      const changes = this.active = new Map<string, Change>();
      this.interrupted = false;
      try { await action(); }
      finally {
        this.active = undefined;
        const actual = [...changes.values()].filter(change => change.before !== change.after);
        if (actual.length && !this.interrupted) {
          const after = state?.capture();
          this.undoEntries.push({ changes: actual,
            undoState: state ? () => state.restore(before!, after!) : undefined,
            redoState: state ? () => state.restore(after!, before!) : undefined });
          if (this.undoEntries.length > 50) this.undoEntries.shift();
          this.redoEntries = [];
        }
      }
    });
  }

  undo() { return this.move(this.undoEntries, this.redoEntries, false); }
  redo() { return this.move(this.redoEntries, this.undoEntries, true); }

  private move(from: Entry[], to: Entry[], redo: boolean) {
    return this.serial(async () => {
      const entry = from[from.length - 1]; if (!entry) return false;
      const expected = (change: Change) => redo ? change.before : change.after;
      const replacement = (change: Change) => redo ? change.after : change.before;
      for (const change of entry.changes) {
        if (this.app.vault.getAbstractFileByPath(change.file.path) !== change.file
          || await this.app.vault.read(change.file) !== expected(change)) {
          throw new Error("相关笔记已在其他位置修改，无法撤销或重做，原内容未覆盖");
        }
      }
      const applied: Change[] = [];
      try {
        for (const change of entry.changes) {
          await this.app.vault.process(change.file, current => {
            if (current !== expected(change)) throw new Error("笔记已变化，无法撤销或重做");
            return replacement(change);
          });
          applied.push(change);
        }
        await (redo ? entry.redoState?.() : entry.undoState?.());
      } catch (error) {
        for (const change of applied.reverse()) {
          await this.app.vault.process(change.file, current => current === replacement(change) ? expected(change) : current);
        }
        throw error;
      }
      from.pop(); to.push(entry); return true;
    });
  }
}
