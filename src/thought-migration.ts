import { parseThoughtDocument as parseParagraphs } from "./legacy-thought-document";
import { appendDocumentStep, documentLinks, markdownLines, wikiLink } from "./thought-document";

export type ConvertedThought = { markdown: string; aliases: Map<string, string> };

/** Remove only properties owned by former BrainOS files, retaining custom YAML. */
export function stripBrainOSProperties(markdown: string) {
  const header = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!header || !/^brainos_type:\s*thought-file\s*$/m.test(header[1])) return markdown;
  const owned = /^(brainos_type|brainos_version|id|title|created_at|updated_at|status|source):/;
  let skipping = false;
  const remaining = header[1].split(/\r?\n/).filter(line => {
    if (/^\S/.test(line)) skipping = owned.test(line);
    return !skipping;
  }).join("\n").trim();
  return (remaining ? "---\n" + remaining + "\n---\n\n" : "") + markdown.slice(header[0].length).trimStart();
}
export function uniqueLegacyTitle(title: string, used: Set<string>) {
  const base = title.trim().replace(/[\r\n]+/g, " ") || "未命名节点";
  let value = base, number = 2;
  while (used.has(value)) value = base + "（" + number++ + "）";
  used.add(value);
  return value;
}

/** Old explicit edges become separate paths; never infer adjacency from old node order. */
export function convertParagraphThought(original: string): ConvertedThought | undefined {
  if (!markdownLines(original).some(line => !line.code && /^## 节点\s*$/.test(line.text))) return undefined;
  const doc = parseParagraphs(original);
  if (!doc.sections.节点) return undefined;
  const used = new Set<string>(), aliases = new Map<string, string>();
  for (const node of doc.nodes) aliases.set(node.id, uniqueLegacyTitle(node.title, used));
  const localName = (target: string) => target.startsWith("#^") ? aliases.get(target.slice(2))
    : target.startsWith("#") ? aliases.get(doc.nodes.find(node => node.title === target.slice(1))?.id ?? "") : undefined;
  const step = (target: string, label?: string) => localName(target) ?? wikiLink(target, label ?? target);
  let markdown = stripBrainOSProperties(original.slice(0, doc.sections.节点.start)).trimEnd();
  const introduction = original.slice(doc.sections.节点.content, doc.nodes[0]?.start ?? doc.sections.节点.end).trim();
  if (introduction) markdown += "\n\n" + introduction + "\n";
  for (const node of doc.nodes) {
    let body = node.body;
    for (const link of documentLinks(body).reverse()) {
      const title = localName(link.target);
      if (title) body = body.slice(0, link.start) + wikiLink("#" + title, link.label ?? title) + body.slice(link.end);
    }
    markdown = appendDocumentStep(markdown, aliases.get(node.id)!, body, true);
  }
  for (const reference of doc.references) markdown = appendDocumentStep(markdown, step(reference.target, reference.label), "", true);
  for (const relation of doc.relations) {
    markdown = appendDocumentStep(markdown, step(relation.from), "", true);
    markdown = appendDocumentStep(markdown, step(relation.to));
  }
  // Preserve explanatory text in the old reference/relation regions as prose.
  for (const [name, section] of Object.entries(doc.sections)) {
    if (name === "节点" || !section) continue;
    let prose = original.slice(section.content, section.end);
    const structural = name === "关系" ? doc.relations : doc.references;
    for (const span of [...structural].sort((a, b) => b.start - a.start)) {
      const start = span.start - section.content, end = span.end - section.content;
      prose = prose.slice(0, start) + prose.slice(end);
    }
    prose = prose.replace(/^\s*-\s*$/gm, "").trim();
    if (prose) markdown += "\n\n" + prose + "\n";
  }
  return { markdown, aliases };
}
