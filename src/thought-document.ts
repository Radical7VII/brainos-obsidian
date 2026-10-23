/**
 * Ordered Markdown list paths. Names identify nodes within a file.
 * Occurrences retain their own bodies; no identities are written to Markdown.
 */
export type DocumentLink = { target: string; label?: string; start: number; end: number; original: string };
export type DocumentOccurrence = {
  id: string; title: string; body: string; start: number; end: number;
  titleEnd: number; path: number; ordinal: number; target?: string; referenceLabel?: string;
};
export type DocumentNode = {
  id: string; title: string; body: string; start: number; end: number; target?: string; referenceLabel?: string;
  occurrences: DocumentOccurrence[];
};
export type DocumentRelation = { from: string; to: string; start: number; end: number };
export type ThoughtDocument = {
  nodes: DocumentNode[]; occurrences: DocumentOccurrence[];
  paths: DocumentOccurrence[][]; relations: DocumentRelation[];
};
export type NodeEditSnapshot = { title: string; body: string; ordinal?: number; revision?: string };

/** Internal view-state identities, never persisted in the document. */
export const titleID = (title: string) => "name:" + title.trim();
export const nodeKey = (file: string, id: string) => file + "#brainos=" + encodeURIComponent(id);
export function splitNodeKey(key: string) {
  const index = key.lastIndexOf("#brainos=");
  if (index >= 0) {
    try { return { file: key.slice(0, index), id: decodeURIComponent(key.slice(index + 9)) }; }
    catch { return undefined; }
  }
  const legacy = key.lastIndexOf("#^");
  return legacy >= 0 ? { file: key.slice(0, legacy), id: key.slice(legacy + 2) } : undefined;
}

/** Code fences, comments and existing frontmatter contain no structural steps. */
export function markdownLines(text: string) {
  const result: { text: string; start: number; end: number; code: boolean }[] = [];
  let fence: { char: string; length: number } | undefined;
  let comment = false;
  const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
  const headerEnd = frontmatter && /^(?!- )[^ \t\r\n:#][^:\r\n]*:/m.test(frontmatter[0]) ? frontmatter[0].length : 0;
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!match[0]) continue;
    const raw = match[0].replace(/\r?\n$/, "");
    if (match.index < headerEnd) {
      result.push({ text: raw, start: match.index, end: match.index + match[0].length, code: true });
      continue;
    }
    const marker = raw.match(/^[ \t]*(\x60{3,}|~{3,})(.*)$/);
    const hidden = comment || raw.trimStart().startsWith("<!--");
    const code = !!fence || !!marker || hidden;
    if (!hidden && marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
    }
    const visible = raw.replace(/(\x60+).*?\1/g, "");
    if (!fence && visible.includes("<!--")) comment = !visible.includes("-->", visible.indexOf("<!--") + 4);
    else if (comment && raw.includes("-->")) comment = false;
    result.push({ text: raw, start: match.index, end: match.index + match[0].length, code });
  }
  return result;
}

export function documentLinks(text: string, offset = 0): DocumentLink[] {
  const links: DocumentLink[] = [];
  for (const line of markdownLines(text)) {
    if (line.code || /^(?: {4}|\t)/.test(line.text)) continue;
    const visible = line.text.replace(/(\x60+).*?\1/g, value => " ".repeat(value.length))
      .replace(/<!--.*?-->/g, value => " ".repeat(value.length));
    for (const match of visible.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
      const [target, ...alias] = match[1].split("|");
      const start = offset + line.start + match.index;
      links.push({ target: target.trim(), ...(alias.length ? { label: alias.join("|") } : {}),
        start, end: start + match[0].length, original: text.slice(line.start + match.index, line.start + match.index + match[0].length) });
    }
    for (const match of visible.matchAll(/!?\[([^\]\n]*)\]\(([^\s)]+)(?:\s+"[^"\n]*")?\)/g)) {
      if (match.index > 0 && visible[match.index - 1] === "[") continue;
      let target: string;
      try { target = decodeURIComponent(match[2].replace(/^<|>$/g, "")); } catch { continue; }
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const start = offset + line.start + match.index;
      links.push({ target, label: match[1], start, end: start + match[0].length,
        original: text.slice(line.start + match.index, line.start + match.index + match[0].length) });
    }
  }
  return links.sort((a, b) => a.start - b.start);
}

function entry(title: string) {
  const value = title.trim(), links = documentLinks(value);
  if (links.length === 1 && links[0].start === 0 && links[0].end === value.length) {
    const { target, label } = links[0];
    return { id: "reference:" + JSON.stringify([target, label ?? ""]), title: label || target, target, referenceLabel: label };
  }
  return { id: titleID(value), title: value };
}
function unindentBody(text: string) {
  return text.replace(/^\s*\n/, "").trimEnd().split("\n")
    .map(line => line.startsWith("  ") ? line.slice(2) : line.startsWith("\t") ? line.slice(1) : line).join("\n");
}

