/** Read-only reader for the former bold/block-ID format. Never used to write new files. */
/** Human-readable Markdown is the source of truth; no parallel JSON node bodies. */
export type DocumentNode = { id: string; title: string; body: string; start: number; end: number; needsAnchor?: boolean };
export type DocumentRelation = { from: string; to: string; start: number; end: number };
export type DocumentLink = { target: string; label?: string; start: number; end: number; original: string };
type Section = { start: number; content: number; end: number };
export type ThoughtDocument = {
  nodes: DocumentNode[];
  relations: DocumentRelation[];
  references: DocumentLink[];
  sections: Partial<Record<"节点" | "引用" | "关系", Section>>;
};
/** Lines inside code fences are content, not structural markers or live links. */
export function markdownLines(text: string) {
  const result: { text: string; start: number; end: number; code: boolean }[] = [];
  let fence: { char: string; length: number } | undefined;
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!match[0]) continue;
    const raw = match[0].replace(/\r?\n$/, "");
    const marker = raw.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    const code = !!fence || !!marker;
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
    }
    result.push({ text: raw, start: match.index, end: match.index + match[0].length, code });
  }
  return result;
}

export function documentLinks(text: string, offset = 0): DocumentLink[] {
  const links: DocumentLink[] = [];
  let comment = false;
  for (const line of markdownLines(text)) {
    if (line.code) continue;
    const hidden = line.text.startsWith("<!--") || comment;
    if (line.text.includes("<!--")) comment = true;
    if (line.text.includes("-->")) comment = false;
    if (hidden) continue;
    // Mask inline code without changing offsets.
    const visible = line.text.replace(/(`+).*?\1/g, value => " ".repeat(value.length));
    for (const match of visible.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
      const [target, ...alias] = match[1].split("|");
      const start = offset + line.start + match.index;
      links.push({ target: target.trim(), ...(alias.length ? { label: alias.join("|") } : {}), start,
        end: start + match[0].length, original: text.slice(line.start + match.index, line.start + match.index + match[0].length) });
    }
    for (const match of visible.matchAll(/!?\[([^\]\n]*)\]\(([^\s)]+)(?:\s+"[^"\n]*")?\)/g)) {
      if (match.index > 0 && visible[match.index - 1] === "[") continue;
      let target: string;
      try { target = decodeURIComponent(match[2].replace(/^<|>$/g, "")); } catch { continue; }
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const start = offset + line.start + match.index;
      links.push({ target, label: match[1], start, end: start + match[0].length, original: text.slice(line.start + match.index, line.start + match.index + match[0].length) });
    }
  }
  return links.sort((a, b) => a.start - b.start);
}

export function parseThoughtDocument(markdown: string): ThoughtDocument {
  const lines = markdownLines(markdown);
  const headings = lines.filter(line => !line.code && /^## (节点|引用|关系)\s*$/.test(line.text));
  const sections: ThoughtDocument["sections"] = {};
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index], name = heading.text.trim().slice(3) as keyof typeof sections;
    if (sections[name]) throw new Error(`思考文件中有多个「${name}」区域，请先合并，原文未修改`);
    sections[name] = { start: heading.start, content: heading.end, end: headings[index + 1]?.start ?? markdown.length };
  }
  const nodes: DocumentNode[] = [];
  const region = sections.节点;
  if (region) {
    const occurrences = new Map<string, number>();
    const titles = lines.filter(line => !line.code && line.start >= region.content && line.start < region.end).flatMap(line => {
      const block = line.text.match(/^\*\*(.+)\*\* \^([A-Za-z0-9-]+)\s*$/);
      if (block) return [{ line, title: block[1].replace(/\\([\\*])/g, "$1"), id: block[2], needsAnchor: false }];
      const heading = line.text.match(/^\*\*(.+)\*\*\s*$/);
      if (!heading) return [];
      const title = heading[1].replace(/\\([\\*])/g, "$1"), count = (occurrences.get(title) ?? 0) + 1;
      occurrences.set(title, count);
      let hash = 2166136261;
      for (let index = 0; index < title.length; index++) hash = Math.imul(hash ^ title.charCodeAt(index), 16777619);
      return [{ line, title, id: `node-draft-${(hash >>> 0).toString(16)}-${count}`, needsAnchor: true }];
    });
    const ids = new Set<string>();
    for (let index = 0; index < titles.length; index++) {
      const { line, id, title, needsAnchor } = titles[index];
      if (ids.has(id)) throw new Error(`节点标识重复：${id}，原文未修改`);
      ids.add(id);
      const end = titles[index + 1]?.line.start ?? region.end;
      nodes.push({ id, title, needsAnchor, body: markdown.slice(line.end, end).replace(/^\s*\n/, "").trimEnd(), start: line.start, end });
    }
  }
  const relations: DocumentRelation[] = [];
  const links = sections.关系;
  if (links) for (const line of lines.filter(line => !line.code && line.start >= links.content && line.start < links.end)) {
    const match = line.text.match(/^\s*- (\[\[[^\n]+?\]\]) → (\[\[[^\n]+?\]\])\s*$/);
    if (!match) continue;
    const pair = documentLinks(line.text);
    if (pair.length === 2) relations.push({ from: pair[0].target, to: pair[1].target, start: line.start, end: line.end });
  }
  const references = sections.引用 ? documentLinks(markdown.slice(sections.引用.content, sections.引用.end), sections.引用.content) : [];
  return { nodes, relations, references, sections };
}

