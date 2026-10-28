/**
 * Ordered Markdown records with explicit arrow relations. Names identify nodes within a file.
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
export type DocumentRelation = { from: string; to: string; start: number; end: number; sourceIndex?: number; targetText?: string };
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

/** Only the one-shot converter reads implicit adjacency and path separators. */
export function parseLegacyListDocument(markdown: string): ThoughtDocument {
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

/** Arrow targets are names, or complete native links for cross-file references. */
export function parseThoughtDocument(markdown: string): ThoughtDocument {
  const doc = parseLegacyListDocument(markdown);
  doc.relations = [];
  const lines = markdownLines(markdown);
  for (const [sourceIndex, visit] of doc.occurrences.entries()) {
    const arrows = lines.filter(line => !line.code && line.start >= visit.titleEnd && line.start < visit.end
      && /^(?: {2}|\t)(?:→|- to:)\s+\S/.test(line.text));
    for (const line of arrows) {
      const targetText = line.text.replace(/^(?: {2}|\t)(?:→|- to:)\s+/, "").trim();
      const target = entry(targetText);
      doc.relations.push({ from: visit.id, to: target.id, start: line.start, end: line.end, sourceIndex, targetText });
      if (!doc.nodes.some(node => node.id === target.id)) doc.nodes.push({ ...target, body: "", start: line.start, end: line.end, occurrences: [] });
    }
    let body = markdown.slice(visit.titleEnd, visit.end);
    for (const line of [...arrows].reverse()) body = body.slice(0, line.start - visit.titleEnd) + body.slice(line.end - visit.titleEnd);
    visit.body = unindentBody(body);
  }
  for (const node of doc.nodes) node.body = node.occurrences[node.occurrences.length - 1]?.body ?? "";
  // Paths remain a convenience for existing graph keyboard actions. They never infer edges.
  doc.paths = [];
  for (const [index, visit] of doc.occurrences.entries()) {
    const previous = doc.occurrences[index - 1];
    if (!previous || !doc.relations.some(edge => edge.sourceIndex === index - 1 && edge.to === visit.id)) doc.paths.push([]);
    visit.path = doc.paths.length - 1;
    doc.paths[visit.path].push(visit);
  }
  return doc;
}

/** Convert an old file once, preserving prose, visit order, links and code verbatim. */
export function convertListPathsToArrows(markdown: string) {
  const old = parseLegacyListDocument(markdown), lines = markdownLines(markdown);
  if (!old.occurrences.length) return markdown;
  if (lines.some(line => !line.code && /^(?: {2}|\t)(?:→|- to:)\s+\S/.test(line.text))) {
    throw new Error("文件已包含箭头关系，请勿再次按旧路径格式转换");
  }
  const edits: { start: number; end: number; text: string }[] = [];
  for (const path of old.paths) for (let i = 0; i < path.length - 1; i++) {
    const visit = path[i];
    edits.push({ start: visit.end, end: visit.end, text: "  → " + occurrenceTitle(path[i + 1]) + "\n\n" });
  }
  for (const line of lines) if (!line.code && /^---[ \t]*$/.test(line.text)) edits.push({ start: line.start, end: line.end, text: "" });
  let next = markdown;
  // Remove boundaries before inserting at the same offset.
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  const result = parseThoughtDocument(next);
  const visits = (doc: ThoughtDocument) => JSON.stringify(doc.occurrences.map(v => [v.id, v.body]));
  const edges = (doc: ThoughtDocument) => JSON.stringify(doc.relations.map(e => [e.from, e.to]).sort());
  if (visits(old) !== visits(result) || edges(old) !== edges(result)) throw new Error("转换校验失败，原文件未修改；请检查未闭合的代码块或注释");
  return next;
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
/** Keep edits atomic: malformed bodies must not hide subsequent records or edges. */
function verifyVisits(text: string, expected: string[]) {
  const after = parseThoughtDocument(text);
  if (JSON.stringify(after.occurrences.map(v => v.id)) !== JSON.stringify(expected)) {
    throw new Error("正文中的代码块或注释尚未闭合，会遮蔽后续记录，请先补齐");
  }
  return text;
}
function addArrow(markdown: string, visit: DocumentOccurrence, target: string) {
  const head = markdown.slice(0, visit.end).trimEnd();
  return head + "\n  → " + cleanNodeTitle(target) + "\n\n" + markdown.slice(visit.end);
}
function outgoing(doc: ThoughtDocument, index: number) {
  return doc.relations.filter(edge => edge.sourceIndex === index).map(edge => edge.targetText!);
}
function renderVisit(title: string, body: string, targets: string[]) {
  return renderOccurrence(title, body) + targets.map(target => "  → " + target + "\n").join("") + "\n";
}
export function appendDocumentStep(markdown: string, title: string, body = "", newPath = false) {
  const doc = parseThoughtDocument(markdown), last = doc.occurrences[doc.occurrences.length - 1];
  let text = markdown;
  if (!newPath && last) text = addArrow(text, last, title);
  text = text.trimEnd() + (text.trim() ? "\n\n" : "") + renderOccurrence(title, body);
  const expected = [...doc.occurrences.map(v => v.id), entry(title).id];
  verifyVisits(text, expected);
  if (last && !newPath && !parseThoughtDocument(text).relations.some(e => e.sourceIndex === doc.occurrences.length - 1 && e.to === entry(title).id)) {
    throw new Error("文件末尾的代码块或注释尚未闭合，请先在 Markdown 中补齐");
  }
  return text;
}
/** Preserve each return as a new occurrence rather than overwriting an earlier body. */
export function appendDocumentContinuation(markdown: string, from: string | undefined, to: string, body = "") {
  if (!from) return appendDocumentStep(markdown, to, body, true);
  let text = markdown;
  const visits = parseThoughtDocument(text).occurrences, last = visits[visits.length - 1];
  if (!last || last.id !== entry(from).id) text = appendDocumentStep(text, from, "", true);
  return appendDocumentStep(text, to, body);
}
/** Insert on one explicit incoming edge. Never assume adjacent rows are connected. */
export function insertDocumentStepBefore(markdown: string, index: number, title: string, parentID?: string) {
  const doc = parseThoughtDocument(markdown), visit = doc.occurrences[index];
  const incoming = doc.relations.filter(e => e.to === visit?.id && (parentID ? e.from === parentID : e.sourceIndex === index - 1));
  const edge = incoming[incoming.length - 1];
  if (!visit || !edge) throw new Error("当前节点没有父节点，无法在中间插入");
  const value = cleanNodeTitle(title);
  if (entry(value).target) throw new Error("请输入普通节点名称");
  if (doc.nodes.some(node => node.id === titleID(value))) throw new Error("已有同名节点，请为插入的新节点使用其他名称");
  const edits = [
    { start: edge.start, end: edge.end, text: "  → " + value + "\n" },
    { start: visit.start, end: visit.start, text: renderVisit(value, "", [occurrenceTitle(visit)]) },
  ];
  let next = markdown;
  for (const edit of edits.sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  const expected = doc.occurrences.map(v => v.id); expected.splice(index, 0, titleID(value));
  return verifyVisits(next, expected);
}

/** Rename definitions and local arrow targets, preserving every occurrence's body. */
export function updateDocumentNode(markdown: string, id: string, title: string, body: string | undefined, expected?: NodeEditSnapshot, allowMerge = false) {
  const doc = parseThoughtDocument(markdown), node = doc.nodes.find(node => node.id === id);
  if (!node) throw new Error("节点已不存在，请刷新后重试");
  const value = cleanNodeTitle(title);
  if (node.target) throw new Error("请在来源思考中编辑引用节点");
  if (entry(value).target) throw new Error("节点名称不能是完整的文件引用");
  if (!allowMerge && doc.nodes.some(other => other.id !== id && other.id === titleID(value))) throw new Error("这个名称已属于另一个节点，请使用其他名称；复用节点可在创建时输入它的名称");
  const occurrence = node.occurrences[expected?.ordinal ?? node.occurrences.length - 1];
  if (!occurrence || (expected && (node.title !== expected.title || occurrence.body !== expected.body
    || (expected.revision !== undefined && nodeRevision(node) !== expected.revision)))) throw new Error("节点已在其他位置修改，请重新打开编辑，避免覆盖内容");
  const edits: { start: number; end: number; text: string }[] = [];
  for (const visit of node.occurrences) {
    if (visit === occurrence && body !== undefined) {
      const targets = outgoing(doc, doc.occurrences.indexOf(visit)).map(target => entry(target).id === id ? value : target);
      edits.push({ start: visit.start, end: visit.end, text: renderVisit(value, body, targets) });
    } else {
      const line = markdown.slice(visit.start, visit.titleEnd);
      edits.push({ start: visit.start, end: visit.titleEnd, text: line.replace(visit.title, () => value) });
    }
  }
  for (const edge of doc.relations.filter(e => e.to === id)) {
    if (body !== undefined && edge.sourceIndex === doc.occurrences.indexOf(occurrence)) continue;
    edits.push({ start: edge.start, end: edge.end, text: markdown.slice(edge.start, edge.end).replace(edge.targetText!, () => value) });
  }
  let text = markdown;
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return verifyVisits(text, doc.occurrences.map(v => v.id === id ? titleID(value) : v.id));
}
export function removeDocumentRelation(markdown: string, matches: (from: string, to: string) => boolean) {
  let text = markdown;
  for (const edge of parseThoughtDocument(markdown).relations.filter(edge => matches(edge.from, edge.to)).sort((a, b) => b.start - a.start)) {
    text = text.slice(0, edge.start) + text.slice(edge.end);
  }
  return text;
}
/** Remove definitions and their incoming arrows, without joining former neighbors. */
export function removeDocumentNode(markdown: string, id: string) {
  const unlinked = removeDocumentRelation(markdown, (from, to) => from === id || to === id);
  let text = unlinked;
  for (const visit of parseThoughtDocument(unlinked).occurrences.filter(visit => visit.id === id).reverse()) text = text.slice(0, visit.start) + text.slice(visit.end);
  return text;
}
export function unlinkDocumentBody(markdown: string, nodeID: string, matches: (target: string, label?: string) => boolean) {
  let text = markdown;
  const doc = parseThoughtDocument(markdown), node = doc.nodes.find(node => node.id === nodeID);
  if (!node) return text;
  for (const visit of [...node.occurrences].reverse()) {
    let body = visit.body;
    const links = documentLinks(body).filter(link => matches(link.target, link.label)).reverse();
    if (!links.length) continue;
    for (const link of links) body = body.slice(0, link.start) + (link.label ?? link.target) + body.slice(link.end);
    text = text.slice(0, visit.start) + renderVisit(occurrenceTitle(visit), body, outgoing(doc, doc.occurrences.indexOf(visit))) + text.slice(visit.end);
  }
  return text;
}
export function wikiLink(target: string, title: string) {
  if (/[[\]\r\n|]/.test(target)) throw new Error("链接路径含有不支持的字符");
  return "[[" + target + "|" + title.replace(/[[\]|\r\n]/g, " ") + "]]";
}
