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
export const NODE_ID = /^[a-zA-Z0-9-]+$/;
export const newNodeID = () => `node-${crypto.randomUUID()}`;
export const nodeKey = (file: string, id: string) => `${file}#^${id}`;
export function splitNodeKey(key: string) {
  const index = key.lastIndexOf("#^");
  return index >= 0 ? { file: key.slice(0, index), id: key.slice(index + 2) } : undefined;
}

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
    result.push({ text: raw, start: match.index!, end: match.index! + match[0].length, code });
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
      const start = offset + line.start + match.index!;
      links.push({ target: target.trim(), ...(alias.length ? { label: alias.join("|") } : {}), start,
        end: start + match[0].length, original: text.slice(line.start + match.index!, line.start + match.index! + match[0].length) });
    }
    for (const match of visible.matchAll(/!?\[([^\]\n]*)\]\(([^\s)]+)(?:\s+"[^"\n]*")?\)/g)) {
      if (match.index! > 0 && visible[match.index! - 1] === "[") continue;
      let target: string;
      try { target = decodeURIComponent(match[2].replace(/^<|>$/g, "")); } catch { continue; }
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const start = offset + line.start + match.index!;
      links.push({ target, label: match[1], start, end: start + match[0].length, original: text.slice(line.start + match.index!, line.start + match.index! + match[0].length) });
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

export function isThoughtDocument(markdown: string) {
  return !!parseThoughtDocument(markdown).sections.节点;
}

function paragraphTitle(title: string) {
  const value = title.trim().replace(/[\r\n]+/g, " ");
  if (!value) throw new Error("节点标题不能为空");
  return value.replace(/\\/g, "\\\\").replace(/\*/g, "\\*");
}
function renderNode(id: string, title: string, body: string) {
  if (!NODE_ID.test(id)) throw new Error("节点标识无效");
  // A pasted second node would otherwise silently change graph identities.
  const sample = parseThoughtDocument(`## 节点\n\n**node** ^${id}\n\n${body}\n`);
  if (sample.nodes.length !== 1 || Object.keys(sample.sections).length !== 1) throw new Error("正文包含独立的粗体节点标题或区域标记，请将示例放进代码块");
  return `**${paragraphTitle(title)}** ^${id}\n\n${body.trimEnd()}${body.trimEnd() ? "\n\n" : ""}`;
}

export function initializeThoughtDocument(markdown: string) {
  if (isThoughtDocument(markdown)) return markdown;
  return markdown.trimEnd() + "\n\n## 节点\n\n";
}

/** Simple handwritten bold node titles acquire standard block anchors on the first edit. */
export function anchorThoughtNodes(markdown: string) {
  let text = markdown;
  for (const node of parseThoughtDocument(markdown).nodes.filter(node => node.needsAnchor).reverse()) {
    const end = markdown.indexOf("\n", node.start);
    const after = end < 0 ? node.end : end;
    text = text.slice(0, node.start) + `**${paragraphTitle(node.title)}** ^${node.id}` + text.slice(after);
  }
  return text;
}

export function insertDocumentNode(markdown: string, id: string, title: string, body = "") {
  const text = initializeThoughtDocument(markdown), parsed = parseThoughtDocument(text);
  if (parsed.nodes.some(node => node.id === id)) throw new Error("节点标识已存在");
  const end = parsed.sections.节点!.end;
  const before = text.slice(0, end).trimEnd();
  return before + "\n\n" + renderNode(id, title, body) + text.slice(end);
}

export function updateDocumentNode(markdown: string, id: string, title: string, body: string, expected?: { title: string; body: string }) {
  const node = parseThoughtDocument(markdown).nodes.find(node => node.id === id);
  if (!node) throw new Error("节点已不存在，请刷新后重试");
  if (expected && (node.title !== expected.title || node.body !== expected.body)) throw new Error("节点已在其他位置修改，请重新打开编辑，避免覆盖内容");
  return markdown.slice(0, node.start) + renderNode(id, title, body) + markdown.slice(node.end);
}

export function wikiLink(target: string, title: string) {
  if (/[\[\]\r\n|]/.test(target)) throw new Error("链接路径含有不支持的字符");
  const label = title.replace(/[\[\]|\r\n]/g, " ");
  return `[[${target}|${label}]]`;
}
export function localTarget(owner: string, key: string) {
  const ref = splitNodeKey(key);
  if (ref?.file === owner) return `#^${ref.id}`;
  return key;
}
function appendSectionLine(markdown: string, section: "引用" | "关系", line: string) {
  const region = parseThoughtDocument(markdown).sections[section];
  if (!region) return markdown.trimEnd() + `\n\n## ${section}\n\n${line}\n`;
  return markdown.slice(0, region.end).trimEnd() + `\n${line}\n\n` + markdown.slice(region.end);
}
export function insertDocumentReference(markdown: string, target: string, label: string) {
  if (parseThoughtDocument(markdown).references.some(ref => ref.target === target)) return markdown;
  return appendSectionLine(markdown, "引用", `- ${wikiLink(target, label)}`);
}
export function insertDocumentRelation(markdown: string, from: string, fromTitle: string, to: string, toTitle: string) {
  if (from === to) return markdown;
  if (parseThoughtDocument(markdown).relations.some(edge => edge.from === from && edge.to === to)) return markdown;
  return appendSectionLine(markdown, "关系", `- ${wikiLink(from, fromTitle)} → ${wikiLink(to, toTitle)}`);
}

export function removeDocumentRelation(markdown: string, matches: (from: string, to: string) => boolean) {
  const spans = parseThoughtDocument(markdown).relations.filter(edge => matches(edge.from, edge.to)).sort((a, b) => b.start - a.start);
  let text = markdown;
  for (const span of spans) text = text.slice(0, span.start) + text.slice(span.end);
  return text;
}
export function unlinkDocumentBody(markdown: string, nodeID: string, matches: (target: string) => boolean) {
  const node = parseThoughtDocument(markdown).nodes.find(node => node.id === nodeID);
  if (!node) return markdown;
  let body = node.body;
  for (const link of documentLinks(body).filter(link => matches(link.target)).sort((a, b) => b.start - a.start)) body = body.slice(0, link.start) + (link.label ?? link.target) + body.slice(link.end);
  return updateDocumentNode(markdown, node.id, node.title, body);
}
export function removeDocumentReference(markdown: string, matches: (target: string) => boolean) {
  const doc = parseThoughtDocument(markdown);
  let text = markdown;
  for (const link of doc.references.filter(link => matches(link.target)).sort((a, b) => b.start - a.start)) {
    text = text.slice(0, link.start) + (link.label ?? link.target) + text.slice(link.end);
  }
  return text;
}