export function parseThoughtDocument(markdown: string): ThoughtDocument {
  const nodes = new Map<string, DocumentNode>();
  const occurrences: DocumentOccurrence[] = [], paths: DocumentOccurrence[][] = [], relations: DocumentRelation[] = [];
  let path: DocumentOccurrence[] = [];
  let pending: { text: string; start: number; end: number } | undefined;
  const finish = (end: number) => {
    if (!pending) return;
    const value = entry(pending.text.slice(2));
    let node = nodes.get(value.id);
    const occurrence: DocumentOccurrence = { ...value, body: unindentBody(markdown.slice(pending.end, end)),
      start: pending.start, titleEnd: pending.end, end, path: paths.length, ordinal: node?.occurrences.length ?? 0 };
    occurrences.push(occurrence);
    if (!node) {
      node = { ...value, body: occurrence.body, start: occurrence.start, end, occurrences: [] };
      nodes.set(value.id, node);
    }
    node.occurrences.push(occurrence); node.body = occurrence.body;
    const previous = path[path.length - 1];
    if (previous) relations.push({ from: previous.id, to: occurrence.id, start: occurrence.start, end: occurrence.titleEnd });
    path.push(occurrence); pending = undefined;
  };
  for (const line of markdownLines(markdown)) {
    if (line.code) continue;
    if (/^---[ \t]*$/.test(line.text)) {
      finish(line.start);
      if (path.length) paths.push(path);
      path = [];
    } else if (/^- \S/.test(line.text)) {
      finish(line.start); pending = line;
    }
  }
  finish(markdown.length);
  if (path.length) paths.push(path);
  return { nodes: [...nodes.values()], occurrences, paths, relations };
}
export function isThoughtDocument(markdown: string) { return parseThoughtDocument(markdown).occurrences.length > 0; }
export function nodeRevision(node: DocumentNode) {
  return JSON.stringify(node.occurrences.map(occurrence => [occurrence.title, occurrence.body]));
}
export function cleanNodeTitle(title: string) {
  if (/[\r\n]/.test(title)) throw new Error("节点名称只能占一行");
  const value = title.trim();
  if (!value) throw new Error("节点名称不能为空");
  return value;
}
function renderOccurrence(title: string, body = "") {
  const value = body.replace(/\r\n/g, "\n").trimEnd();
  return "- " + cleanNodeTitle(title) + "\n" + (value ? value.split("\n").map(line => line ? "  " + line : "").join("\n") + "\n" : "");
}
export function occurrenceTitle(node: { title: string; target?: string; referenceLabel?: string }) {
  return node.target ? node.referenceLabel === undefined ? "[[" + node.target + "]]" : wikiLink(node.target, node.referenceLabel) : node.title;
}
export function appendDocumentStep(markdown: string, title: string, body = "", newPath = false) {
  const before = markdown.trimEnd(), doc = parseThoughtDocument(markdown);
  const separator = newPath && doc.occurrences.length && !/^---[ \t]*$/.test(before.split("\n").pop() ?? "");
  const next = (before ? before + (separator ? "\n\n---\n\n" : "\n") : "") + renderOccurrence(title, body);
  if (parseThoughtDocument(next).occurrences.length !== doc.occurrences.length + 1) throw new Error("文件末尾的代码块或注释尚未闭合，请先在 Markdown 中补齐");
  return next;
}
/** Continue at the tail, or revisit the chosen node in a fresh path. */
export function appendDocumentContinuation(markdown: string, from: string | undefined, to: string, body = "") {
  if (!from) return appendDocumentStep(markdown, to, body, true);
  let text = markdown;
  const visits = parseThoughtDocument(text).occurrences, last = visits[visits.length - 1];
  if (!last || last.id !== entry(from).id || last.end < text.length) {
    text = appendDocumentStep(text, from, "", true);
  }
  return appendDocumentStep(text, to, body);
}
/** Insert a fresh node while keeping all existing visits and bodies intact. */
export function insertDocumentStepBefore(markdown: string, index: number, title: string) {
  const doc = parseThoughtDocument(markdown), visit = doc.occurrences[index], previous = doc.occurrences[index - 1];
  if (!visit || !previous || previous.path !== visit.path) throw new Error("当前节点没有父节点，无法在中间插入");
  const value = cleanNodeTitle(title), parsed = parseThoughtDocument(renderOccurrence(value));
  if (parsed.nodes.length !== 1 || parsed.nodes[0].target) throw new Error("请输入普通节点名称");
  if (doc.nodes.some(node => node.id === titleID(value))) throw new Error("已有同名节点，请为插入的新节点使用其他名称");
  const next = markdown.slice(0, visit.start) + renderOccurrence(value) + markdown.slice(visit.start);
  const result = parseThoughtDocument(next), inserted = result.occurrences[index];
  const retained = result.occurrences.filter((_, ordinal) => ordinal !== index);
  const signature = (visits: DocumentOccurrence[]) => JSON.stringify(visits.map(item => [item.id, item.body, item.path]));
  if (result.occurrences.length !== doc.occurrences.length + 1 || inserted?.id !== titleID(value)
    || signature(retained) !== signature(doc.occurrences)) throw new Error("当前路径无法安全插入节点，请先检查 Markdown 中的代码块或注释");
  return next;
}

