import { App, parseLinktext, TFile } from "obsidian";

export async function appendVaultLink(app: App, from: string, to: string) {
  const source = app.vault.getAbstractFileByPath(from);
  const target = app.vault.getAbstractFileByPath(to);
  if (!(source instanceof TFile) || source.extension !== "md" || !(target instanceof TFile)) throw new Error("请在已有 Markdown 笔记之间建立链接");
  if (source.path === target.path) return;
  const link = app.fileManager.generateMarkdownLink(target, source.path);
  await app.vault.process(source, current => {
    if (app.metadataCache.resolvedLinks[source.path]?.[target.path] || current.includes(link)) return current;
    return current + (current.endsWith("\n") ? "\n" : "\n\n") + link + "\n";
  });
}

/** Remove markup for this edge, retaining its readable text and the target file. */
export async function removeVaultLink(app: App, from: string, to: string) {
  const source = app.vault.getAbstractFileByPath(from);
  if (!(source instanceof TFile) || source.extension !== "md") throw new Error("该节点没有可编辑的 Markdown 来源");
  const cache = app.metadataCache.getFileCache(source);
  const references = [...(cache?.links ?? []), ...(cache?.embeds ?? [])].filter(reference => {
    const parsed = parseLinktext(reference.link);
    const target = app.metadataCache.getFirstLinkpathDest(parsed.path || source.path, source.path);
    return target?.path === to || `unresolved:${parsed.path}` === to;
  }).sort((a, b) => b.position.start.offset - a.position.start.offset);
  if (!references.length) throw new Error("该连线可能来自属性或索引尚未更新，请打开来源笔记修改");
  await app.vault.process(source, current => {
    let next = current;
    for (const reference of references) {
      const start = reference.position.start.offset, end = reference.position.end.offset;
      if (current.slice(start, end) !== reference.original) throw new Error("笔记链接已被外部修改，请刷新图谱后重试");
      const label = reference.displayText ?? reference.link;
      next = next.slice(0, start) + label + next.slice(end);
    }
    return next;
  });
}