/** Rename all occurrences; edit only the selected visit's body. */
export function updateDocumentNode(markdown: string, id: string, title: string, body: string | undefined, expected?: NodeEditSnapshot, allowMerge = false) {
  const doc = parseThoughtDocument(markdown), node = doc.nodes.find(node => node.id === id);
  if (!node) throw new Error("节点已不存在，请刷新后重试");
  const value = cleanNodeTitle(title);
  if (node.target) throw new Error("请在来源思考中编辑引用节点");
  if (entry(value).target) throw new Error("节点名称不能是完整的文件引用");
  if (!allowMerge && doc.nodes.some(other => other.id !== id && other.id === titleID(value))) throw new Error("这个名称已属于另一个节点，请使用其他名称；复用节点可在创建时输入它的名称");
  const occurrence = node.occurrences[expected?.ordinal ?? node.occurrences.length - 1];
  if (!occurrence || (expected && (node.title !== expected.title || occurrence.body !== expected.body
    || (expected.revision !== undefined && nodeRevision(node) !== expected.revision)))) {
    throw new Error("节点已在其他位置修改，请重新打开编辑，避免覆盖内容");
  }
  let text = markdown;
  for (const visit of [...node.occurrences].reverse()) {
    const rendered = visit === occurrence && body !== undefined ? renderOccurrence(value, body) + "\n"
      : "- " + value + markdown.slice(visit.start + 2 + visit.title.length, visit.end);
    text = text.slice(0, visit.start) + rendered + text.slice(visit.end);
  }
  const expectedIDs = doc.occurrences.map(visit => visit.id === id ? titleID(value) : visit.id);
  if (JSON.stringify(parseThoughtDocument(text).occurrences.map(visit => visit.id)) !== JSON.stringify(expectedIDs)) {
    throw new Error("正文中的代码块或注释尚未闭合，会遮蔽后续记录，请先补齐");
  }
  return text;
}
/** Cutting edges preserves visits and prose by inserting path boundaries. */
export function removeDocumentRelation(markdown: string, matches: (from: string, to: string) => boolean) {
  let text = markdown;
  for (const edge of parseThoughtDocument(markdown).relations.filter(edge => matches(edge.from, edge.to)).reverse()) {
    text = text.slice(0, edge.start).trimEnd() + "\n\n---\n\n" + text.slice(edge.start);
  }
  return text;
}
/** Removing a visit never silently bridges its neighbors. */
export function removeDocumentNode(markdown: string, id: string) {
  let text = markdown;
  for (const visit of parseThoughtDocument(markdown).occurrences.filter(visit => visit.id === id).reverse()) {
    text = text.slice(0, visit.start) + "---\n\n" + text.slice(visit.end);
  }
  return text;
}
export function unlinkDocumentBody(markdown: string, nodeID: string, matches: (target: string, label?: string) => boolean) {
  let text = markdown;
  const node = parseThoughtDocument(markdown).nodes.find(node => node.id === nodeID);
  if (!node) return text;
  for (const visit of [...node.occurrences].reverse()) {
    let body = visit.body;
    const links = documentLinks(body).filter(link => matches(link.target, link.label)).reverse();
    if (!links.length) continue;
    for (const link of links) body = body.slice(0, link.start) + (link.label ?? link.target) + body.slice(link.end);
    text = text.slice(0, visit.start) + renderOccurrence(occurrenceTitle(visit), body) + "\n" + text.slice(visit.end);
  }
  return text;
}
export function wikiLink(target: string, title: string) {
  if (/[[\]\r\n|]/.test(target)) throw new Error("链接路径含有不支持的字符");
  return "[[" + target + "|" + title.replace(/[[\]|\r\n]/g, " ") + "]]";
}
