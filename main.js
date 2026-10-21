"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => BrainOSPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian8 = require("obsidian");

// src/graph-view.ts
var import_obsidian6 = require("obsidian");

// src/thoughts.ts
var import_obsidian2 = require("obsidian");

// src/graph-history.ts
var histories = /* @__PURE__ */ new WeakMap();
function graphHistory(app) {
  let history = histories.get(app);
  if (!history) {
    history = new GraphHistory(app);
    histories.set(app, history);
  }
  return history;
}
async function processGraphFile(app, file, edit) {
  let before = "", after = "";
  await app.vault.process(file, (current) => {
    before = current;
    after = edit(current);
    return after;
  });
  if (before !== after) graphHistory(app).track({ file, before, after });
}
var GraphHistory = class {
  constructor(app) {
    this.app = app;
    __publicField(this, "undoEntries", []);
    __publicField(this, "redoEntries", []);
    __publicField(this, "active");
    __publicField(this, "interrupted", false);
    __publicField(this, "queue", Promise.resolve());
  }
  serial(action) {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {
    });
    return next;
  }
  track(change) {
    var _a;
    if (!this.active) return;
    const previous = this.active.get(change.file.path);
    if (previous && previous.after !== change.before) this.interrupted = true;
    this.active.set(change.file.path, { ...change, before: (_a = previous == null ? void 0 : previous.before) != null ? _a : change.before });
  }
  record(action, state) {
    return this.serial(async () => {
      const before = state == null ? void 0 : state.capture();
      const changes = this.active = /* @__PURE__ */ new Map();
      this.interrupted = false;
      try {
        await action();
      } finally {
        this.active = void 0;
        const actual = [...changes.values()].filter((change) => change.before !== change.after);
        if (actual.length && !this.interrupted) {
          const after = state == null ? void 0 : state.capture();
          this.undoEntries.push({
            changes: actual,
            undoState: state ? () => state.restore(before, after) : void 0,
            redoState: state ? () => state.restore(after, before) : void 0
          });
          if (this.undoEntries.length > 50) this.undoEntries.shift();
          this.redoEntries = [];
        }
      }
    });
  }
  undo() {
    return this.move(this.undoEntries, this.redoEntries, false);
  }
  redo() {
    return this.move(this.redoEntries, this.undoEntries, true);
  }
  move(from, to, redo) {
    return this.serial(async () => {
      var _a, _b;
      const entry2 = from[from.length - 1];
      if (!entry2) return false;
      const expected = (change) => redo ? change.before : change.after;
      const replacement = (change) => redo ? change.after : change.before;
      for (const change of entry2.changes) {
        if (this.app.vault.getAbstractFileByPath(change.file.path) !== change.file || await this.app.vault.read(change.file) !== expected(change)) {
          throw new Error("\u76F8\u5173\u7B14\u8BB0\u5DF2\u5728\u5176\u4ED6\u4F4D\u7F6E\u4FEE\u6539\uFF0C\u65E0\u6CD5\u64A4\u9500\u6216\u91CD\u505A\uFF0C\u539F\u5185\u5BB9\u672A\u8986\u76D6");
        }
      }
      const applied = [];
      try {
        for (const change of entry2.changes) {
          await this.app.vault.process(change.file, (current) => {
            if (current !== expected(change)) throw new Error("\u7B14\u8BB0\u5DF2\u53D8\u5316\uFF0C\u65E0\u6CD5\u64A4\u9500\u6216\u91CD\u505A");
            return replacement(change);
          });
          applied.push(change);
        }
        await (redo ? (_a = entry2.redoState) == null ? void 0 : _a.call(entry2) : (_b = entry2.undoState) == null ? void 0 : _b.call(entry2));
      } catch (error) {
        for (const change of applied.reverse()) {
          await this.app.vault.process(change.file, (current) => current === replacement(change) ? expected(change) : current);
        }
        throw error;
      }
      from.pop();
      to.push(entry2);
      return true;
    });
  }
};

// src/thought-store.ts
var import_obsidian = require("obsidian");

// src/thought-scope.ts
function isThoughtFile(path, folder = "") {
  const normalized = folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
  if (normalized.split("/").some((part) => part === "." || part === "..")) return false;
  return path.endsWith(".md") && (!normalized || path.startsWith(normalized + "/"));
}

// src/thought-document.ts
var titleID = (title) => "name:" + title.trim();
var nodeKey = (file, id) => file + "#brainos=" + encodeURIComponent(id);
function splitNodeKey(key) {
  const index = key.lastIndexOf("#brainos=");
  if (index >= 0) {
    try {
      return { file: key.slice(0, index), id: decodeURIComponent(key.slice(index + 9)) };
    } catch (e) {
      return void 0;
    }
  }
  const legacy = key.lastIndexOf("#^");
  return legacy >= 0 ? { file: key.slice(0, legacy), id: key.slice(legacy + 2) } : void 0;
}
function markdownLines(text) {
  const result = [];
  let fence;
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
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = void 0;
    }
    const visible = raw.replace(/(\x60+).*?\1/g, "");
    if (!fence && visible.includes("<!--")) comment = !visible.includes("-->", visible.indexOf("<!--") + 4);
    else if (comment && raw.includes("-->")) comment = false;
    result.push({ text: raw, start: match.index, end: match.index + match[0].length, code });
  }
  return result;
}
function documentLinks(text, offset = 0) {
  const links = [];
  for (const line of markdownLines(text)) {
    if (line.code || /^(?: {4}|\t)/.test(line.text)) continue;
    const visible = line.text.replace(/(\x60+).*?\1/g, (value) => " ".repeat(value.length)).replace(/<!--.*?-->/g, (value) => " ".repeat(value.length));
    for (const match of visible.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
      const [target, ...alias] = match[1].split("|");
      const start = offset + line.start + match.index;
      links.push({
        target: target.trim(),
        ...alias.length ? { label: alias.join("|") } : {},
        start,
        end: start + match[0].length,
        original: text.slice(line.start + match.index, line.start + match.index + match[0].length)
      });
    }
    for (const match of visible.matchAll(/!?\[([^\]\n]*)\]\(([^\s)]+)(?:\s+"[^"\n]*")?\)/g)) {
      if (match.index > 0 && visible[match.index - 1] === "[") continue;
      let target;
      try {
        target = decodeURIComponent(match[2].replace(/^<|>$/g, ""));
      } catch (e) {
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const start = offset + line.start + match.index;
      links.push({
        target,
        label: match[1],
        start,
        end: start + match[0].length,
        original: text.slice(line.start + match.index, line.start + match.index + match[0].length)
      });
    }
  }
  return links.sort((a, b) => a.start - b.start);
}
function entry(title) {
  const value = title.trim(), links = documentLinks(value);
  if (links.length === 1 && links[0].start === 0 && links[0].end === value.length) {
    const { target, label } = links[0];
    return { id: "reference:" + JSON.stringify([target, label != null ? label : ""]), title: label || target, target, referenceLabel: label };
  }
  return { id: titleID(value), title: value };
}
function unindentBody(text) {
  return text.replace(/^\s*\n/, "").trimEnd().split("\n").map((line) => line.startsWith("  ") ? line.slice(2) : line.startsWith("	") ? line.slice(1) : line).join("\n");
}
function parseThoughtDocument(markdown) {
  const nodes = /* @__PURE__ */ new Map();
  const occurrences = [], paths = [], relations = [];
  let path = [];
  let pending;
  const finish = (end) => {
    var _a;
    if (!pending) return;
    const value = entry(pending.text.slice(2));
    let node = nodes.get(value.id);
    const occurrence = {
      ...value,
      body: unindentBody(markdown.slice(pending.end, end)),
      start: pending.start,
      titleEnd: pending.end,
      end,
      path: paths.length,
      ordinal: (_a = node == null ? void 0 : node.occurrences.length) != null ? _a : 0
    };
    occurrences.push(occurrence);
    if (!node) {
      node = { ...value, body: occurrence.body, start: occurrence.start, end, occurrences: [] };
      nodes.set(value.id, node);
    }
    node.occurrences.push(occurrence);
    node.body = occurrence.body;
    const previous = path[path.length - 1];
    if (previous) relations.push({ from: previous.id, to: occurrence.id, start: occurrence.start, end: occurrence.titleEnd });
    path.push(occurrence);
    pending = void 0;
  };
  for (const line of markdownLines(markdown)) {
    if (line.code) continue;
    if (/^---[ \t]*$/.test(line.text)) {
      finish(line.start);
      if (path.length) paths.push(path);
      path = [];
    } else if (/^- \S/.test(line.text)) {
      finish(line.start);
      pending = line;
    }
  }
  finish(markdown.length);
  if (path.length) paths.push(path);
  return { nodes: [...nodes.values()], occurrences, paths, relations };
}
function nodeRevision(node) {
  return JSON.stringify(node.occurrences.map((occurrence) => [occurrence.title, occurrence.body]));
}
function cleanNodeTitle(title) {
  if (/[\r\n]/.test(title)) throw new Error("\u8282\u70B9\u540D\u79F0\u53EA\u80FD\u5360\u4E00\u884C");
  const value = title.trim();
  if (!value) throw new Error("\u8282\u70B9\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
  return value;
}
function renderOccurrence(title, body = "") {
  const value = body.replace(/\r\n/g, "\n").trimEnd();
  return "- " + cleanNodeTitle(title) + "\n" + (value ? value.split("\n").map((line) => line ? "  " + line : "").join("\n") + "\n" : "");
}
function occurrenceTitle(node) {
  return node.target ? node.referenceLabel === void 0 ? "[[" + node.target + "]]" : wikiLink(node.target, node.referenceLabel) : node.title;
}
function appendDocumentStep(markdown, title, body = "", newPath = false) {
  var _a;
  const before = markdown.trimEnd(), doc = parseThoughtDocument(markdown);
  const separator = newPath && doc.occurrences.length && !/^---[ \t]*$/.test((_a = before.split("\n").pop()) != null ? _a : "");
  const next = (before ? before + (separator ? "\n\n---\n\n" : "\n") : "") + renderOccurrence(title, body);
  if (parseThoughtDocument(next).occurrences.length !== doc.occurrences.length + 1) throw new Error("\u6587\u4EF6\u672B\u5C3E\u7684\u4EE3\u7801\u5757\u6216\u6CE8\u91CA\u5C1A\u672A\u95ED\u5408\uFF0C\u8BF7\u5148\u5728 Markdown \u4E2D\u8865\u9F50");
  return next;
}
function appendDocumentContinuation(markdown, from, to, body = "") {
  if (!from) return appendDocumentStep(markdown, to, body, true);
  let text = markdown;
  const visits = parseThoughtDocument(text).occurrences, last = visits[visits.length - 1];
  if (!last || last.id !== entry(from).id || last.end < text.length) {
    text = appendDocumentStep(text, from, "", true);
  }
  return appendDocumentStep(text, to, body);
}
function insertDocumentStepBefore(markdown, index, title) {
  const doc = parseThoughtDocument(markdown), visit = doc.occurrences[index], previous = doc.occurrences[index - 1];
  if (!visit || !previous || previous.path !== visit.path) throw new Error("\u5F53\u524D\u8282\u70B9\u6CA1\u6709\u7236\u8282\u70B9\uFF0C\u65E0\u6CD5\u5728\u4E2D\u95F4\u63D2\u5165");
  const value = cleanNodeTitle(title), parsed = parseThoughtDocument(renderOccurrence(value));
  if (parsed.nodes.length !== 1 || parsed.nodes[0].target) throw new Error("\u8BF7\u8F93\u5165\u666E\u901A\u8282\u70B9\u540D\u79F0");
  if (doc.nodes.some((node) => node.id === titleID(value))) throw new Error("\u5DF2\u6709\u540C\u540D\u8282\u70B9\uFF0C\u8BF7\u4E3A\u63D2\u5165\u7684\u65B0\u8282\u70B9\u4F7F\u7528\u5176\u4ED6\u540D\u79F0");
  const next = markdown.slice(0, visit.start) + renderOccurrence(value) + markdown.slice(visit.start);
  const result = parseThoughtDocument(next), inserted = result.occurrences[index];
  const retained = result.occurrences.filter((_, ordinal) => ordinal !== index);
  const signature = (visits) => JSON.stringify(visits.map((item) => [item.id, item.body, item.path]));
  if (result.occurrences.length !== doc.occurrences.length + 1 || (inserted == null ? void 0 : inserted.id) !== titleID(value) || signature(retained) !== signature(doc.occurrences)) throw new Error("\u5F53\u524D\u8DEF\u5F84\u65E0\u6CD5\u5B89\u5168\u63D2\u5165\u8282\u70B9\uFF0C\u8BF7\u5148\u68C0\u67E5 Markdown \u4E2D\u7684\u4EE3\u7801\u5757\u6216\u6CE8\u91CA");
  return next;
}
function updateDocumentNode(markdown, id, title, body, expected, allowMerge = false) {
  var _a;
  const doc = parseThoughtDocument(markdown), node = doc.nodes.find((node2) => node2.id === id);
  if (!node) throw new Error("\u8282\u70B9\u5DF2\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  const value = cleanNodeTitle(title);
  if (node.target) throw new Error("\u8BF7\u5728\u6765\u6E90\u601D\u8003\u4E2D\u7F16\u8F91\u5F15\u7528\u8282\u70B9");
  if (entry(value).target) throw new Error("\u8282\u70B9\u540D\u79F0\u4E0D\u80FD\u662F\u5B8C\u6574\u7684\u6587\u4EF6\u5F15\u7528");
  if (!allowMerge && doc.nodes.some((other) => other.id !== id && other.id === titleID(value))) throw new Error("\u8FD9\u4E2A\u540D\u79F0\u5DF2\u5C5E\u4E8E\u53E6\u4E00\u4E2A\u8282\u70B9\uFF0C\u8BF7\u4F7F\u7528\u5176\u4ED6\u540D\u79F0\uFF1B\u590D\u7528\u8282\u70B9\u53EF\u5728\u521B\u5EFA\u65F6\u8F93\u5165\u5B83\u7684\u540D\u79F0");
  const occurrence = node.occurrences[(_a = expected == null ? void 0 : expected.ordinal) != null ? _a : node.occurrences.length - 1];
  if (!occurrence || expected && (node.title !== expected.title || occurrence.body !== expected.body || expected.revision !== void 0 && nodeRevision(node) !== expected.revision)) {
    throw new Error("\u8282\u70B9\u5DF2\u5728\u5176\u4ED6\u4F4D\u7F6E\u4FEE\u6539\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u7F16\u8F91\uFF0C\u907F\u514D\u8986\u76D6\u5185\u5BB9");
  }
  let text = markdown;
  for (const visit of [...node.occurrences].reverse()) {
    const rendered = visit === occurrence && body !== void 0 ? renderOccurrence(value, body) + "\n" : "- " + value + markdown.slice(visit.start + 2 + visit.title.length, visit.end);
    text = text.slice(0, visit.start) + rendered + text.slice(visit.end);
  }
  const expectedIDs = doc.occurrences.map((visit) => visit.id === id ? titleID(value) : visit.id);
  if (JSON.stringify(parseThoughtDocument(text).occurrences.map((visit) => visit.id)) !== JSON.stringify(expectedIDs)) {
    throw new Error("\u6B63\u6587\u4E2D\u7684\u4EE3\u7801\u5757\u6216\u6CE8\u91CA\u5C1A\u672A\u95ED\u5408\uFF0C\u4F1A\u906E\u853D\u540E\u7EED\u8BB0\u5F55\uFF0C\u8BF7\u5148\u8865\u9F50");
  }
  return text;
}
function removeDocumentRelation(markdown, matches) {
  let text = markdown;
  for (const edge of parseThoughtDocument(markdown).relations.filter((edge2) => matches(edge2.from, edge2.to)).reverse()) {
    text = text.slice(0, edge.start).trimEnd() + "\n\n---\n\n" + text.slice(edge.start);
  }
  return text;
}
function removeDocumentNode(markdown, id) {
  let text = markdown;
  for (const visit of parseThoughtDocument(markdown).occurrences.filter((visit2) => visit2.id === id).reverse()) {
    text = text.slice(0, visit.start) + "---\n\n" + text.slice(visit.end);
  }
  return text;
}
function unlinkDocumentBody(markdown, nodeID, matches) {
  var _a;
  let text = markdown;
  const node = parseThoughtDocument(markdown).nodes.find((node2) => node2.id === nodeID);
  if (!node) return text;
  for (const visit of [...node.occurrences].reverse()) {
    let body = visit.body;
    const links = documentLinks(body).filter((link) => matches(link.target, link.label)).reverse();
    if (!links.length) continue;
    for (const link of links) body = body.slice(0, link.start) + ((_a = link.label) != null ? _a : link.target) + body.slice(link.end);
    text = text.slice(0, visit.start) + renderOccurrence(occurrenceTitle(visit), body) + "\n" + text.slice(visit.end);
  }
  return text;
}
function wikiLink(target, title) {
  if (/[\[\]\r\n|]/.test(target)) throw new Error("\u94FE\u63A5\u8DEF\u5F84\u542B\u6709\u4E0D\u652F\u6301\u7684\u5B57\u7B26");
  return "[[" + target + "|" + title.replace(/[\[\]|\r\n]/g, " ") + "]]";
}

// src/legacy-thought-document.ts
function markdownLines2(text) {
  const result = [];
  let fence;
  for (const match of text.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!match[0]) continue;
    const raw = match[0].replace(/\r?\n$/, "");
    const marker = raw.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    const code = !!fence || !!marker;
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = void 0;
    }
    result.push({ text: raw, start: match.index, end: match.index + match[0].length, code });
  }
  return result;
}
function documentLinks2(text, offset = 0) {
  const links = [];
  let comment = false;
  for (const line of markdownLines2(text)) {
    if (line.code) continue;
    const hidden = line.text.startsWith("<!--") || comment;
    if (line.text.includes("<!--")) comment = true;
    if (line.text.includes("-->")) comment = false;
    if (hidden) continue;
    const visible = line.text.replace(/(`+).*?\1/g, (value) => " ".repeat(value.length));
    for (const match of visible.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
      const [target, ...alias] = match[1].split("|");
      const start = offset + line.start + match.index;
      links.push({
        target: target.trim(),
        ...alias.length ? { label: alias.join("|") } : {},
        start,
        end: start + match[0].length,
        original: text.slice(line.start + match.index, line.start + match.index + match[0].length)
      });
    }
    for (const match of visible.matchAll(/!?\[([^\]\n]*)\]\(([^\s)]+)(?:\s+"[^"\n]*")?\)/g)) {
      if (match.index > 0 && visible[match.index - 1] === "[") continue;
      let target;
      try {
        target = decodeURIComponent(match[2].replace(/^<|>$/g, ""));
      } catch (e) {
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const start = offset + line.start + match.index;
      links.push({ target, label: match[1], start, end: start + match[0].length, original: text.slice(line.start + match.index, line.start + match.index + match[0].length) });
    }
  }
  return links.sort((a, b) => a.start - b.start);
}
function parseThoughtDocument2(markdown) {
  var _a, _b, _c, _d;
  const lines = markdownLines2(markdown);
  const headings = lines.filter((line) => !line.code && /^## (节点|引用|关系)\s*$/.test(line.text));
  const sections = {};
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index], name = heading.text.trim().slice(3);
    if (sections[name]) throw new Error(`\u601D\u8003\u6587\u4EF6\u4E2D\u6709\u591A\u4E2A\u300C${name}\u300D\u533A\u57DF\uFF0C\u8BF7\u5148\u5408\u5E76\uFF0C\u539F\u6587\u672A\u4FEE\u6539`);
    sections[name] = { start: heading.start, content: heading.end, end: (_b = (_a = headings[index + 1]) == null ? void 0 : _a.start) != null ? _b : markdown.length };
  }
  const nodes = [];
  const region = sections.\u8282\u70B9;
  if (region) {
    const occurrences = /* @__PURE__ */ new Map();
    const titles = lines.filter((line) => !line.code && line.start >= region.content && line.start < region.end).flatMap((line) => {
      var _a2;
      const block = line.text.match(/^\*\*(.+)\*\* \^([A-Za-z0-9-]+)\s*$/);
      if (block) return [{ line, title: block[1].replace(/\\([\\*])/g, "$1"), id: block[2], needsAnchor: false }];
      const heading = line.text.match(/^\*\*(.+)\*\*\s*$/);
      if (!heading) return [];
      const title = heading[1].replace(/\\([\\*])/g, "$1"), count = ((_a2 = occurrences.get(title)) != null ? _a2 : 0) + 1;
      occurrences.set(title, count);
      let hash2 = 2166136261;
      for (let index = 0; index < title.length; index++) hash2 = Math.imul(hash2 ^ title.charCodeAt(index), 16777619);
      return [{ line, title, id: `node-draft-${(hash2 >>> 0).toString(16)}-${count}`, needsAnchor: true }];
    });
    const ids = /* @__PURE__ */ new Set();
    for (let index = 0; index < titles.length; index++) {
      const { line, id, title, needsAnchor } = titles[index];
      if (ids.has(id)) throw new Error(`\u8282\u70B9\u6807\u8BC6\u91CD\u590D\uFF1A${id}\uFF0C\u539F\u6587\u672A\u4FEE\u6539`);
      ids.add(id);
      const end = (_d = (_c = titles[index + 1]) == null ? void 0 : _c.line.start) != null ? _d : region.end;
      nodes.push({ id, title, needsAnchor, body: markdown.slice(line.end, end).replace(/^\s*\n/, "").trimEnd(), start: line.start, end });
    }
  }
  const relations = [];
  const links = sections.\u5173\u7CFB;
  if (links) for (const line of lines.filter((line2) => !line2.code && line2.start >= links.content && line2.start < links.end)) {
    const match = line.text.match(/^\s*- (\[\[[^\n]+?\]\]) → (\[\[[^\n]+?\]\])\s*$/);
    if (!match) continue;
    const pair = documentLinks2(line.text);
    if (pair.length === 2) relations.push({ from: pair[0].target, to: pair[1].target, start: line.start, end: line.end });
  }
  const references = sections.\u5F15\u7528 ? documentLinks2(markdown.slice(sections.\u5F15\u7528.content, sections.\u5F15\u7528.end), sections.\u5F15\u7528.content) : [];
  return { nodes, relations, references, sections };
}

// src/thought-migration.ts
function stripBrainOSProperties(markdown) {
  const header = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!header || !/^brainos_type:\s*thought-file\s*$/m.test(header[1])) return markdown;
  const owned = /^(brainos_type|brainos_version|id|title|created_at|updated_at|status|source):/;
  let skipping = false;
  const remaining = header[1].split(/\r?\n/).filter((line) => {
    if (/^\S/.test(line)) skipping = owned.test(line);
    return !skipping;
  }).join("\n").trim();
  return (remaining ? "---\n" + remaining + "\n---\n\n" : "") + markdown.slice(header[0].length).trimStart();
}
function uniqueLegacyTitle(title, used) {
  const base = title.trim().replace(/[\r\n]+/g, " ") || "\u672A\u547D\u540D\u8282\u70B9";
  let value = base, number = 2;
  while (used.has(value)) value = base + "\uFF08" + number++ + "\uFF09";
  used.add(value);
  return value;
}
function convertParagraphThought(original) {
  var _a, _b, _c;
  if (!markdownLines(original).some((line) => !line.code && /^## 节点\s*$/.test(line.text))) return void 0;
  const doc = parseThoughtDocument2(original);
  if (!doc.sections.\u8282\u70B9) return void 0;
  const used = /* @__PURE__ */ new Set(), aliases = /* @__PURE__ */ new Map();
  for (const node of doc.nodes) aliases.set(node.id, uniqueLegacyTitle(node.title, used));
  const localName = (target) => {
    var _a2, _b2;
    return target.startsWith("#^") ? aliases.get(target.slice(2)) : target.startsWith("#") ? aliases.get((_b2 = (_a2 = doc.nodes.find((node) => node.title === target.slice(1))) == null ? void 0 : _a2.id) != null ? _b2 : "") : void 0;
  };
  const step = (target, label) => {
    var _a2;
    return (_a2 = localName(target)) != null ? _a2 : wikiLink(target, label != null ? label : target);
  };
  let markdown = stripBrainOSProperties(original.slice(0, doc.sections.\u8282\u70B9.start)).trimEnd();
  const introduction = original.slice(doc.sections.\u8282\u70B9.content, (_b = (_a = doc.nodes[0]) == null ? void 0 : _a.start) != null ? _b : doc.sections.\u8282\u70B9.end).trim();
  if (introduction) markdown += "\n\n" + introduction + "\n";
  for (const node of doc.nodes) {
    let body = node.body;
    for (const link of documentLinks(body).reverse()) {
      const title = localName(link.target);
      if (title) body = body.slice(0, link.start) + wikiLink("#" + title, (_c = link.label) != null ? _c : title) + body.slice(link.end);
    }
    markdown = appendDocumentStep(markdown, aliases.get(node.id), body, true);
  }
  for (const reference of doc.references) markdown = appendDocumentStep(markdown, step(reference.target, reference.label), "", true);
  for (const relation of doc.relations) {
    markdown = appendDocumentStep(markdown, step(relation.from), "", true);
    markdown = appendDocumentStep(markdown, step(relation.to));
  }
  for (const [name, section] of Object.entries(doc.sections)) {
    if (name === "\u8282\u70B9" || !section) continue;
    let prose = original.slice(section.content, section.end);
    const structural = name === "\u5173\u7CFB" ? doc.relations : doc.references;
    for (const span of [...structural].sort((a, b) => b.start - a.start)) {
      const start = span.start - section.content, end = span.end - section.content;
      prose = prose.slice(0, start) + prose.slice(end);
    }
    prose = prose.replace(/^\s*-\s*$/gm, "").trim();
    if (prose) markdown += "\n\n" + prose + "\n";
  }
  return { markdown, aliases };
}

// src/thought-store.ts
var LEGACY_STATE = /<!--\s*brainos-state\s*\n[\s\S]*?\n-->/;
function requireFile(app, path) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof import_obsidian.TFile) || file.extension !== "md") throw new Error("\u601D\u8003\u6587\u4EF6\u5DF2\u4E0D\u5B58\u5728");
  return file;
}
async function loadThoughtDocument(app, file, folder) {
  var _a, _b, _c, _d, _e, _f;
  const original = await app.vault.cachedRead(file);
  const paragraphs = convertParagraphThought(original);
  if (paragraphs) return { original, ...paragraphs, doc: parseThoughtDocument(paragraphs.markdown), legacy: true };
  const state = parseThoughtState(original), aliases = /* @__PURE__ */ new Map();
  if (LEGACY_STATE.test(original) && !state) throw new Error("\u65E7\u601D\u8003\u72B6\u6001\u635F\u574F\uFF0C\u539F\u6587\u4EF6\u672A\u4FEE\u6539");
  if (!state) return { original, markdown: original, doc: parseThoughtDocument(original), legacy: false, aliases };
  let markdown = stripBrainOSProperties(original.replace(LEGACY_STATE, "")).trimEnd();
  if ((_a = state.draft) == null ? void 0 : _a.trim()) markdown += "\n\n" + state.draft.trim() + "\n";
  const byLegacyID = new Map(app.vault.getMarkdownFiles().filter((file2) => folder === void 0 || isThoughtFile(file2.path, folder)).flatMap((atom) => {
    var _a2, _b2;
    const id = (_b2 = (_a2 = app.metadataCache.getFileCache(atom)) == null ? void 0 : _a2.frontmatter) == null ? void 0 : _b2.brainos_id;
    return id == null ? [] : [[String(id).toLowerCase(), atom]];
  }));
  const imported = /* @__PURE__ */ new Map(), used = /* @__PURE__ */ new Set();
  for (const path of (_b = state.paths) != null ? _b : []) {
    let newPath = true;
    for (const step of (_c = path.steps) != null ? _c : []) {
      const key = stepKey(step);
      if (!key) {
        newPath = true;
        continue;
      }
      const direct = app.vault.getAbstractFileByPath(key);
      const atom = direct instanceof import_obsidian.TFile ? direct : (_d = byLegacyID.get(key.toLowerCase())) != null ? _d : app.metadataCache.getFirstLinkpathDest(key, file.path);
      if (atom && folder !== void 0 && !isThoughtFile(atom.path, folder)) continue;
      const identity = (_e = atom == null ? void 0 : atom.path) != null ? _e : key, known = imported.get(identity);
      const title = known != null ? known : uniqueLegacyTitle((_f = atom == null ? void 0 : atom.basename) != null ? _f : key, used);
      imported.set(identity, title);
      const body = known ? "" : atom && atom.path !== file.path ? await app.vault.cachedRead(atom) : atom ? "" : "\u539F\u8282\u70B9\u5F15\u7528\uFF1A" + key;
      markdown = appendDocumentStep(markdown, title, body, newPath);
      newPath = false;
    }
  }
  return { original, markdown, doc: parseThoughtDocument(markdown), legacy: true, aliases };
}
async function mutateThought(app, filePath, edit) {
  const file = requireFile(app, filePath), loaded = await loadThoughtDocument(app, file);
  await processGraphFile(app, file, (current) => {
    if (loaded.legacy && current !== loaded.original) throw new Error("\u65E7\u601D\u8003\u5728\u8F6C\u6362\u671F\u95F4\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
    if (!loaded.legacy && (LEGACY_STATE.test(current) || convertParagraphThought(current))) throw new Error("\u601D\u8003\u683C\u5F0F\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
    const next = edit(loaded.legacy ? loaded.markdown : current, loaded);
    parseThoughtDocument(next);
    return next;
  });
  if (loaded.legacy && loaded.aliases.size) await migrateIncomingAnchors(app, filePath, loaded.aliases);
}
async function migrateIncomingAnchors(app, source, aliases) {
  const rewrite = (markdown, owner) => {
    var _a, _b;
    let next = markdown;
    for (const link of documentLinks(markdown).reverse()) {
      const target = referenceFile(app, owner, link.target);
      const title = target.anchor.startsWith("^") ? aliases.get(target.anchor.slice(1)) : void 0;
      if (((_a = target.file) == null ? void 0 : _a.path) !== source || !title) continue;
      next = next.slice(0, link.start) + wikiLink(target.rawPath + "#" + title, (_b = link.label) != null ? _b : title) + next.slice(link.end);
    }
    return next;
  };
  for (const file of app.vault.getMarkdownFiles()) {
    const before = await app.vault.cachedRead(file);
    if (rewrite(before, file.path) !== before) await processGraphFile(app, file, (current) => rewrite(current, file.path));
  }
}
function findNode(loaded, id) {
  var _a;
  return (_a = loaded.doc.nodes.find((node) => node.id === id)) != null ? _a : loaded.doc.nodes.find((node) => {
    var _a2;
    return node.id === titleID((_a2 = loaded.aliases.get(id)) != null ? _a2 : "");
  });
}
function referenceFile(app, owner, target) {
  const hash2 = target.indexOf("#"), rawPath = hash2 >= 0 ? target.slice(0, hash2) : target;
  const anchor = hash2 >= 0 ? target.slice(hash2 + 1) : "";
  const direct = app.vault.getAbstractFileByPath(rawPath || owner);
  const file = direct instanceof import_obsidian.TFile ? direct : app.metadataCache.getFirstLinkpathDest(rawPath, owner);
  return { file: file instanceof import_obsidian.TFile ? file : void 0, anchor, rawPath };
}
async function resolveTarget(app, owner, target, label, read = (file) => loadThoughtDocument(app, file), nodeReference = false) {
  const { file, anchor } = referenceFile(app, owner, target);
  if ((file == null ? void 0 : file.extension) === "md") {
    const loaded = await read(file);
    let node;
    if (anchor.startsWith("^")) node = findNode(loaded, anchor.slice(1));
    else if (anchor) node = loaded.doc.nodes.find((node2) => !node2.target && node2.title === anchor);
    else if (label && nodeReference) node = loaded.doc.nodes.find((node2) => !node2.target && node2.title === label);
    if (!node && anchor.startsWith("^") && label) node = loaded.doc.nodes.find((node2) => !node2.target && node2.title === label);
    if (node) return { key: nodeKey(file.path, node.id), file, node };
  }
  const name = nodeReference && label && !anchor ? "#brainos=" + encodeURIComponent(titleID(label)) : "";
  return { key: file ? file.path + (anchor ? "#" + anchor : name) : target + name, file, anchor, nodeReference };
}
async function readThoughtNode(app, key, ordinal) {
  const ref = splitNodeKey(key);
  if (!ref) throw new Error("\u8BF7\u9009\u62E9\u601D\u8003\u6587\u4EF6\u4E2D\u7684\u8282\u70B9");
  const file = requireFile(app, ref.file), loaded = await loadThoughtDocument(app, file);
  const node = findNode(loaded, ref.id);
  if (!node || node.target) throw new Error("\u6765\u6E90\u8282\u70B9\u5DF2\u4E0D\u5B58\u5728");
  const visit = node.occurrences[ordinal != null ? ordinal : node.occurrences.length - 1];
  if (!visit) throw new Error("\u8FD9\u6B21\u8BB0\u5F55\u5DF2\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
  return { file, occurrences: node.occurrences, node: {
    ...node,
    body: visit.body,
    start: visit.start,
    ordinal: visit.ordinal,
    revision: nodeRevision(node)
  } };
}
function graphEntry(owner, node, markdown) {
  const ref = splitNodeKey(node.path);
  if ((ref == null ? void 0 : ref.file) === owner || node.ownerPath === owner) {
    const found = parseThoughtDocument(markdown).nodes.find((value) => value.id === (ref == null ? void 0 : ref.id));
    if (!found || found.target) throw new Error("\u8D77\u70B9\u8282\u70B9\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
    return found.title;
  }
  if (!node.ownerPath) throw new Error("\u6765\u6E90\u8282\u70B9\u5DF2\u4E0D\u5B58\u5728");
  return wikiLink(node.ownerPath, node.label);
}
async function createThoughtNode(app, owner, title, body = "", parent) {
  var _a;
  const value = cleanNodeTitle(title);
  if ((_a = parseThoughtDocument("- " + value).nodes[0]) == null ? void 0 : _a.target) throw new Error("\u8282\u70B9\u540D\u79F0\u4E0D\u80FD\u662F\u5B8C\u6574\u7684\u6587\u4EF6\u5F15\u7528\uFF0C\u8BF7\u4F7F\u7528\u5F15\u7528\u5DF2\u6709\u8282\u70B9");
  await mutateThought(app, owner, (markdown, loaded) => {
    let from;
    if (parent) {
      const ref = splitNodeKey(parent.key);
      const actual = (ref == null ? void 0 : ref.file) === owner ? findNode({ ...loaded, doc: parseThoughtDocument(markdown) }, ref.id) : void 0;
      from = actual ? occurrenceTitle(actual) : graphEntry(owner, { path: parent.key, label: parent.title, ownerPath: ref == null ? void 0 : ref.file }, markdown);
    }
    if (from && (parent == null ? void 0 : parent.newPath)) return appendDocumentStep(appendDocumentStep(markdown, from, "", true), value, body);
    return appendDocumentContinuation(markdown, from, value, body);
  });
  return nodeKey(owner, titleID(value));
}
async function insertThoughtNode(app, owner, title, target) {
  const keys = await referenceKeys(app, owner);
  await mutateThought(app, owner, (markdown) => {
    const visits = parseThoughtDocument(markdown).occurrences;
    const matches = visits.flatMap((visit, index2) => keys.entry(visit.id) === target.child && visit.ordinal === target.ordinal ? [index2] : []);
    if (matches.length !== 1) throw new Error("\u5F53\u524D\u8282\u70B9\u7684\u8BB0\u5F55\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
    const index = matches[0], previous = visits[index - 1];
    if (!previous || previous.path !== visits[index].path || keys.entry(previous.id) !== target.parent) {
      throw new Error("\u7236\u8282\u70B9\u6216\u8DEF\u5F84\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
    }
    return insertDocumentStepBefore(markdown, index, title);
  });
  return nodeKey(owner, titleID(cleanNodeTitle(title)));
}
async function editThoughtNode(app, key, title, body, expected, allowMerge = false) {
  const ref = splitNodeKey(key);
  if (!ref) throw new Error("\u8BF7\u9009\u62E9\u601D\u8003\u6587\u4EF6\u4E2D\u7684\u8282\u70B9");
  const value = cleanNodeTitle(title);
  let oldTitle = "";
  await mutateThought(app, ref.file, (text, loaded) => {
    const actual = findNode({ ...loaded, doc: parseThoughtDocument(text) }, ref.id);
    if (!actual) throw new Error("\u8282\u70B9\u5DF2\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
    oldTitle = actual.title;
    return updateDocumentNode(text, actual.id, value, body, expected, allowMerge);
  });
  if (oldTitle !== value) await renameIncomingReferences(app, ref.file, oldTitle, value);
  return nodeKey(ref.file, titleID(value));
}
async function renameIncomingReferences(app, source, oldTitle, title) {
  const rewrite = (markdown, owner) => {
    var _a;
    let next = markdown;
    for (const link of documentLinks(markdown).reverse()) {
      const target = referenceFile(app, owner, link.target);
      if (((_a = target.file) == null ? void 0 : _a.path) !== source) continue;
      let path = link.target, label = link.label;
      if (target.anchor === oldTitle || target.anchor.startsWith("^") && label === oldTitle) {
        path = target.rawPath + "#" + title;
        if (label === oldTitle) label = title;
      } else if (!target.anchor && label === oldTitle) label = title;
      else continue;
      next = next.slice(0, link.start) + wikiLink(path, label != null ? label : title) + next.slice(link.end);
    }
    return next;
  };
  for (const file of app.vault.getMarkdownFiles()) {
    const before = await app.vault.cachedRead(file);
    if (rewrite(before, file.path) === before) continue;
    await processGraphFile(app, file, (current) => rewrite(current, file.path));
  }
}
async function linkThoughtNodes(app, owner, from, to) {
  await mutateThought(app, owner, (text) => appendDocumentContinuation(text, graphEntry(owner, from, text), graphEntry(owner, to, text)));
}
async function referenceThoughtNode(app, owner, node, parent, newPath = false) {
  if (!node.nodeId || !node.ownerPath) throw new Error("\u8BF7\u9009\u62E9\u601D\u8003\u6587\u4EF6\u4E2D\u7684\u8282\u70B9");
  await readThoughtNode(app, node.path);
  await mutateThought(app, owner, (text) => {
    const from = parent ? graphEntry(owner, parent, text) : void 0, to = graphEntry(owner, node, text);
    if (from && newPath) return appendDocumentStep(appendDocumentStep(text, from, "", true), to);
    return appendDocumentContinuation(text, from, to);
  });
}
async function referenceKeys(app, owner) {
  const doc = (await loadThoughtDocument(app, requireFile(app, owner))).doc;
  const entries = /* @__PURE__ */ new Map(), links = /* @__PURE__ */ new Map();
  for (const node of doc.nodes) {
    entries.set(node.id, node.target ? (await resolveTarget(app, owner, node.target, node.referenceLabel, void 0, node.referenceLabel !== void 0)).key : nodeKey(owner, node.id));
    for (const visit of node.occurrences) for (const link of documentLinks(visit.body)) {
      links.set(JSON.stringify([link.target, link.label]), (await resolveTarget(app, owner, link.target, link.label)).key);
    }
  }
  return {
    entry: (id) => {
      var _a;
      return (_a = entries.get(id)) != null ? _a : nodeKey(owner, id);
    },
    link: (target, label) => links.get(JSON.stringify([target, label]))
  };
}
async function unlinkThoughtNodes(app, owner, from, to, bidirectional = false) {
  const keys = await referenceKeys(app, owner);
  await mutateThought(app, owner, (text) => {
    const matches = (a, b) => a === from && b === to || bidirectional && a === to && b === from;
    let next = removeDocumentRelation(text, (a, b) => matches(keys.entry(a), keys.entry(b)));
    for (const node of parseThoughtDocument(next).nodes.filter((node2) => keys.entry(node2.id) === from || bidirectional && keys.entry(node2.id) === to)) {
      next = unlinkDocumentBody(next, node.id, (target, label) => matches(keys.entry(node.id), keys.link(target, label)));
    }
    return next;
  });
}
async function removeThoughtNode(app, owner, key) {
  return removeThoughtNodes(app, owner, [key]);
}
async function removeThoughtNodes(app, owner, selected) {
  const keys = await referenceKeys(app, owner), removed = new Set(selected);
  await mutateThought(app, owner, (text) => {
    let next = text;
    for (const node of parseThoughtDocument(next).nodes.filter((node2) => removed.has(keys.entry(node2.id)))) next = removeDocumentNode(next, node.id);
    for (const node of parseThoughtDocument(next).nodes) next = unlinkDocumentBody(next, node.id, (target, label) => {
      var _a;
      return removed.has((_a = keys.link(target, label)) != null ? _a : "");
    });
    return next;
  });
}
async function buildThoughtSnapshot(app, thoughtFile, folder) {
  var _a, _b;
  const nodes = /* @__PURE__ */ new Map(), edges = /* @__PURE__ */ new Map();
  const thoughts = [], steps = [];
  const loaded = /* @__PURE__ */ new Map();
  const read = (file) => {
    if (!loaded.has(file.path)) loaded.set(file.path, loadThoughtDocument(app, file, folder));
    return loaded.get(file.path);
  };
  const addNode = (file, node, owner) => {
    const key = nodeKey(file.path, node.id);
    let value = nodes.get(key);
    if (!value) {
      value = {
        path: key,
        openPath: file.path,
        label: node.title,
        ownerPath: file.path,
        nodeId: node.id,
        x: NaN,
        y: NaN,
        degree: 0,
        thoughts: [],
        kind: "note"
      };
      nodes.set(key, value);
    }
    if (!value.thoughts.includes(owner)) value.thoughts.push(owner);
    return key;
  };
  const resolve = async (owner, target, label, nodeReference = false) => {
    var _a2, _b2;
    if (folder !== void 0) {
      const destination = referenceFile(app, owner, target).file;
      if (!destination || !isThoughtFile(destination.path, folder)) return "";
    }
    const resolved = await resolveTarget(app, owner, target, label, read, nodeReference);
    if (resolved.node && resolved.file) return addNode(resolved.file, resolved.node, owner);
    const { key, file } = resolved;
    let value = nodes.get(key);
    if (!value) {
      const missing = !file || !!resolved.anchor || !!resolved.nodeReference;
      value = {
        path: key,
        openPath: (_a2 = file == null ? void 0 : file.path) != null ? _a2 : target,
        label: label != null ? label : resolved.anchor ? "\u5931\u6548\u5F15\u7528\uFF1A" + resolved.anchor.replace(/^\^/, "") : (_b2 = file == null ? void 0 : file.basename) != null ? _b2 : target,
        ownerPath: file == null ? void 0 : file.path,
        kind: missing ? "unresolved" : file.extension === "md" ? "note" : "attachment",
        thoughts: [],
        x: NaN,
        y: NaN,
        degree: 0
      };
      nodes.set(key, value);
    }
    if (!value.thoughts.includes(owner)) value.thoughts.push(owner);
    return key;
  };
  const addEdge = (owner, from, to) => {
    var _a2;
    if (!from || !to || from === to) return;
    const key = JSON.stringify([from, to]), edge = (_a2 = edges.get(key)) != null ? _a2 : { from, to, thoughts: [] };
    if (!edge.thoughts.includes(owner)) edge.thoughts.push(owner);
    edges.set(key, edge);
  };
  for (const file of thoughtFile ? [thoughtFile] : app.vault.getMarkdownFiles()) {
    if (folder !== void 0 && !isThoughtFile(file.path, folder)) continue;
    const document = await read(file);
    const marked = ((_b = (_a = app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter) == null ? void 0 : _b.brainos_type) === "thought-file";
    if (!thoughtFile && !document.doc.occurrences.length && !document.legacy && !marked) continue;
    thoughts.push({ path: file.path, title: file.basename });
    const keys = /* @__PURE__ */ new Map();
    for (const node of document.doc.nodes) keys.set(node.id, node.target ? await resolve(file.path, node.target, node.referenceLabel, node.referenceLabel !== void 0) : addNode(file, node, file.path));
    for (const relation of document.doc.relations) addEdge(file.path, keys.get(relation.from), keys.get(relation.to));
    for (const visit of document.doc.occurrences) {
      const key = keys.get(visit.id);
      if (!key) continue;
      steps.push({ key, title: visit.title, body: visit.body, thoughtPath: file.path, pathIndex: visit.path, ordinal: visit.ordinal });
      for (const link of documentLinks(visit.body)) addEdge(file.path, key, await resolve(file.path, link.target, link.label));
    }
    if (!thoughtFile && !document.doc.nodes.length) nodes.set("thought:" + file.path, {
      path: "thought:" + file.path,
      label: file.basename,
      openPath: file.path,
      ownerPath: file.path,
      x: 0,
      y: 0,
      degree: 0,
      thoughts: [file.path],
      placeholder: true
    });
  }
  for (const edge of edges.values()) {
    nodes.get(edge.from).degree++;
    nodes.get(edge.to).degree++;
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], thoughts, steps };
}

// src/thoughts.ts
var DEFAULT_NOTE_FOLDER = "";
var STATE_BLOCK = /<!--\s*brainos-state\s*\n([\s\S]*?)\n-->/;
function stepKey(step) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
  return String(
    (_k = (_j = (_i = (_h = (_g = (_f = (_e = (_d = (_c = (_b = (_a = step.atom) != null ? _a : step.nodeID) != null ? _b : step.nodeId) != null ? _c : step.node_id) != null ? _d : step.atomID) != null ? _e : step.atomId) != null ? _f : step.atom_id) != null ? _g : step.node) != null ? _h : step.path) != null ? _i : step.filePath) != null ? _j : step.file) != null ? _k : ""
  ).trim();
}
function parseThoughtState(markdown) {
  const match = markdown.match(STATE_BLOCK);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.paths !== void 0 && (!Array.isArray(value.paths) || value.paths.some((path) => !path || typeof path !== "object" || path.steps !== void 0 && (!Array.isArray(path.steps) || path.steps.some((step) => !step || typeof step !== "object"))))) return null;
    return value;
  } catch (e) {
    return null;
  }
}
function targetFolder(folder) {
  const value = folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (value.split("/").some((part) => part === ".." || part === ".")) throw new Error("\u8BF7\u4F7F\u7528\u7B14\u8BB0\u5E93\u5185\u7684\u6587\u4EF6\u5939\u8DEF\u5F84");
  return value ? (0, import_obsidian2.normalizePath)(value) : "";
}
async function ensureFolder(app, folder) {
  const normalized = targetFolder(folder);
  if (!normalized) return;
  let current = "";
  for (const part of normalized.split("/")) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}
async function createThought(app, title, folder) {
  const normalized = targetFolder(folder);
  await ensureFolder(app, normalized);
  const parent = normalized ? app.vault.getFolderByPath(normalized) : app.vault.getRoot();
  if (!parent) throw new Error("\u65B0\u601D\u8003\u5B58\u653E\u6587\u4EF6\u5939\u4E0D\u5B58\u5728");
  const fileManager = app.fileManager;
  return fileManager.createNewMarkdownFile(parent, title.trim() || "\u672A\u547D\u540D\u601D\u8003", "");
}

// layout-worker:/Users/othnielsu/Documents/repo/brainos-obsidian/src/layout-worker.ts
var layout_worker_default = '"use strict";\n(() => {\n  var __defProp = Object.defineProperty;\n  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;\n  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);\n\n  // src/force-layout.ts\n  var DEFAULT_FORCE_OPTIONS = Object.freeze({\n    centerStrength: 0.1,\n    repelStrength: 1e3,\n    linkStrength: 1,\n    linkDistance: 250\n  });\n  var _ForceLayout = class _ForceLayout {\n    constructor(options = {}) {\n      __publicField(this, "particles", []);\n      __publicField(this, "byId", /* @__PURE__ */ new Map());\n      __publicField(this, "links", []);\n      __publicField(this, "topology", "");\n      __publicField(this, "alpha", 0);\n      __publicField(this, "alphaTarget", 0);\n      __publicField(this, "options", { ...DEFAULT_FORCE_OPTIONS });\n      this.configure(options);\n    }\n    configure(options) {\n      const next = { ...this.options };\n      for (const key of Object.keys(next)) {\n        const value = options[key];\n        if (value !== void 0 && Number.isFinite(value)) {\n          next[key] = key === "linkDistance" ? clamp(value, 1, 1e4) : clamp(value, 0, key === "repelStrength" ? 1e6 : 10);\n        }\n      }\n      const changed = Object.keys(next).some((key) => next[key] !== this.options[key]);\n      this.options = next;\n      if (changed) this.reheat(0.3);\n    }\n    reset() {\n      this.particles = [];\n      this.byId.clear();\n      this.links = [];\n      this.topology = "";\n      this.alpha = 0;\n      this.alphaTarget = 0;\n    }\n    sync(nodes2, edges, saved) {\n      var _a;\n      const ids = [...new Set(nodes2.map((node) => node.path))].sort();\n      const idSet = new Set(ids);\n      const uniqueEdges = /* @__PURE__ */ new Map();\n      for (const edge of edges) {\n        if (edge.from !== edge.to && idSet.has(edge.from) && idSet.has(edge.to)) uniqueEdges.set(JSON.stringify([edge.from, edge.to]), edge);\n      }\n      const sortedEdges = [...uniqueEdges.entries()].sort(([a], [b]) => a.localeCompare(b));\n      const topology = JSON.stringify([ids, sortedEdges.map(([key]) => key)]);\n      const changed = topology !== this.topology;\n      const firstGraph = this.particles.length === 0;\n      this.topology = topology;\n      for (const id of this.byId.keys()) if (!idSet.has(id)) this.byId.delete(id);\n      const nodeById = new Map(nodes2.map((node) => [node.path, node]));\n      const adjacency = /* @__PURE__ */ new Map();\n      for (const [, edge] of sortedEdges) {\n        if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);\n        if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);\n        adjacency.get(edge.from).push(edge.to);\n        adjacency.get(edge.to).push(edge.from);\n      }\n      const added = [];\n      for (const [index, id] of ids.entries()) {\n        if (this.byId.has(id)) continue;\n        const stored = saved[id];\n        const original = nodeById.get(id);\n        const explicit = validPoint(stored) ? stored : validPoint(original) && (original.x !== 0 || original.y !== 0) ? original : void 0;\n        const point = explicit != null ? explicit : seedPoint(id, index, ids.length);\n        this.byId.set(id, { id, index, x: point.x, y: point.y, vx: 0, vy: 0, degree: 0 });\n        if (!explicit) added.push(id);\n      }\n      const newSet = new Set(added);\n      for (const id of added) {\n        const neighbors = ((_a = adjacency.get(id)) != null ? _a : []).filter((other) => !newSet.has(other)).map((other) => this.byId.get(other));\n        if (!neighbors.length) continue;\n        const angle = hash(id) / 4294967296 * Math.PI * 2;\n        const point = this.byId.get(id);\n        const radius = 40 + hash(id + "radius") % 40;\n        point.x = neighbors.reduce((sum, node) => sum + node.x, 0) / neighbors.length + Math.cos(angle) * radius;\n        point.y = neighbors.reduce((sum, node) => sum + node.y, 0) / neighbors.length + Math.sin(angle) * radius;\n      }\n      this.particles = ids.map((id, index) => {\n        const particle = this.byId.get(id);\n        particle.index = index;\n        particle.degree = 0;\n        return particle;\n      });\n      for (const [, edge] of sortedEdges) {\n        this.byId.get(edge.from).degree++;\n        this.byId.get(edge.to).degree++;\n      }\n      this.links = sortedEdges.map(([, edge]) => {\n        const source = this.byId.get(edge.from), target = this.byId.get(edge.to);\n        return { source, target, bias: source.degree / (source.degree + target.degree), strength: 1 / Math.min(source.degree, target.degree) };\n      });\n      this.alphaTarget = this.particles.some((particle) => particle.fixed) ? 0.3 : 0;\n      if (!this.particles.length) this.alpha = 0;\n      else if (changed) this.reheat(firstGraph ? 1 : 0.3);\n      this.copyToNodes(nodes2);\n    }\n    /** Selection affects rendering only; it must not attract the whole graph. */\n    setSelected(_path) {\n    }\n    pin(path, position) {\n      const particle = this.byId.get(path);\n      if (!particle || !validPoint(position)) return;\n      particle.fixed = { ...position };\n      particle.x = position.x;\n      particle.y = position.y;\n      particle.vx = 0;\n      particle.vy = 0;\n      this.alphaTarget = 0.3;\n      this.reheat(0.3);\n    }\n    movePinned(path, position) {\n      const particle = this.byId.get(path);\n      if (!(particle == null ? void 0 : particle.fixed) || !validPoint(position)) return;\n      particle.fixed = { ...position };\n      particle.x = position.x;\n      particle.y = position.y;\n      particle.vx = 0;\n      particle.vy = 0;\n      this.alphaTarget = 0.3;\n      this.reheat(0.3);\n    }\n    unpin(path) {\n      const particle = this.byId.get(path);\n      if (!(particle == null ? void 0 : particle.fixed)) return;\n      particle.fixed = void 0;\n      particle.vx = 0;\n      particle.vy = 0;\n      this.alphaTarget = this.particles.some((node) => node.fixed) ? 0.3 : 0;\n      this.reheat(0.3);\n    }\n    reheat(alpha = 0.3) {\n      this.alpha = Math.max(this.alpha, clamp(finite(alpha, 0.3), 0, 1));\n    }\n    tick(nodes2) {\n      if (!this.isRunning) {\n        this.copyToNodes(nodes2);\n        return false;\n      }\n      this.alpha += (this.alphaTarget - this.alpha) * _ForceLayout.alphaDecay;\n      const center = this.options.centerStrength * this.alpha;\n      for (const particle of this.particles) {\n        particle.vx -= particle.x * center;\n        particle.vy -= particle.y * center;\n      }\n      for (const link of this.links) {\n        const a = link.source, b = link.target;\n        let dx = b.x + b.vx - a.x - a.vx, dy = b.y + b.vy - a.y - a.vy;\n        if (dx === 0 && dy === 0) {\n          const unit = direction(a.id, b.id);\n          dx = unit.x * 0.1;\n          dy = unit.y * 0.1;\n        }\n        const length = Math.hypot(dx, dy);\n        const factor = (length - this.options.linkDistance) / length * this.alpha * this.options.linkStrength * link.strength;\n        dx *= factor;\n        dy *= factor;\n        b.vx -= dx * link.bias;\n        b.vy -= dy * link.bias;\n        a.vx += dx * (1 - link.bias);\n        a.vy += dy * (1 - link.bias);\n      }\n      if (this.particles.length > 1 && this.options.repelStrength > 0) {\n        const tree = buildTree(this.particles);\n        const strength = this.options.repelStrength * this.alpha;\n        for (const particle of this.particles) this.repulse(particle, tree, strength);\n      }\n      this.collide();\n      for (const particle of this.particles) {\n        if (particle.fixed) {\n          particle.x = particle.fixed.x;\n          particle.y = particle.fixed.y;\n          particle.vx = 0;\n          particle.vy = 0;\n        } else {\n          particle.vx *= _ForceLayout.damping;\n          particle.vy *= _ForceLayout.damping;\n          particle.x += particle.vx;\n          particle.y += particle.vy;\n          if (!Number.isFinite(particle.x) || !Number.isFinite(particle.y) || Math.abs(particle.x) > 1e7 || Math.abs(particle.y) > 1e7) {\n            const seed = seedPoint(particle.id, particle.index, this.particles.length);\n            particle.x = seed.x;\n            particle.y = seed.y;\n            particle.vx = 0;\n            particle.vy = 0;\n          }\n        }\n      }\n      if (this.alphaTarget === 0 && this.alpha < _ForceLayout.alphaMin) this.alpha = 0;\n      this.copyToNodes(nodes2);\n      return this.isRunning;\n    }\n    snapshot() {\n      return Object.fromEntries(this.particles.map((particle) => [particle.id, { x: particle.x, y: particle.y }]));\n    }\n    get isRunning() {\n      return this.particles.length > 0 && (this.alpha >= _ForceLayout.alphaMin || this.alphaTarget > 0);\n    }\n    copyToNodes(nodes2) {\n      for (const node of nodes2) {\n        const point = this.byId.get(node.path);\n        if (point) {\n          node.x = point.x;\n          node.y = point.y;\n        }\n      }\n    }\n    repulse(particle, quad, strength) {\n      var _a;\n      if (!quad.count) return;\n      let dx = particle.x - quad.cx, dy = particle.y - quad.cy;\n      let squared = dx * dx + dy * dy;\n      const contains = particle.x >= quad.x && particle.x <= quad.x + quad.width && particle.y >= quad.y && particle.y <= quad.y + quad.width;\n      if (quad.children && !contains && quad.width * quad.width < _ForceLayout.thetaSquared * squared) {\n        const factor = strength * quad.count / Math.max(1, squared);\n        particle.vx += dx * factor;\n        particle.vy += dy * factor;\n      } else if (quad.children) {\n        for (const child of quad.children) this.repulse(particle, child, strength);\n      } else {\n        for (const other of (_a = quad.points) != null ? _a : []) {\n          if (other === particle) continue;\n          dx = particle.x - other.x;\n          dy = particle.y - other.y;\n          squared = dx * dx + dy * dy;\n          if (squared < 1e-12) {\n            const unit = direction(other.id, particle.id);\n            dx = unit.x;\n            dy = unit.y;\n            squared = 1;\n          }\n          const factor = strength / Math.max(1, squared);\n          particle.vx += dx * factor;\n          particle.vy += dy * factor;\n        }\n      }\n    }\n    /** Predicted-position uniform buckets avoid an all-pairs collision pass. */\n    collide() {\n      var _a, _b;\n      const distance = _ForceLayout.collisionDistance;\n      const buckets = /* @__PURE__ */ new Map();\n      const predicted = this.particles.map((node) => ({ x: node.x + node.vx, y: node.y + node.vy }));\n      for (const particle of this.particles) {\n        const point = predicted[particle.index];\n        const key = `${Math.floor(point.x / distance)},${Math.floor(point.y / distance)}`;\n        const bucket = (_a = buckets.get(key)) != null ? _a : [];\n        bucket.push(particle);\n        buckets.set(key, bucket);\n      }\n      for (const particle of this.particles) {\n        const point = predicted[particle.index], cellX = Math.floor(point.x / distance), cellY = Math.floor(point.y / distance);\n        for (let x = cellX - 1; x <= cellX + 1; x++) for (let y = cellY - 1; y <= cellY + 1; y++) {\n          for (const other of (_b = buckets.get(`${x},${y}`)) != null ? _b : []) {\n            if (other.index <= particle.index) continue;\n            const target = predicted[other.index];\n            let dx = target.x - point.x, dy = target.y - point.y;\n            let length = Math.hypot(dx, dy);\n            if (length >= distance) continue;\n            if (length < 1e-6) {\n              const unit = direction(particle.id, other.id);\n              dx = unit.x;\n              dy = unit.y;\n              length = 1;\n            }\n            const factor = (distance - length) / length * _ForceLayout.collisionStrength;\n            const aShare = particle.fixed ? 0 : other.fixed ? 1 : 0.5;\n            const bShare = other.fixed ? 0 : particle.fixed ? 1 : 0.5;\n            particle.vx -= dx * factor * aShare;\n            particle.vy -= dy * factor * aShare;\n            other.vx += dx * factor * bShare;\n            other.vy += dy * factor * bShare;\n          }\n        }\n      }\n    }\n  };\n  __publicField(_ForceLayout, "alphaDecay", 1 - Math.pow(1e-3, 1 / 300));\n  __publicField(_ForceLayout, "alphaMin", 1e-3);\n  __publicField(_ForceLayout, "damping", 0.6);\n  __publicField(_ForceLayout, "thetaSquared", 0.9 * 0.9);\n  __publicField(_ForceLayout, "collisionDistance", 120);\n  __publicField(_ForceLayout, "collisionStrength", 0.5);\n  var ForceLayout = _ForceLayout;\n  function buildTree(points) {\n    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;\n    for (const point of points) {\n      minX = Math.min(minX, point.x);\n      minY = Math.min(minY, point.y);\n      maxX = Math.max(maxX, point.x);\n      maxY = Math.max(maxY, point.y);\n    }\n    const width = Math.max(1, maxX - minX, maxY - minY) * 1.000001;\n    return splitQuad(points, minX, minY, width, 0);\n  }\n  function splitQuad(points, x, y, width, depth) {\n    let cx = 0, cy = 0;\n    for (const point of points) {\n      cx += point.x;\n      cy += point.y;\n    }\n    const quad = { x, y, width, count: points.length, cx: cx / points.length, cy: cy / points.length };\n    if (points.length <= 4 || depth >= 24 || width < 1e-6) {\n      quad.points = points;\n      return quad;\n    }\n    const half = width / 2, groups = [[], [], [], []];\n    for (const point of points) groups[(point.x >= x + half ? 1 : 0) + (point.y >= y + half ? 2 : 0)].push(point);\n    quad.children = groups.flatMap((group, index) => group.length ? [splitQuad(group, x + index % 2 * half, y + (index >= 2 ? half : 0), half, depth + 1)] : []);\n    return quad;\n  }\n  function finite(value, fallback) {\n    return Number.isFinite(value) ? value : fallback;\n  }\n  function clamp(value, min, max) {\n    return Math.max(min, Math.min(max, value));\n  }\n  function validPoint(point) {\n    return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1e7 && Math.abs(point.y) <= 1e7;\n  }\n  function hash(value) {\n    let result = 2166136261;\n    for (const char of value) {\n      result ^= char.charCodeAt(0);\n      result = Math.imul(result, 16777619);\n    }\n    return result >>> 0;\n  }\n  function seedPoint(id, index, count) {\n    const angle = hash(id) / 4294967296 * Math.PI * 2;\n    const radius = (120 + Math.sqrt(count) * 40) * Math.sqrt((index + 0.5) / Math.max(1, count));\n    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };\n  }\n  function direction(from, to) {\n    const first = from < to ? from : to, second = from < to ? to : from;\n    const angle = hash(first + "\\0" + second) / 4294967296 * Math.PI * 2;\n    const sign = from < to ? 1 : -1;\n    return { x: Math.cos(angle) * sign, y: Math.sin(angle) * sign };\n  }\n\n  // src/layout-worker.ts\n  var layout = new ForceLayout();\n  var nodes = [];\n  var revision = 0;\n  var commandVersion = 0;\n  var timer;\n  var scope = self;\n  function publish() {\n    const positions = new Float32Array(nodes.length * 2);\n    nodes.forEach((node, index) => {\n      positions[index * 2] = node.x;\n      positions[index * 2 + 1] = node.y;\n    });\n    scope.postMessage({ revision, commandVersion, positions, running: layout.isRunning }, [positions.buffer]);\n  }\n  function run() {\n    timer = void 0;\n    layout.tick(nodes);\n    publish();\n    if (layout.isRunning) timer = setTimeout(run, 1e3 / 60);\n  }\n  function start() {\n    if (timer === void 0) timer = setTimeout(run, 0);\n  }\n  scope.onmessage = (event) => {\n    const message = event.data;\n    commandVersion = message.commandVersion;\n    switch (message.type) {\n      case "sync":\n        revision = message.revision;\n        nodes = message.nodes;\n        layout.sync(nodes, message.edges, message.saved);\n        break;\n      case "configure":\n        layout.configure(message.options);\n        break;\n      case "selected":\n        layout.setSelected(message.path);\n        break;\n      case "pin":\n        layout.pin(message.path, message.point);\n        break;\n      case "move":\n        layout.movePinned(message.path, message.point);\n        break;\n      case "unpin":\n        layout.unpin(message.path);\n        break;\n      case "reheat":\n        layout.reheat(message.alpha);\n        break;\n      case "reset":\n        layout.reset();\n        break;\n    }\n    publish();\n    if (layout.isRunning) start();\n  };\n})();\n';

// src/force-layout.ts
var DEFAULT_FORCE_OPTIONS = Object.freeze({
  centerStrength: 0.1,
  repelStrength: 1e3,
  linkStrength: 1,
  linkDistance: 250
});
function forceOptionsFromSliders(sliders) {
  const exponential = (value) => (Math.pow(0.01, 1 - clamp(finite(value, 0.5), 0, 1)) - 0.01) / 0.99;
  return {
    centerStrength: exponential(sliders.center),
    repelStrength: Math.max(1, Math.pow(clamp(finite(sliders.repel, 10), 0, 100), 3)),
    linkStrength: exponential(sliders.link),
    linkDistance: clamp(finite(sliders.distance, 250), 30, 500)
  };
}
var _ForceLayout = class _ForceLayout {
  constructor(options = {}) {
    __publicField(this, "particles", []);
    __publicField(this, "byId", /* @__PURE__ */ new Map());
    __publicField(this, "links", []);
    __publicField(this, "topology", "");
    __publicField(this, "alpha", 0);
    __publicField(this, "alphaTarget", 0);
    __publicField(this, "options", { ...DEFAULT_FORCE_OPTIONS });
    this.configure(options);
  }
  configure(options) {
    const next = { ...this.options };
    for (const key of Object.keys(next)) {
      const value = options[key];
      if (value !== void 0 && Number.isFinite(value)) {
        next[key] = key === "linkDistance" ? clamp(value, 1, 1e4) : clamp(value, 0, key === "repelStrength" ? 1e6 : 10);
      }
    }
    const changed = Object.keys(next).some((key) => next[key] !== this.options[key]);
    this.options = next;
    if (changed) this.reheat(0.3);
  }
  reset() {
    this.particles = [];
    this.byId.clear();
    this.links = [];
    this.topology = "";
    this.alpha = 0;
    this.alphaTarget = 0;
  }
  sync(nodes, edges, saved) {
    var _a;
    const ids = [...new Set(nodes.map((node) => node.path))].sort();
    const idSet = new Set(ids);
    const uniqueEdges = /* @__PURE__ */ new Map();
    for (const edge of edges) {
      if (edge.from !== edge.to && idSet.has(edge.from) && idSet.has(edge.to)) uniqueEdges.set(JSON.stringify([edge.from, edge.to]), edge);
    }
    const sortedEdges = [...uniqueEdges.entries()].sort(([a], [b]) => a.localeCompare(b));
    const topology = JSON.stringify([ids, sortedEdges.map(([key]) => key)]);
    const changed = topology !== this.topology;
    const firstGraph = this.particles.length === 0;
    this.topology = topology;
    for (const id of this.byId.keys()) if (!idSet.has(id)) this.byId.delete(id);
    const nodeById = new Map(nodes.map((node) => [node.path, node]));
    const adjacency = /* @__PURE__ */ new Map();
    for (const [, edge] of sortedEdges) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
      adjacency.get(edge.from).push(edge.to);
      adjacency.get(edge.to).push(edge.from);
    }
    const added = [];
    for (const [index, id] of ids.entries()) {
      if (this.byId.has(id)) continue;
      const stored = saved[id];
      const original = nodeById.get(id);
      const explicit = validPoint(stored) ? stored : validPoint(original) && (original.x !== 0 || original.y !== 0) ? original : void 0;
      const point = explicit != null ? explicit : seedPoint(id, index, ids.length);
      this.byId.set(id, { id, index, x: point.x, y: point.y, vx: 0, vy: 0, degree: 0 });
      if (!explicit) added.push(id);
    }
    const newSet = new Set(added);
    for (const id of added) {
      const neighbors = ((_a = adjacency.get(id)) != null ? _a : []).filter((other) => !newSet.has(other)).map((other) => this.byId.get(other));
      if (!neighbors.length) continue;
      const angle = hash(id) / 4294967296 * Math.PI * 2;
      const point = this.byId.get(id);
      const radius = 40 + hash(id + "radius") % 40;
      point.x = neighbors.reduce((sum, node) => sum + node.x, 0) / neighbors.length + Math.cos(angle) * radius;
      point.y = neighbors.reduce((sum, node) => sum + node.y, 0) / neighbors.length + Math.sin(angle) * radius;
    }
    this.particles = ids.map((id, index) => {
      const particle = this.byId.get(id);
      particle.index = index;
      particle.degree = 0;
      return particle;
    });
    for (const [, edge] of sortedEdges) {
      this.byId.get(edge.from).degree++;
      this.byId.get(edge.to).degree++;
    }
    this.links = sortedEdges.map(([, edge]) => {
      const source = this.byId.get(edge.from), target = this.byId.get(edge.to);
      return { source, target, bias: source.degree / (source.degree + target.degree), strength: 1 / Math.min(source.degree, target.degree) };
    });
    this.alphaTarget = this.particles.some((particle) => particle.fixed) ? 0.3 : 0;
    if (!this.particles.length) this.alpha = 0;
    else if (changed) this.reheat(firstGraph ? 1 : 0.3);
    this.copyToNodes(nodes);
  }
  /** Selection affects rendering only; it must not attract the whole graph. */
  setSelected(_path) {
  }
  pin(path, position) {
    const particle = this.byId.get(path);
    if (!particle || !validPoint(position)) return;
    particle.fixed = { ...position };
    particle.x = position.x;
    particle.y = position.y;
    particle.vx = 0;
    particle.vy = 0;
    this.alphaTarget = 0.3;
    this.reheat(0.3);
  }
  movePinned(path, position) {
    const particle = this.byId.get(path);
    if (!(particle == null ? void 0 : particle.fixed) || !validPoint(position)) return;
    particle.fixed = { ...position };
    particle.x = position.x;
    particle.y = position.y;
    particle.vx = 0;
    particle.vy = 0;
    this.alphaTarget = 0.3;
    this.reheat(0.3);
  }
  unpin(path) {
    const particle = this.byId.get(path);
    if (!(particle == null ? void 0 : particle.fixed)) return;
    particle.fixed = void 0;
    particle.vx = 0;
    particle.vy = 0;
    this.alphaTarget = this.particles.some((node) => node.fixed) ? 0.3 : 0;
    this.reheat(0.3);
  }
  reheat(alpha = 0.3) {
    this.alpha = Math.max(this.alpha, clamp(finite(alpha, 0.3), 0, 1));
  }
  tick(nodes) {
    if (!this.isRunning) {
      this.copyToNodes(nodes);
      return false;
    }
    this.alpha += (this.alphaTarget - this.alpha) * _ForceLayout.alphaDecay;
    const center = this.options.centerStrength * this.alpha;
    for (const particle of this.particles) {
      particle.vx -= particle.x * center;
      particle.vy -= particle.y * center;
    }
    for (const link of this.links) {
      const a = link.source, b = link.target;
      let dx = b.x + b.vx - a.x - a.vx, dy = b.y + b.vy - a.y - a.vy;
      if (dx === 0 && dy === 0) {
        const unit = direction(a.id, b.id);
        dx = unit.x * 0.1;
        dy = unit.y * 0.1;
      }
      const length = Math.hypot(dx, dy);
      const factor = (length - this.options.linkDistance) / length * this.alpha * this.options.linkStrength * link.strength;
      dx *= factor;
      dy *= factor;
      b.vx -= dx * link.bias;
      b.vy -= dy * link.bias;
      a.vx += dx * (1 - link.bias);
      a.vy += dy * (1 - link.bias);
    }
    if (this.particles.length > 1 && this.options.repelStrength > 0) {
      const tree = buildTree(this.particles);
      const strength = this.options.repelStrength * this.alpha;
      for (const particle of this.particles) this.repulse(particle, tree, strength);
    }
    this.collide();
    for (const particle of this.particles) {
      if (particle.fixed) {
        particle.x = particle.fixed.x;
        particle.y = particle.fixed.y;
        particle.vx = 0;
        particle.vy = 0;
      } else {
        particle.vx *= _ForceLayout.damping;
        particle.vy *= _ForceLayout.damping;
        particle.x += particle.vx;
        particle.y += particle.vy;
        if (!Number.isFinite(particle.x) || !Number.isFinite(particle.y) || Math.abs(particle.x) > 1e7 || Math.abs(particle.y) > 1e7) {
          const seed = seedPoint(particle.id, particle.index, this.particles.length);
          particle.x = seed.x;
          particle.y = seed.y;
          particle.vx = 0;
          particle.vy = 0;
        }
      }
    }
    if (this.alphaTarget === 0 && this.alpha < _ForceLayout.alphaMin) this.alpha = 0;
    this.copyToNodes(nodes);
    return this.isRunning;
  }
  snapshot() {
    return Object.fromEntries(this.particles.map((particle) => [particle.id, { x: particle.x, y: particle.y }]));
  }
  get isRunning() {
    return this.particles.length > 0 && (this.alpha >= _ForceLayout.alphaMin || this.alphaTarget > 0);
  }
  copyToNodes(nodes) {
    for (const node of nodes) {
      const point = this.byId.get(node.path);
      if (point) {
        node.x = point.x;
        node.y = point.y;
      }
    }
  }
  repulse(particle, quad, strength) {
    var _a;
    if (!quad.count) return;
    let dx = particle.x - quad.cx, dy = particle.y - quad.cy;
    let squared = dx * dx + dy * dy;
    const contains = particle.x >= quad.x && particle.x <= quad.x + quad.width && particle.y >= quad.y && particle.y <= quad.y + quad.width;
    if (quad.children && !contains && quad.width * quad.width < _ForceLayout.thetaSquared * squared) {
      const factor = strength * quad.count / Math.max(1, squared);
      particle.vx += dx * factor;
      particle.vy += dy * factor;
    } else if (quad.children) {
      for (const child of quad.children) this.repulse(particle, child, strength);
    } else {
      for (const other of (_a = quad.points) != null ? _a : []) {
        if (other === particle) continue;
        dx = particle.x - other.x;
        dy = particle.y - other.y;
        squared = dx * dx + dy * dy;
        if (squared < 1e-12) {
          const unit = direction(other.id, particle.id);
          dx = unit.x;
          dy = unit.y;
          squared = 1;
        }
        const factor = strength / Math.max(1, squared);
        particle.vx += dx * factor;
        particle.vy += dy * factor;
      }
    }
  }
  /** Predicted-position uniform buckets avoid an all-pairs collision pass. */
  collide() {
    var _a, _b;
    const distance = _ForceLayout.collisionDistance;
    const buckets = /* @__PURE__ */ new Map();
    const predicted = this.particles.map((node) => ({ x: node.x + node.vx, y: node.y + node.vy }));
    for (const particle of this.particles) {
      const point = predicted[particle.index];
      const key = `${Math.floor(point.x / distance)},${Math.floor(point.y / distance)}`;
      const bucket = (_a = buckets.get(key)) != null ? _a : [];
      bucket.push(particle);
      buckets.set(key, bucket);
    }
    for (const particle of this.particles) {
      const point = predicted[particle.index], cellX = Math.floor(point.x / distance), cellY = Math.floor(point.y / distance);
      for (let x = cellX - 1; x <= cellX + 1; x++) for (let y = cellY - 1; y <= cellY + 1; y++) {
        for (const other of (_b = buckets.get(`${x},${y}`)) != null ? _b : []) {
          if (other.index <= particle.index) continue;
          const target = predicted[other.index];
          let dx = target.x - point.x, dy = target.y - point.y;
          let length = Math.hypot(dx, dy);
          if (length >= distance) continue;
          if (length < 1e-6) {
            const unit = direction(particle.id, other.id);
            dx = unit.x;
            dy = unit.y;
            length = 1;
          }
          const factor = (distance - length) / length * _ForceLayout.collisionStrength;
          const aShare = particle.fixed ? 0 : other.fixed ? 1 : 0.5;
          const bShare = other.fixed ? 0 : particle.fixed ? 1 : 0.5;
          particle.vx -= dx * factor * aShare;
          particle.vy -= dy * factor * aShare;
          other.vx += dx * factor * bShare;
          other.vy += dy * factor * bShare;
        }
      }
    }
  }
};
__publicField(_ForceLayout, "alphaDecay", 1 - Math.pow(1e-3, 1 / 300));
__publicField(_ForceLayout, "alphaMin", 1e-3);
__publicField(_ForceLayout, "damping", 0.6);
__publicField(_ForceLayout, "thetaSquared", 0.9 * 0.9);
__publicField(_ForceLayout, "collisionDistance", 120);
__publicField(_ForceLayout, "collisionStrength", 0.5);
var ForceLayout = _ForceLayout;
function buildTree(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const width = Math.max(1, maxX - minX, maxY - minY) * 1.000001;
  return splitQuad(points, minX, minY, width, 0);
}
function splitQuad(points, x, y, width, depth) {
  let cx = 0, cy = 0;
  for (const point of points) {
    cx += point.x;
    cy += point.y;
  }
  const quad = { x, y, width, count: points.length, cx: cx / points.length, cy: cy / points.length };
  if (points.length <= 4 || depth >= 24 || width < 1e-6) {
    quad.points = points;
    return quad;
  }
  const half = width / 2, groups = [[], [], [], []];
  for (const point of points) groups[(point.x >= x + half ? 1 : 0) + (point.y >= y + half ? 2 : 0)].push(point);
  quad.children = groups.flatMap((group, index) => group.length ? [splitQuad(group, x + index % 2 * half, y + (index >= 2 ? half : 0), half, depth + 1)] : []);
  return quad;
}
function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function validPoint(point) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1e7 && Math.abs(point.y) <= 1e7;
}
function hash(value) {
  let result = 2166136261;
  for (const char of value) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
function seedPoint(id, index, count) {
  const angle = hash(id) / 4294967296 * Math.PI * 2;
  const radius = (120 + Math.sqrt(count) * 40) * Math.sqrt((index + 0.5) / Math.max(1, count));
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}
function direction(from, to) {
  const first = from < to ? from : to, second = from < to ? to : from;
  const angle = hash(first + "\0" + second) / 4294967296 * Math.PI * 2;
  const sign = from < to ? 1 : -1;
  return { x: Math.cos(angle) * sign, y: Math.sin(angle) * sign };
}

// src/graph-layout.ts
var GraphLayout = class {
  constructor(invalidate) {
    this.invalidate = invalidate;
    __publicField(this, "worker");
    __publicField(this, "fallback");
    __publicField(this, "positions", {});
    __publicField(this, "nodes", []);
    __publicField(this, "edges", []);
    __publicField(this, "revision", 0);
    __publicField(this, "commandVersion", 0);
    __publicField(this, "running", false);
    __publicField(this, "selected");
    __publicField(this, "options", {});
    __publicField(this, "pinned", /* @__PURE__ */ new Map());
    __publicField(this, "disposed", false);
    try {
      const url = URL.createObjectURL(new Blob([layout_worker_default], { type: "text/javascript" }));
      try {
        this.worker = new Worker(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      this.worker.onmessage = (event) => {
        const value = event.data;
        if (this.disposed || value.revision !== this.revision || value.commandVersion !== this.commandVersion || !(value.positions instanceof Float32Array) || value.positions.length !== this.nodes.length * 2) return;
        this.nodes.forEach((node, index) => {
          var _a;
          const point = (_a = this.pinned.get(node.path)) != null ? _a : { x: value.positions[index * 2], y: value.positions[index * 2 + 1] };
          if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
            this.positions[node.path] = point;
            node.x = point.x;
            node.y = point.y;
          }
        });
        this.running = value.running;
        this.invalidate();
      };
      this.worker.onerror = (event) => {
        event.preventDefault();
        this.useFallback();
        this.invalidate();
      };
    } catch (e) {
      this.useFallback();
    }
  }
  useFallback() {
    var _a;
    (_a = this.worker) == null ? void 0 : _a.terminate();
    this.worker = void 0;
    this.fallback = new ForceLayout();
    this.fallback.configure(this.options);
    this.fallback.sync(this.nodes, this.edges, this.positions);
    this.fallback.setSelected(this.selected);
    for (const [path, point] of this.pinned) this.fallback.pin(path, point);
  }
  send(message) {
    if (!this.disposed && this.worker) this.worker.postMessage({ ...message, commandVersion: ++this.commandVersion });
  }
  sync(nodes, edges, saved) {
    var _a;
    this.nodes = [...nodes];
    this.edges = [...edges];
    this.revision++;
    const current = {};
    for (const node of nodes) {
      const point = (_a = this.positions[node.path]) != null ? _a : saved[node.path];
      if (point) {
        node.x = point.x;
        node.y = point.y;
        current[node.path] = { ...point };
      }
    }
    this.positions = current;
    if (this.fallback) this.fallback.sync(nodes, edges, this.positions);
    else {
      this.running = nodes.length > 0;
      this.send({ type: "sync", revision: this.revision, nodes, edges, saved: this.positions });
    }
  }
  configure(options) {
    var _a;
    this.options = { ...this.options, ...options };
    (_a = this.fallback) == null ? void 0 : _a.configure(options);
    this.send({ type: "configure", options });
  }
  setSelected(path) {
    var _a;
    this.selected = path;
    (_a = this.fallback) == null ? void 0 : _a.setSelected(path);
    this.send({ type: "selected", path });
  }
  pin(path, point) {
    var _a;
    this.pinned.set(path, { ...point });
    this.positions[path] = { ...point };
    (_a = this.fallback) == null ? void 0 : _a.pin(path, point);
    this.running = true;
    this.send({ type: "pin", path, point });
  }
  movePinned(path, point) {
    var _a;
    this.pinned.set(path, { ...point });
    this.positions[path] = { ...point };
    (_a = this.fallback) == null ? void 0 : _a.movePinned(path, point);
    this.send({ type: "move", path, point });
  }
  unpin(path) {
    var _a;
    this.pinned.delete(path);
    (_a = this.fallback) == null ? void 0 : _a.unpin(path);
    this.send({ type: "unpin", path });
  }
  reheat(alpha = 0.3) {
    var _a;
    (_a = this.fallback) == null ? void 0 : _a.reheat(alpha);
    this.running = true;
    this.send({ type: "reheat", alpha });
  }
  reset() {
    var _a;
    this.positions = {};
    (_a = this.fallback) == null ? void 0 : _a.reset();
    this.send({ type: "reset" });
  }
  tick(nodes) {
    var _a;
    if (this.fallback) return this.fallback.tick(nodes);
    for (const node of nodes) {
      const point = (_a = this.pinned.get(node.path)) != null ? _a : this.positions[node.path];
      if (point) Object.assign(node, point);
    }
    return this.running;
  }
  snapshot() {
    var _a, _b;
    return (_b = (_a = this.fallback) == null ? void 0 : _a.snapshot()) != null ? _b : Object.fromEntries(Object.entries(this.positions).map(([path, point]) => [path, { ...point }]));
  }
  get isRunning() {
    var _a, _b;
    return (_b = (_a = this.fallback) == null ? void 0 : _a.isRunning) != null ? _b : this.running;
  }
  dispose() {
    var _a;
    this.disposed = true;
    (_a = this.worker) == null ? void 0 : _a.terminate();
    this.worker = void 0;
    this.running = false;
  }
};

// src/graph-options.ts
function defaultGraphOptions() {
  return {
    source: "vault",
    hiddenPaths: [],
    display: { nodeSizeMultiplier: 1, lineSizeMultiplier: 1, textFadeMultiplier: 0, showArrows: false },
    forces: { center: 1 - Math.log(0.109) / Math.log(0.01), repel: 10, link: 1, distance: 250 },
    filter: { showTags: false, showAttachments: false, showUnresolved: true, showOrphans: true, localDepth: 1, localIncoming: true, localOutgoing: true }
  };
}
function loadGraphOptions(value) {
  const defaults = defaultGraphOptions();
  const raw = value && typeof value === "object" ? value : {};
  const group = (key) => raw[key] && typeof raw[key] === "object" ? raw[key] : {};
  const display = group("display"), forces = group("forces"), filter = group("filter");
  const number = (record, key, fallback, min, max) => {
    const value2 = record[key];
    return typeof value2 === "number" && Number.isFinite(value2) ? Math.max(min, Math.min(max, value2)) : fallback;
  };
  const bool = (record, key, fallback) => typeof record[key] === "boolean" ? record[key] : fallback;
  return {
    source: raw.source === "thoughts" ? "thoughts" : "vault",
    hiddenPaths: Array.isArray(raw.hiddenPaths) ? raw.hiddenPaths.filter((path) => typeof path === "string") : [],
    display: {
      nodeSizeMultiplier: number(display, "nodeSizeMultiplier", 1, 0.25, 3),
      lineSizeMultiplier: number(display, "lineSizeMultiplier", 1, 0.1, 5),
      textFadeMultiplier: number(display, "textFadeMultiplier", 0, -3, 3),
      showArrows: bool(display, "showArrows", false)
    },
    forces: {
      center: number(forces, "center", defaults.forces.center, 0, 1),
      repel: number(forces, "repel", 10, 0, 20),
      link: number(forces, "link", 1, 0, 1),
      distance: number(forces, "distance", 250, 30, 500)
    },
    filter: {
      showTags: bool(filter, "showTags", false),
      showAttachments: bool(filter, "showAttachments", false),
      showUnresolved: bool(filter, "showUnresolved", true),
      showOrphans: bool(filter, "showOrphans", true),
      localDepth: Math.round(number(filter, "localDepth", 1, 1, 5)),
      localIncoming: bool(filter, "localIncoming", true),
      localOutgoing: bool(filter, "localOutgoing", true)
    }
  };
}
function graphForces(options) {
  return forceOptionsFromSliders(options.forces);
}

// src/vault-graph.ts
var import_obsidian3 = require("obsidian");
function buildVaultSnapshot(app, thoughts, filter, folder) {
  var _a;
  const nodes = /* @__PURE__ */ new Map();
  const edges = /* @__PURE__ */ new Map();
  const addFile = (file) => {
    var _a2, _b;
    if (folder !== void 0 && !isThoughtFile(file.path, folder)) return void 0;
    if (file.extension !== "md" && !filter.showAttachments) return void 0;
    let node = nodes.get(file.path);
    if (!node) {
      node = {
        path: file.path,
        openPath: file.path,
        label: file.basename,
        x: NaN,
        y: NaN,
        degree: 0,
        thoughts: [],
        kind: file.extension === "md" ? "note" : "attachment",
        tags: (_b = (0, import_obsidian3.getAllTags)((_a2 = app.metadataCache.getFileCache(file)) != null ? _a2 : {})) != null ? _b : []
      };
      nodes.set(node.path, node);
    }
    return node;
  };
  const addEdge = (from, to) => {
    if (from === to || !nodes.has(from) || !nodes.has(to)) return;
    const key = JSON.stringify([from, to]);
    if (!edges.has(key)) edges.set(key, { from, to, thoughts: [] });
  };
  for (const file of app.vault.getMarkdownFiles()) addFile(file);
  for (const [source, targets] of Object.entries(app.metadataCache.resolvedLinks)) {
    const file = app.vault.getAbstractFileByPath(source);
    if (!(file instanceof import_obsidian3.TFile) || !addFile(file)) continue;
    for (const target of Object.keys(targets)) {
      const destination = app.vault.getAbstractFileByPath(target);
      if (destination instanceof import_obsidian3.TFile && addFile(destination)) addEdge(source, destination.path);
    }
  }
  if (filter.showUnresolved) {
    for (const [source, targets] of Object.entries(app.metadataCache.unresolvedLinks)) {
      if (!nodes.has(source)) continue;
      for (const target of Object.keys(targets)) {
        const path = `unresolved:${target}`;
        if (!nodes.has(path)) nodes.set(path, { path, openPath: target, label: target, kind: "unresolved", degree: 0, thoughts: [], x: NaN, y: NaN });
        addEdge(source, path);
      }
    }
  }
  if (filter.showTags) {
    for (const node of [...nodes.values()]) {
      for (const tag of (_a = node.tags) != null ? _a : []) {
        if (!nodes.has(tag)) nodes.set(tag, { path: tag, openPath: "", label: tag, kind: "tag", degree: 0, thoughts: [], x: NaN, y: NaN });
        addEdge(node.path, tag);
      }
    }
  }
  for (const edge of edges.values()) {
    nodes.get(edge.from).degree++;
    nodes.get(edge.to).degree++;
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], thoughts };
}
function selectGraph(snapshot, query, options, localCenter) {
  var _a, _b, _c, _d, _e;
  const tokens = (_a = query.match(/(?:[^\s"]+|"[^"]*")+/g)) != null ? _a : [];
  const matches = (node) => tokens.every((raw) => {
    var _a2;
    const token = raw.replace(/"/g, "").toLocaleLowerCase();
    if (token.startsWith("path:")) return node.path.toLocaleLowerCase().includes(token.slice(5));
    if (token.startsWith("file:")) return node.label.toLocaleLowerCase().includes(token.slice(5));
    if (token.startsWith("tag:")) {
      const value = token.slice(4).replace(/^#/, "");
      return ((_a2 = node.tags) != null ? _a2 : []).some((tag) => tag.slice(1).toLocaleLowerCase() === value || tag.slice(1).toLocaleLowerCase().startsWith(value + "/"));
    }
    return node.label.toLocaleLowerCase().includes(token) || node.path.toLocaleLowerCase().includes(token);
  });
  let nodes = snapshot.nodes.filter(matches);
  let ids = new Set(nodes.map((node) => node.path));
  let edges = snapshot.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  if (localCenter) {
    const keep = /* @__PURE__ */ new Set();
    const layers = /* @__PURE__ */ new Map();
    if (ids.has(localCenter)) {
      keep.add(localCenter);
      layers.set(localCenter, 0);
    }
    const byPath = new Map(nodes.map((node) => [node.path, node]));
    for (let depth = 0; depth < options.localDepth; depth++) {
      const next = /* @__PURE__ */ new Set();
      for (const edge of edges) {
        if (options.localOutgoing && keep.has(edge.from) && ((_b = byPath.get(edge.from)) == null ? void 0 : _b.kind) !== "tag" && !keep.has(edge.to)) next.add(edge.to);
        if (options.localIncoming && keep.has(edge.to) && ((_c = byPath.get(edge.to)) == null ? void 0 : _c.kind) !== "tag" && !keep.has(edge.from)) next.add(edge.from);
      }
      for (const path of next) {
        keep.add(path);
        layers.set(path, depth + 1);
      }
    }
    nodes = nodes.filter((node) => keep.has(node.path)).map((node) => {
      var _a2;
      return { ...node, weight: Math.max(0, 30 - 30 / options.localDepth * ((_a2 = layers.get(node.path)) != null ? _a2 : 0)) };
    });
    ids = keep;
    edges = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  } else nodes = nodes.map((node) => ({ ...node, weight: void 0 }));
  const degrees = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    degrees.set(edge.from, ((_d = degrees.get(edge.from)) != null ? _d : 0) + 1);
    degrees.set(edge.to, ((_e = degrees.get(edge.to)) != null ? _e : 0) + 1);
  }
  nodes = nodes.map((node) => {
    var _a2;
    return { ...node, degree: (_a2 = degrees.get(node.path)) != null ? _a2 : 0 };
  });
  if (!options.showOrphans) {
    const connected = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
    nodes = nodes.filter((node) => connected.has(node.path) || node.path === localCenter);
  }
  return { nodes, edges, thoughts: snapshot.thoughts };
}

// src/vault-links.ts
var import_obsidian4 = require("obsidian");
async function removeVaultLink(app, from, to) {
  var _a, _b;
  const source = app.vault.getAbstractFileByPath(from);
  if (!(source instanceof import_obsidian4.TFile) || source.extension !== "md") throw new Error("\u8BE5\u8282\u70B9\u6CA1\u6709\u53EF\u7F16\u8F91\u7684 Markdown \u6765\u6E90");
  const cache = app.metadataCache.getFileCache(source);
  const references = [...(_a = cache == null ? void 0 : cache.links) != null ? _a : [], ...(_b = cache == null ? void 0 : cache.embeds) != null ? _b : []].filter((reference) => {
    const parsed = (0, import_obsidian4.parseLinktext)(reference.link);
    const target = app.metadataCache.getFirstLinkpathDest(parsed.path || source.path, source.path);
    return (target == null ? void 0 : target.path) === to || `unresolved:${parsed.path}` === to;
  }).sort((a, b) => b.position.start.offset - a.position.start.offset);
  if (!references.length) throw new Error("\u8BE5\u8FDE\u7EBF\u53EF\u80FD\u6765\u81EA\u5C5E\u6027\u6216\u7D22\u5F15\u5C1A\u672A\u66F4\u65B0\uFF0C\u8BF7\u6253\u5F00\u6765\u6E90\u7B14\u8BB0\u4FEE\u6539");
  await processGraphFile(app, source, (current) => {
    var _a2;
    let next = current;
    for (const reference of references) {
      const start = reference.position.start.offset, end = reference.position.end.offset;
      if (current.slice(start, end) !== reference.original) throw new Error("\u7B14\u8BB0\u94FE\u63A5\u5DF2\u88AB\u5916\u90E8\u4FEE\u6539\uFF0C\u8BF7\u5237\u65B0\u56FE\u8C31\u540E\u91CD\u8BD5");
      const label = (_a2 = reference.displayText) != null ? _a2 : reference.link;
      next = next.slice(0, start) + label + next.slice(end);
    }
    return next;
  });
}

// src/graph-rendering.ts
function clamp2(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function nodeScreenRadius(weight, zoom, multiplier = 1) {
  const size = clamp2(3 * Math.sqrt(Math.max(0, weight) + 1), 8, 30);
  return size * Math.max(0.05, multiplier) * Math.sqrt(Math.max(1e-4, zoom));
}
function graphLabelAlpha(zoom, fadeMultiplier = 0) {
  return clamp2(Math.log2(Math.max(1e-4, zoom)) + 1 - fadeMultiplier, 0, 1);
}
function approachOpacity(previous, target, elapsedMs) {
  if (Math.abs(previous - target) < 2e-3) return target;
  const amount = 1 - Math.exp(-Math.min(64, Math.max(1, elapsedMs)) / 65);
  const next = previous + (target - previous) * amount;
  return Math.abs(next - target) < 2e-3 ? target : next;
}
function intersectsViewport(rect, width, height) {
  return rect.right >= 0 && rect.bottom >= 0 && rect.left <= width && rect.top <= height;
}
function edgeInViewport(a, b, width, height, padding = 2) {
  return intersectsViewport({
    left: Math.min(a.x, b.x) - padding,
    right: Math.max(a.x, b.x) + padding,
    top: Math.min(a.y, b.y) - padding,
    bottom: Math.max(a.y, b.y) + padding
  }, width, height);
}
function edgeStrokeKey(from, to) {
  return JSON.stringify(from < to ? [from, to] : [to, from]);
}
function wrapGraphLabel(text, measure, width, maxLines = 4) {
  const lines = [];
  let line = "";
  for (const character of text.replace(/\s+/g, " ").trim()) {
    if (line && measure(line + character) > width) {
      lines.push(line.trimEnd());
      line = character.trimStart();
      if (lines.length === maxLines) {
        let last = lines[maxLines - 1];
        while (last && measure(last + "\u2026") > width) last = Array.from(last).slice(0, -1).join("");
        lines[maxLines - 1] = last + "\u2026";
        return lines;
      }
    } else line += character;
  }
  if (line || !lines.length) lines.push(line.trimEnd());
  return lines;
}

// src/node-title-suggest.ts
var import_obsidian5 = require("obsidian");
var NodeTitleSuggest = class extends import_obsidian5.AbstractInputSuggest {
  constructor(app, input, owner, loadNodes, choose, isComposing, insertion = false, editingKey) {
    super(app, input);
    this.owner = owner;
    this.loadNodes = loadNodes;
    this.choose = choose;
    this.isComposing = isComposing;
    this.insertion = insertion;
    this.editingKey = editingKey;
    __publicField(this, "disposed", false);
    __publicField(this, "showing", false);
    __publicField(this, "candidates");
    this.limit = 50;
    input.addEventListener("compositionend", () => queueMicrotask(() => {
      if (!this.disposed) input.dispatchEvent(new Event("input", { bubbles: true }));
    }));
  }
  get isShowing() {
    return this.showing;
  }
  open() {
    if (!this.disposed) {
      this.showing = true;
      super.open();
    }
  }
  close() {
    this.showing = false;
    super.close();
  }
  async getSuggestions(query) {
    var _a;
    if (this.disposed) return [];
    const title = query.trim();
    if (!title && !this.editingKey) return [];
    (_a = this.candidates) != null ? _a : this.candidates = this.loadNodes().catch(() => {
      this.candidates = void 0;
      return [];
    });
    const nodes = await this.candidates;
    if (this.disposed) return [];
    const unique = [...new Map(nodes.filter((node) => node.nodeId && node.ownerPath && !node.placeholder && (!this.editingKey || node.ownerPath === this.owner && node.path !== this.editingKey)).map((node) => [node.path, node])).values()];
    const search = (0, import_obsidian5.prepareFuzzySearch)(title);
    const matches = unique.map((node) => ({ node, match: title ? search(node.label) : { score: 0 } })).filter((item) => item.match).sort((a, b) => Number(b.node.ownerPath === this.owner) - Number(a.node.ownerPath === this.owner) || b.match.score - a.match.score).slice(0, 49);
    const options = this.insertion ? [] : matches.map(({ node }) => ({ kind: node.ownerPath === this.owner ? "reuse" : "reference", node }));
    return options;
  }
  renderSuggestion(candidate, el) {
    var _a;
    el.addClass("mod-complex");
    const content = el.createDiv({ cls: "suggestion-content" });
    content.createDiv({ cls: "suggestion-title", text: candidate.node.label });
    content.createDiv({ cls: "suggestion-note", text: (_a = candidate.node.ownerPath) != null ? _a : "" });
  }
  selectSuggestion(candidate, event) {
    if (this.disposed || this.isComposing() || event.isComposing) return;
    this.setValue(candidate.node.label);
    this.close();
    this.choose(candidate);
  }
  dispose() {
    this.disposed = true;
    this.close();
  }
};

// src/node-title-input.ts
function titleKeyAction(event) {
  if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return "none";
  if (event.key === "Escape") return "cancel";
  if (event.key === "Enter") return "commit";
  if (event.key === "Tab" && !event.shiftKey) return "continue";
  return "none";
}

// src/graph-wheel.ts
function isMacTrackpadPan(event, platform) {
  if (!/Mac/i.test(platform) || event.ctrlKey || event.deltaMode !== 0) return false;
  if (event.deltaY === 0) return event.deltaX !== 0;
  if (typeof event.wheelDeltaY === "number") {
    return Math.abs(event.wheelDeltaY + event.deltaY * 3) < 0.01;
  }
  return !Number.isInteger(event.deltaY) || !Number.isInteger(event.deltaX);
}

// src/mind-view-mode.ts
var VIEW_TYPE = "brainos-graph-view";
var MindViewMode = class {
  constructor() {
    __publicField(this, "markdown", /* @__PURE__ */ new WeakMap());
    __publicField(this, "switching", /* @__PURE__ */ new WeakSet());
  }
  async showMind(leaf, file) {
    if (this.switching.has(leaf)) return;
    this.switching.add(leaf);
    try {
      if (leaf.view.getViewType() === "markdown") {
        const state = leaf.view.getState();
        if (state.file === file) this.markdown.set(leaf, { file, state: { ...state }, ephemeral: leaf.view.getEphemeralState() });
      }
      await leaf.setViewState({ type: VIEW_TYPE, state: { file }, active: true });
    } finally {
      this.switching.delete(leaf);
    }
  }
  async showMarkdown(leaf, file) {
    if (this.switching.has(leaf)) return;
    this.switching.add(leaf);
    try {
      const saved = this.markdown.get(leaf);
      const sameFile = (saved == null ? void 0 : saved.file) === file;
      await leaf.setViewState({ type: "markdown", state: sameFile ? { ...saved.state, file } : { file, mode: "source" }, active: true });
      if (sameFile) leaf.view.setEphemeralState(saved.ephemeral);
    } finally {
      this.switching.delete(leaf);
    }
  }
};

// src/graph-view.ts
var MIN_ZOOM = 0.05;
var MAX_ZOOM = 8;
var BrainOSGraphView = class extends import_obsidian6.FileView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    __publicField(this, "canvas");
    __publicField(this, "search");
    __publicField(this, "status");
    __publicField(this, "snapshot", { nodes: [], edges: [], thoughts: [] });
    __publicField(this, "nodes", []);
    __publicField(this, "edges", []);
    __publicField(this, "thoughtPath", "");
    __publicField(this, "zoom", 1);
    __publicField(this, "pan", { x: 0, y: 0 });
    __publicField(this, "selected");
    __publicField(this, "selectedNodes", /* @__PURE__ */ new Set());
    __publicField(this, "suppressContextMenu", false);
    __publicField(this, "hoveredEdge");
    __publicField(this, "hovered");
    __publicField(this, "gesture");
    __publicField(this, "editor");
    __publicField(this, "editingNode");
    __publicField(this, "titleSuggest");
    __publicField(this, "busy", false);
    __publicField(this, "refreshRevision", 0);
    __publicField(this, "closed", false);
    __publicField(this, "forceLayout", new GraphLayout(() => {
      if (this.closed) return;
      this.startLayoutAnimation();
      this.draw();
      if (!this.forceLayout.isRunning) this.scheduleLayoutSave();
    }));
    __publicField(this, "controls");
    __publicField(this, "searchTimer");
    __publicField(this, "localCenter");
    __publicField(this, "cameraFrame");
    __publicField(this, "targetZoom");
    __publicField(this, "zoomAnchor");
    __publicField(this, "animationFrame");
    __publicField(this, "layoutSaveTimer");
    __publicField(this, "layoutSaveFingerprint", "");
    __publicField(this, "currentViewportKey");
    __publicField(this, "initialRefreshFrame");
    __publicField(this, "rendererFrame");
    __publicField(this, "rendererLastDraw", 0);
    __publicField(this, "rendererOpacity", /* @__PURE__ */ new Map());
    __publicField(this, "draftNode");
    __publicField(this, "draftParent");
    __publicField(this, "draftChild");
    __publicField(this, "composing", false);
    __publicField(this, "touchPoints", /* @__PURE__ */ new Map());
    __publicField(this, "searchBox");
    __publicField(this, "searchButton");
    __publicField(this, "controlsButton");
    __publicField(this, "touchPan");
    this.allowNoFile = true;
  }
  get graphOptions() {
    return this.plugin.layout.graph.display;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    var _a, _b;
    return (_b = (_a = this.file) == null ? void 0 : _a.basename) != null ? _b : "\u601D\u7EF4\u89C6\u56FE";
  }
  getIcon() {
    return "git-branch";
  }
  canAcceptExtension(extension) {
    return extension === "md";
  }
  get source() {
    return this.file ? "thoughts" : this.plugin.layout.graph.source;
  }
  async onLoadFile(file) {
    this.closeEditor();
    this.file = file;
    this.thoughtPath = file.path;
    this.localCenter = void 0;
    this.selected = void 0;
    this.selectedNodes.clear();
    this.hovered = void 0;
    this.restoreViewport();
    if (this.canvas) await this.refresh();
  }
  async onUnloadFile() {
    this.closeEditor();
    this.persistViewport();
  }
  async onRename(file) {
    await super.onRename(file);
    this.thoughtPath = file.path;
    this.localCenter = void 0;
    await this.refresh();
  }
  async onOpen() {
    var _a;
    this.closed = false;
    this.contentEl.empty();
    this.contentEl.addClass("brainos-graph-view");
    const edit = this.addAction("pencil", "\u5207\u6362\u5230\u7F16\u8F91\u89C6\u56FE", () => {
      if (this.file) void this.plugin.openMarkdownView(this.leaf, this.file);
      else new import_obsidian6.Notice("\u5148\u6253\u5F00\u4E00\u7BC7\u7B14\u8BB0\uFF0C\u6216\u901A\u8FC7\u547D\u4EE4\u300CBrainOS Graph\uFF1A\u65B0\u5EFA\u601D\u8003\u300D\u5F00\u59CB");
    });
    edit.addClass("brainos-edit-view-action");
    (_a = edit.parentElement) == null ? void 0 : _a.prepend(edit);
    const tools = this.contentEl.createDiv({ cls: "brainos-graph-tools" });
    this.searchButton = tools.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "\u641C\u7D22\u8282\u70B9", "aria-expanded": "false", title: "\u641C\u7D22\u8282\u70B9\uFF08\u2318/Ctrl F\uFF09" } });
    (0, import_obsidian6.setIcon)(this.searchButton, "search");
    this.searchButton.onclick = () => this.toggleSearch();
    this.controlsButton = tools.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "\u56FE\u8C31\u8BBE\u7F6E", "aria-expanded": "false", title: "\u56FE\u8C31\u8BBE\u7F6E" } });
    (0, import_obsidian6.setIcon)(this.controlsButton, "sliders-horizontal");
    this.controlsButton.onclick = () => this.toggleControls();
    this.searchBox = this.contentEl.createDiv({ cls: "brainos-graph-search" });
    this.searchBox.hidden = true;
    this.search = this.searchBox.createEl("input", { type: "search", placeholder: "\u641C\u7D22\u8282\u70B9\u2026", attr: { "aria-label": "\u641C\u7D22\u8282\u70B9" } });
    this.search.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.toggleSearch(false);
      }
    };
    this.search.oninput = () => {
      if (this.searchTimer !== void 0) window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.searchTimer = void 0;
        if (!this.closed) {
          this.filterSnapshot();
          this.draw();
        }
      }, 250);
    };
    this.forceLayout.configure(graphForces(this.plugin.layout.graph));
    this.canvas = this.contentEl.createEl("canvas", { cls: "brainos-graph-canvas", attr: { "aria-label": "\u601D\u7EF4\u89C6\u56FE\uFF0C\u53EF\u7528 Tab \u5EF6\u4F38\u8282\u70B9\u3001Enter \u521B\u5EFA\u540C\u7EA7\u8282\u70B9\u3001\u7A7A\u683C\u7F16\u8F91\u8282\u70B9\u6807\u9898" } });
    this.canvas.tabIndex = 0;
    this.status = this.contentEl.createDiv({ cls: "brainos-graph-status" });
    this.registerDomEvent(this.canvas, "pointerdown", (event) => this.onPointerDown(event));
    this.registerDomEvent(this.canvas, "pointermove", (event) => this.onPointerMove(event));
    this.registerDomEvent(this.canvas, "pointerup", (event) => this.onPointerUp(event));
    this.registerDomEvent(this.canvas, "pointerleave", () => {
      if (!this.gesture) {
        this.hovered = void 0;
        this.clearEdgeHover();
        this.draw();
      }
    });
    this.registerDomEvent(this.canvas, "pointercancel", (event) => this.onPointerCancel(event));
    this.registerDomEvent(this.canvas, "lostpointercapture", (event) => this.onPointerCancel(event));
    this.registerDomEvent(this.canvas, "wheel", (event) => this.onWheel(event), { passive: false });
    this.registerDomEvent(this.canvas, "dblclick", (event) => this.onDoubleClick(event));
    this.registerDomEvent(this.canvas, "contextmenu", (event) => this.onContextMenu(event));
    this.registerDomEvent(this.canvas, "keydown", (event) => this.onKeyDown(event));
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(this.contentEl);
    this.register(() => observer.disconnect());
    this.initialRefreshFrame = requestAnimationFrame(() => {
      this.initialRefreshFrame = void 0;
      if (!this.closed && !this.file) void this.refresh();
    });
    this.canvas.focus();
  }
  async onClose() {
    var _a;
    this.closed = true;
    this.refreshRevision++;
    if (this.initialRefreshFrame !== void 0) cancelAnimationFrame(this.initialRefreshFrame);
    this.initialRefreshFrame = void 0;
    if (this.animationFrame !== void 0) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = void 0;
    if (this.layoutSaveTimer !== void 0) window.clearTimeout(this.layoutSaveTimer);
    this.layoutSaveTimer = void 0;
    this.persistLayoutPositions();
    this.persistViewport();
    if (this.searchTimer !== void 0) window.clearTimeout(this.searchTimer);
    if (this.rendererFrame !== void 0) cancelAnimationFrame(this.rendererFrame);
    if (this.cameraFrame !== void 0) cancelAnimationFrame(this.cameraFrame);
    this.rendererFrame = void 0;
    this.cameraFrame = void 0;
    this.forceLayout.dispose();
    (_a = this.controls) == null ? void 0 : _a.remove();
    this.controls = void 0;
    this.cancelGesture();
    this.closeEditor();
  }
  async refresh() {
    var _a;
    const revision = ++this.refreshRevision;
    const thoughtFiles = this.app.vault.getMarkdownFiles().filter((file) => {
      var _a2, _b;
      if (!isThoughtFile(file.path, this.plugin.layout.settings.noteFolder)) return false;
      const cache = this.app.metadataCache.getFileCache(file);
      return ((_a2 = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a2.brainos_type) === "thought-file" || !!((_b = cache == null ? void 0 : cache.listItems) == null ? void 0 : _b.length);
    });
    const thoughts = thoughtFiles.map((file) => {
      var _a2, _b, _c;
      return { path: file.path, title: String((_c = (_b = (_a2 = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a2.frontmatter) == null ? void 0 : _b.title) != null ? _c : file.basename) };
    });
    const snapshot = this.source === "vault" ? buildVaultSnapshot(this.app, thoughts, this.plugin.layout.graph.filter, this.plugin.layout.settings.noteFolder) : await buildThoughtSnapshot(this.app, (_a = this.file) != null ? _a : void 0, this.plugin.layout.settings.noteFolder);
    if (this.closed || revision !== this.refreshRevision) return;
    this.snapshot = snapshot;
    this.forceLayout.configure(graphForces(this.plugin.layout.graph));
    if (this.thoughtPath && !snapshot.thoughts.some((thought) => thought.path === this.thoughtPath)) this.thoughtPath = "";
    if (this.currentViewportKey !== this.viewportKey()) this.restoreViewport();
    this.filterSnapshot();
    if (this.selected && !this.nodes.some((node) => node.path === this.selected)) this.selected = void 0;
    this.forceLayout.setSelected(this.selected);
    this.startLayoutAnimation();
    this.resize();
  }
  filterSnapshot() {
    var _a, _b;
    const base = this.source === "thoughts" && this.thoughtPath ? { ...this.snapshot, nodes: this.snapshot.nodes.filter((node) => node.thoughts.includes(this.thoughtPath)), edges: this.snapshot.edges.filter((edge) => edge.thoughts.includes(this.thoughtPath)) } : this.snapshot;
    const visible = { ...base, nodes: base.nodes.filter((node) => !this.plugin.layout.graph.hiddenPaths.includes(node.path)) };
    const result = selectGraph(visible, (_b = (_a = this.search) == null ? void 0 : _a.value.trim()) != null ? _b : "", this.plugin.layout.graph.filter, this.localCenter);
    this.nodes = this.draftNode ? result.nodes.filter((node) => !node.placeholder) : result.nodes;
    this.edges = result.edges;
    this.selectedNodes = new Set([...this.selectedNodes].filter((path) => this.nodes.some((node) => node.path === path)));
    if (this.draftNode) {
      this.nodes.push(this.draftNode);
      if (this.draftChild) {
        this.edges = this.edges.filter((edge) => edge.from !== this.draftParent || edge.to !== this.draftChild);
        this.edges.push({ from: this.draftNode.path, to: this.draftChild, thoughts: [] });
      }
      if (this.draftParent && this.nodes.some((node) => node.path === this.draftParent)) this.edges.push({ from: this.draftParent, to: this.draftNode.path, thoughts: [] });
    }
    if (this.selected && !this.nodes.some((node) => node.path === this.selected)) this.selected = void 0;
    if (this.hovered && !this.nodes.some((node) => node.path === this.hovered)) this.hovered = void 0;
    this.forceLayout.sync(this.nodes, this.edges, this.plugin.layout.positions);
    this.forceLayout.setSelected(this.selected);
    this.startLayoutAnimation();
  }
  toggleSearch(show = ((_b) => (_b = ((_a) => (_a = this.searchBox) == null ? void 0 : _a.hidden)()) != null ? _b : true)()) {
    var _a2;
    if (!this.searchBox) return;
    this.searchBox.hidden = !show;
    (_a2 = this.searchButton) == null ? void 0 : _a2.setAttribute("aria-expanded", String(show));
    if (show) {
      this.search.focus();
      this.search.select();
    } else {
      this.search.value = "";
      this.filterSnapshot();
      this.draw();
      this.canvas.focus();
    }
  }
  onPaneMenu(menu, source) {
    super.onPaneMenu(menu, source);
    if (this.file) menu.addItem((item) => item.setTitle("\u5207\u6362\u5230\u7F16\u8F91\u89C6\u56FE").setIcon("pencil").onClick(() => void this.plugin.openMarkdownView(this.leaf, this.file)));
    menu.addItem((item) => item.setTitle("\u65B0\u5EFA\u601D\u8003").setIcon("file-plus").onClick(() => void this.plugin.createNewThought()));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("\u65B0\u5EFA\u8282\u70B9").setIcon("plus").onClick(() => void this.beginCreate(this.screenToWorld(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2))));
    menu.addItem((item) => item.setTitle("\u5F15\u7528\u5DF2\u6709\u8282\u70B9\u2026").setIcon("link").onClick(() => void this.openReferencePicker()));
    menu.addItem((item) => item.setTitle("\u5EF6\u4F38\u8282\u70B9\uFF08Tab\uFF09").setIcon("git-branch").onClick(() => void this.createRelative(true)));
    menu.addItem((item) => item.setTitle("\u9002\u914D\u56FE\u8C31\uFF08F\uFF09").setIcon("maximize").onClick(() => this.fitToView()));
    menu.addItem((item) => item.setTitle("\u805A\u7126\u5F53\u524D\u7B14\u8BB0").setIcon("focus").onClick(() => this.focusCurrent()));
    if (!this.file && this.source === "vault") menu.addItem((item) => item.setTitle(this.localCenter ? "\u663E\u793A\u5168\u90E8\u7B14\u8BB0" : "\u53EA\u770B\u9009\u4E2D\u8282\u70B9\u7684\u90BB\u57DF").setIcon("network").onClick(() => {
      var _a;
      const path = (_a = this.selected) != null ? _a : this.plugin.lastMarkdownPath;
      if (!this.localCenter && !this.snapshot.nodes.some((node) => node.path === path)) {
        new import_obsidian6.Notice("\u8BF7\u5148\u9009\u4E2D\u4E00\u4E2A\u8282\u70B9");
        return;
      }
      this.localCenter = this.localCenter ? void 0 : path;
      this.filterSnapshot();
      this.fitToView();
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("\u56FE\u8C31\u8BBE\u7F6E").setIcon("sliders-horizontal").onClick(() => this.toggleControls()));
    menu.addItem((item) => item.setTitle("\u5237\u65B0\u56FE\u8C31").setIcon("refresh-cw").onClick(() => void this.refresh()));
    menu.addItem((item) => item.setTitle(this.plugin.activeSession ? "\u7ED3\u675F Session" : "\u5F00\u59CB Session").setIcon("clock").onClick(() => {
      if (this.plugin.activeSession) this.plugin.endSession();
      else this.plugin.startSession(this.thoughtPath || void 0);
    }));
    menu.addItem((item) => item.setTitle("\u64CD\u4F5C\u63D0\u793A").setIcon("circle-help").onClick(() => {
      new import_obsidian6.Notice("\u53CC\u51FB\u7A7A\u767D\u65B0\u5EFA \xB7 Tab \u7EE7\u7EED \xB7 Enter \u540C\u8D77\u70B9\u5206\u652F \xB7 \u7A7A\u683C\u7F16\u8F91\u6807\u9898 \xB7 \u2318/Ctrl Enter \u63D2\u5165\u7236\u8282\u70B9 \xB7 Alt \u62D6\u52A8\u8FDE\u7EBF \xB7 F \u9002\u914D\u56FE\u8C31", 1e4);
    }));
  }
  toggleControls() {
    var _a, _b;
    if (this.controls) {
      this.controls.remove();
      this.controls = void 0;
      (_a = this.controlsButton) == null ? void 0 : _a.setAttribute("aria-expanded", "false");
      return;
    }
    const panel = this.contentEl.createDiv({ cls: "brainos-graph-controls" });
    this.controls = panel;
    (_b = this.controlsButton) == null ? void 0 : _b.setAttribute("aria-expanded", "true");
    const heading = panel.createDiv({ cls: "brainos-controls-heading" });
    heading.createEl("strong", { text: "\u56FE\u8C31\u8BBE\u7F6E" });
    const close = heading.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "\u5173\u95ED\u56FE\u8C31\u8BBE\u7F6E" } });
    (0, import_obsidian6.setIcon)(close, "x");
    close.onclick = () => this.toggleControls();
    const settings = this.plugin.layout.graph;
    if (!this.file) {
      new import_obsidian6.Setting(panel).setName("\u56FE\u8C31\u6765\u6E90").addDropdown((control) => control.addOptions({ vault: "\u7B14\u8BB0\u53CC\u94FE", thoughts: "\u601D\u7EF4\u8282\u70B9" }).setValue(this.source).onChange((value) => {
        settings.source = value;
        this.thoughtPath = "";
        this.localCenter = void 0;
        void this.plugin.saveLayout();
        void this.refresh();
        this.toggleControls();
      }));
      if (this.source === "thoughts") {
        const options = { "": "\u5168\u90E8\u601D\u8003" };
        for (const thought of this.snapshot.thoughts) options[thought.path] = thought.title;
        new import_obsidian6.Setting(panel).setName("\u5F53\u524D\u601D\u8003").addDropdown((control) => control.addOptions(options).setValue(this.thoughtPath).onChange((value) => {
          this.persistViewport();
          this.closeEditor();
          this.thoughtPath = value;
          this.selectedNodes.clear();
          this.selected = void 0;
          this.restoreViewport();
          this.filterSnapshot();
          this.draw();
        }));
      }
    }
    const save = () => {
      void this.plugin.saveLayout();
    };
    const slider = (name, value, min, max, step, change) => {
      new import_obsidian6.Setting(panel).setName(name).addSlider((control) => control.setLimits(min, max, step).setValue(value).setDynamicTooltip().onChange((value2) => {
        change(value2);
        save();
        this.draw();
      }));
    };
    panel.createEl("h3", { text: "\u663E\u793A" });
    slider("\u8282\u70B9\u5927\u5C0F", settings.display.nodeSizeMultiplier, 0.25, 3, 0.05, (value) => settings.display.nodeSizeMultiplier = value);
    slider("\u8FDE\u7EBF\u7C97\u7EC6", settings.display.lineSizeMultiplier, 0.1, 5, 0.1, (value) => settings.display.lineSizeMultiplier = value);
    slider("\u6587\u5B57\u6DE1\u51FA\u9608\u503C", settings.display.textFadeMultiplier, -3, 3, 0.1, (value) => settings.display.textFadeMultiplier = value);
    new import_obsidian6.Setting(panel).setName("\u663E\u793A\u7BAD\u5934").addToggle((control) => control.setValue(settings.display.showArrows).onChange((value) => {
      settings.display.showArrows = value;
      save();
      this.draw();
    }));
    panel.createEl("h3", { text: "\u529B\u5B66" });
    const forces = (key, value) => {
      settings.forces[key] = value;
      this.forceLayout.configure(graphForces(settings));
      this.startLayoutAnimation();
    };
    slider("\u4E2D\u5FC3\u529B", settings.forces.center, 0, 1, 0.01, (value) => forces("center", value));
    slider("\u6392\u65A5\u529B", settings.forces.repel, 0, 20, 0.1, (value) => forces("repel", value));
    slider("\u8FDE\u63A5\u529B", settings.forces.link, 0, 1, 0.01, (value) => forces("link", value));
    slider("\u8FDE\u63A5\u957F\u5EA6", settings.forces.distance, 30, 500, 1, (value) => forces("distance", value));
    panel.createEl("h3", { text: "\u7B5B\u9009" });
    new import_obsidian6.Setting(panel).setName("\u6062\u590D\u9690\u85CF\u7684\u8282\u70B9").addButton((button) => button.setButtonText("\u6062\u590D").onClick(() => {
      settings.hiddenPaths = [];
      save();
      this.filterSnapshot();
      this.draw();
    }));
    const toggle = (name, key) => new import_obsidian6.Setting(panel).setName(name).addToggle((control) => control.setValue(settings.filter[key]).onChange((value) => {
      settings.filter[key] = value;
      save();
      void this.refresh();
    }));
    toggle("\u6807\u7B7E", "showTags");
    toggle("\u9644\u4EF6", "showAttachments");
    toggle("\u672A\u521B\u5EFA\u7684\u7B14\u8BB0", "showUnresolved");
    toggle("\u5B64\u7ACB\u8282\u70B9", "showOrphans");
    slider("\u5C40\u90E8\u56FE\u8C31\u6DF1\u5EA6", settings.filter.localDepth, 1, 5, 1, (value) => {
      settings.filter.localDepth = value;
      this.filterSnapshot();
    });
    toggle("\u5C40\u90E8\u56FE\u8C31\u5165\u94FE", "localIncoming");
    toggle("\u5C40\u90E8\u56FE\u8C31\u51FA\u94FE", "localOutgoing");
    new import_obsidian6.Setting(panel).setName("\u6062\u590D\u9ED8\u8BA4\u56FE\u8C31").addButton((button) => button.setButtonText("\u91CD\u7F6E").onClick(() => {
      var _a2, _b2;
      const currentSource = settings.source;
      this.plugin.layout.graph = defaultGraphOptions();
      this.plugin.layout.graph.source = currentSource;
      this.plugin.layout.positions = {};
      this.forceLayout.reset();
      this.forceLayout.configure(graphForces(this.plugin.layout.graph));
      (_a2 = this.controls) == null ? void 0 : _a2.remove();
      this.controls = void 0;
      (_b2 = this.controlsButton) == null ? void 0 : _b2.setAttribute("aria-expanded", "false");
      save();
      void this.refresh();
    }));
  }
  startLayoutAnimation() {
    if (this.closed || this.animationFrame !== void 0 || !this.forceLayout.isRunning) return;
    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = void 0;
      if (this.closed) return;
      this.forceLayout.tick(this.nodes);
      this.draw();
      if (this.forceLayout.isRunning) this.startLayoutAnimation();
      else this.scheduleLayoutSave();
    });
  }
  scheduleLayoutSave() {
    if (this.layoutSaveTimer !== void 0 || this.closed) return;
    this.layoutSaveTimer = window.setTimeout(() => {
      this.layoutSaveTimer = void 0;
      this.persistLayoutPositions();
    }, 500);
  }
  persistLayoutPositions() {
    const positions = this.forceLayout.snapshot();
    if (this.draftNode) delete positions[this.draftNode.path];
    const fingerprint = JSON.stringify(positions);
    let changed = false;
    if (fingerprint !== this.layoutSaveFingerprint) {
      this.layoutSaveFingerprint = fingerprint;
      Object.assign(this.plugin.layout.positions, positions);
      changed = true;
    }
    changed = this.persistViewport() || changed;
    if (changed) void this.plugin.saveLayout();
  }
  viewportKey() {
    return this.file ? `file:${this.file.path}` : this.thoughtPath || "__all__";
  }
  restoreViewport() {
    var _a;
    this.currentViewportKey = this.viewportKey();
    const saved = (_a = this.plugin.layout.viewports) == null ? void 0 : _a[this.viewportKey()];
    if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y) || !Number.isFinite(saved.zoom)) {
      this.pan = { x: 0, y: 0 };
      this.zoom = 1;
      return;
    }
    this.pan = { x: saved.x, y: saved.y };
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, saved.zoom));
  }
  persistViewport() {
    if (!this.plugin.layout.viewports) this.plugin.layout.viewports = {};
    const next = { x: this.pan.x, y: this.pan.y, zoom: this.zoom };
    const previous = this.plugin.layout.viewports[this.viewportKey()];
    if (previous && previous.x === next.x && previous.y === next.y && previous.zoom === next.zoom) return false;
    this.plugin.layout.viewports[this.viewportKey()] = next;
    return true;
  }
  fitToView() {
    var _a;
    const points = this.nodes.filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y));
    if (!points.length) {
      this.pan = { x: 0, y: 0 };
      this.zoom = 1;
      this.persistViewport();
      this.draw();
      return;
    }
    const minX = Math.min(...points.map((node) => node.x));
    const maxX = Math.max(...points.map((node) => node.x));
    const minY = Math.min(...points.map((node) => node.y));
    const maxY = Math.max(...points.map((node) => node.y));
    const width = Math.max(1, maxX - minX), height = Math.max(1, maxY - minY);
    const padding = 110;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((this.canvas.clientWidth - padding) / width, (this.canvas.clientHeight - padding) / height)));
    this.pan = { x: -(minX + maxX) / 2, y: -(minY + maxY) / 2 };
    this.persistViewport();
    this.draw();
    (_a = this.canvas) == null ? void 0 : _a.focus();
  }
  focusCurrent() {
    var _a, _b, _c, _d, _e;
    const file = (_d = (_b = this.file) != null ? _b : (_a = this.app.workspace.getActiveViewOfType(import_obsidian6.MarkdownView)) == null ? void 0 : _a.file) != null ? _d : this.app.vault.getAbstractFileByPath((_c = this.plugin.lastMarkdownPath) != null ? _c : "");
    if (!(file instanceof import_obsidian6.TFile)) {
      new import_obsidian6.Notice("\u5F53\u524D\u6CA1\u6709\u6253\u5F00\u7684 Markdown \u7B14\u8BB0");
      return;
    }
    const node = (_e = this.nodes.find((item) => item.ownerPath === file.path)) != null ? _e : this.nodes.find((item) => item.openPath === file.path);
    if (!node) {
      new import_obsidian6.Notice("\u5F53\u524D\u6587\u4EF6\u672A\u51FA\u73B0\u5728\u6240\u9009\u601D\u8003\u56FE\u8C31\u4E2D");
      return;
    }
    this.selectedNodes.clear();
    this.selected = node.path;
    this.hovered = node.path;
    this.forceLayout.setSelected(this.selected);
    this.pan = { x: -node.x, y: -node.y };
    this.scheduleLayoutSave();
    this.startLayoutAnimation();
    this.draw();
    this.canvas.focus();
  }
  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.draw();
  }
  worldToScreen(point) {
    return { x: this.canvas.clientWidth / 2 + (point.x + this.pan.x) * this.zoom, y: this.canvas.clientHeight / 2 + (point.y + this.pan.y) * this.zoom };
  }
  screenToWorld(x, y) {
    return { x: (x - this.canvas.clientWidth / 2) / this.zoom - this.pan.x, y: (y - this.canvas.clientHeight / 2) / this.zoom - this.pan.y };
  }
  nodeAt(x, y) {
    var _a;
    let closest;
    let closestDistance = Infinity;
    for (const node of this.nodes) {
      const point = this.worldToScreen(node);
      const radius = nodeScreenRadius((_a = node.weight) != null ? _a : node.degree, this.zoom, this.graphOptions.nodeSizeMultiplier);
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= Math.max(radius + 3, 10) && distance < closestDistance) {
        closest = node;
        closestDistance = distance;
      }
    }
    return closest;
  }
  draw() {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!this.canvas || this.closed) return;
    if (this.hoveredEdge && !this.edges.includes(this.hoveredEdge)) this.clearEdgeHover();
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const colors = getComputedStyle(this.canvas);
    const color = (...properties) => {
      for (const property of properties) {
        const value = colors.getPropertyValue(property).trim();
        if (value) return value;
      }
      return "#888888";
    };
    const edgeColor = color("--graph-line", "--brainos-edge", "--background-modifier-border");
    const fill = color("--graph-node", "--text-muted");
    const focusedFill = color("--graph-node-focused", "--text-accent", "--interactive-accent");
    const accent = color("--interactive-accent", "--text-accent");
    const text = color("--graph-text", "--text-normal");
    const dim = color("--graph-node-unresolved", "--text-faint");
    const typeColors = {
      tag: color("--graph-node-tag", "--color-green"),
      attachment: color("--graph-node-attachment", "--color-yellow"),
      unresolved: dim,
      note: fill
    };
    const options = this.graphOptions;
    const zoom = Math.max(1e-4, this.zoom), visualScale = Math.sqrt(zoom);
    const query = this.search.value.trim().toLocaleLowerCase();
    const matches = new Set(query ? this.nodes.filter((node) => node.label.toLocaleLowerCase().includes(query) || node.path.toLocaleLowerCase().includes(query)).map((node) => node.path) : []);
    const byPath = new Map(this.nodes.map((node) => [node.path, node]));
    const focus = this.hovered && byPath.has(this.hovered) ? this.hovered : this.selected;
    const neighbors = /* @__PURE__ */ new Set();
    if (focus) for (const edge of this.edges) {
      if (edge.from === focus) neighbors.add(edge.to);
      if (edge.to === focus) neighbors.add(edge.from);
    }
    const now = performance.now();
    const elapsed = this.rendererLastDraw ? now - this.rendererLastDraw : 16.67;
    this.rendererLastDraw = now;
    let fading = false;
    const alive = /* @__PURE__ */ new Set();
    const opacity = (key, target) => {
      var _a2;
      if (alive.has(key)) return this.rendererOpacity.get(key);
      alive.add(key);
      const value = approachOpacity((_a2 = this.rendererOpacity.get(key)) != null ? _a2 : 1, target, elapsed);
      this.rendererOpacity.set(key, value);
      if (value !== target) fading = true;
      return value;
    };
    const points = new Map(this.nodes.map((node) => [node.path, this.worldToScreen(node)]));
    const radii = new Map(this.nodes.map((node) => {
      var _a2;
      return [
        node.path,
        nodeScreenRadius((_a2 = node.weight) != null ? _a2 : node.degree, zoom, options.nodeSizeMultiplier)
      ];
    }));
    const directions = new Set(this.edges.map((edge) => JSON.stringify([edge.from, edge.to])));
    let flowing = false;
    ctx.lineCap = "round";
    for (const edge of this.edges) {
      const a = byPath.get(edge.from), b = byPath.get(edge.to);
      const p = points.get(edge.from), q = points.get(edge.to);
      if (!a || !b || !p || !q || edge.from === edge.to) continue;
      const edgeSelected = !!this.hoveredEdge && edgeStrokeKey(edge.from, edge.to) === edgeStrokeKey(this.hoveredEdge.from, this.hoveredEdge.to);
      const edgeActive = edgeSelected || edge.from === focus || edge.to === focus;
      const strokeKey = edgeStrokeKey(edge.from, edge.to);
      const alpha = opacity("e:" + strokeKey, !focus || edgeActive ? 1 : 0.2);
      if (!edgeInViewport(p, q, width, height, options.lineSizeMultiplier + 2)) continue;
      const dx = q.x - p.x, dy = q.y - p.y, distance = Math.hypot(dx, dy);
      if (!Number.isFinite(distance) || distance < 1e-3) continue;
      const ux = dx / distance, uy = dy / distance;
      const sourceRadius = radii.get(a.path), targetRadius = radii.get(b.path);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = edgeActive ? accent : edgeColor;
      ctx.lineWidth = Math.max(0.1, options.lineSizeMultiplier) + (edgeSelected ? 2 : 0);
      const lane = directions.has(JSON.stringify([edge.to, edge.from])) ? 3 : 0;
      if (distance > sourceRadius + targetRadius) {
        flowing = true;
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -(now / 1e3 * 28) % 14;
        ctx.beginPath();
        ctx.moveTo(p.x + ux * sourceRadius - uy * lane, p.y + uy * sourceRadius + ux * lane);
        ctx.lineTo(q.x - ux * targetRadius - uy * lane, q.y - uy * targetRadius + ux * lane);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
      if (options.showArrows && distance > sourceRadius + targetRadius + 10) {
        const arrowAlpha = Math.max(0, Math.min(1, 2 * (zoom - 0.3)));
        ctx.globalAlpha = alpha * arrowAlpha * 0.5;
        ctx.fillStyle = text;
        const tipX = q.x - ux * (targetRadius + 1), tipY = q.y - uy * (targetRadius + 1);
        const size = 8 * Math.sqrt(Math.max(0.1, options.lineSizeMultiplier));
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - ux * size - uy * size * 0.5, tipY - uy * size + ux * size * 0.5);
        ctx.lineTo(tipX - ux * size + uy * size * 0.5, tipY - uy * size - ux * size * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (((_a = this.gesture) == null ? void 0 : _a.kind) === "link") {
      const point = this.worldToScreen(this.gesture.node);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(this.gesture.end.x, this.gesture.end.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const labelAlpha = graphLabelAlpha(zoom, options.textFadeMultiplier);
    const fontFamily = colors.getPropertyValue("--font-interface").trim() || colors.getPropertyValue("--font-text").trim() || "sans-serif";
    const orderedNodes = this.nodes.filter((node) => node.path !== focus);
    const focusedNode = focus ? byPath.get(focus) : void 0;
    if (focusedNode) orderedNodes.push(focusedNode);
    for (const node of orderedNodes) {
      const point = points.get(node.path), radius = radii.get(node.path);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const isFocus = node.path === focus, isMatch = matches.has(node.path);
      const alpha = opacity("n:" + node.path, !focus || isFocus || neighbors.has(node.path) ? 1 : 0.2);
      const kind = (_b = node.kind) != null ? _b : "note";
      const circleVisible = intersectsViewport({
        left: point.x - radius - 3,
        right: point.x + radius + 3,
        top: point.y - radius - 3,
        bottom: point.y + radius + 3
      }, width, height);
      if (circleVisible) {
        ctx.globalAlpha = alpha * (kind === "unresolved" || node.placeholder ? 0.5 : 1);
        ctx.fillStyle = isFocus ? accent : node.path === this.selected || this.selectedNodes.has(node.path) ? focusedFill : isMatch ? focusedFill : node.placeholder ? dim : typeColors[kind];
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
        if (isFocus || node.path === this.selected || this.selectedNodes.has(node.path)) {
          ctx.strokeStyle = focusedFill;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(point.x, point.y, radius + 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (node.path === ((_c = this.draftNode) == null ? void 0 : _c.path) || node.path === ((_d = this.editingNode) == null ? void 0 : _d.path)) continue;
      const alphaText = isFocus ? 1 : labelAlpha * alpha;
      if (alphaText <= 1e-3) continue;
      const baseSize = nodeScreenRadius((_e = node.weight) != null ? _e : node.degree, 1, options.nodeSizeMultiplier);
      const labelScale = isFocus && zoom < 1 ? 1 : visualScale;
      const fontSize = (14 + baseSize / 4) * labelScale;
      const textTop = point.y + radius + 5 * labelScale + (isFocus ? 15 : 0);
      const maxWidth = Math.min(300 * labelScale, Math.max(80, width - 24));
      const lineHeight = fontSize * 1.2;
      if (!intersectsViewport({
        left: point.x - maxWidth / 2,
        right: point.x + maxWidth / 2,
        top: textTop,
        bottom: textTop + lineHeight * (isFocus ? 8 : 4)
      }, width, height)) continue;
      ctx.font = `${fontSize}px ${fontFamily}`;
      const lines = wrapGraphLabel(node.label, (value) => ctx.measureText(value).width, maxWidth, isFocus ? 8 : 4);
      ctx.globalAlpha = alphaText;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = text;
      lines.forEach((line, index) => ctx.fillText(line, point.x, textTop + index * lineHeight));
    }
    for (const key of this.rendererOpacity.keys()) if (!alive.has(key)) this.rendererOpacity.delete(key);
    ctx.globalAlpha = 1;
    if (((_f = this.gesture) == null ? void 0 : _f.kind) === "box" && this.gesture.moved) {
      const { start, end } = this.gesture;
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(end.x - start.x), Math.abs(end.y - start.y));
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(end.x - start.x), Math.abs(end.y - start.y));
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if ((fading || flowing) && this.rendererFrame === void 0 && width > 0 && height > 0) {
      const animate = (time) => {
        this.rendererFrame = void 0;
        if (this.closed) return;
        if (time - this.rendererLastDraw < 32) {
          this.rendererFrame = requestAnimationFrame(animate);
          return;
        }
        this.draw();
      };
      this.rendererFrame = requestAnimationFrame(animate);
    }
    let empty = this.contentEl.querySelector(".brainos-graph-empty");
    if (!this.nodes.length && !empty) empty = this.contentEl.createDiv({ cls: "brainos-graph-empty", text: "\u53CC\u51FB\u7A7A\u767D\uFF0C\u5199\u4E0B\u7B2C\u4E00\u4E2A\u60F3\u6CD5" });
    if (this.nodes.length) empty == null ? void 0 : empty.remove();
    const selected = this.nodes.find((node) => node.path === this.selected);
    this.positionDraftEditor();
    this.status.setText(this.draftNode ? "\u8F93\u5165\u8282\u70B9\u6807\u9898 \xB7 Enter \u786E\u8BA4 \xB7 Tab \u786E\u8BA4\u5E76\u5EF6\u4F38 \xB7 Esc \u53D6\u6D88" : this.selectedNodes.size > 1 ? `\u5DF2\u6846\u9009 ${this.selectedNodes.size} \u4E2A\u8282\u70B9 \xB7 \u9000\u683C\u952E\u6279\u91CF\u5220\u9664 \xB7 Esc \u53D6\u6D88` : selected ? `${selected.label}${this.file && selected.ownerPath && selected.ownerPath !== this.file.path ? ` \xB7 \u5F15\u7528\u81EA ${(_g = selected.ownerPath.split("/").pop()) == null ? void 0 : _g.replace(/\.md$/, "")}` : ""} \xB7 Tab \u7EE7\u7EED \xB7 Enter \u540C\u8D77\u70B9\u5206\u652F \xB7 \u7A7A\u683C\u7F16\u8F91\u6807\u9898` : `${this.nodes.length} \u4E2A\u8282\u70B9 \xB7 ${this.edges.length} \u6761\u8FDE\u7EBF`);
  }
  onPointerDown(event) {
    if (event.pointerType === "touch") this.touchPoints.set(event.pointerId, event);
    if (event.pointerType === "touch" && this.touchPoints.size >= 2) {
      this.beginTouchPan();
      return;
    }
    if (event.button !== 0 && event.button !== 2 || this.editor || this.busy) return;
    this.suppressContextMenu = false;
    this.clearEdgeHover();
    this.canvas.focus();
    const rect = this.canvas.getBoundingClientRect(), point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const node = this.nodeAt(point.x, point.y);
    const base = { pointer: event.pointerId, start: point, last: point, moved: false };
    if (event.button === 2 || event.pointerType === "touch" && !node) {
      this.gesture = { ...base, kind: "pan", right: event.button === 2 };
    } else {
      this.selectedNodes.clear();
      this.selected = node == null ? void 0 : node.path;
      this.hovered = void 0;
      if (node && event.altKey && !node.placeholder) this.gesture = { ...base, kind: "link", node, end: point };
      else if (node) {
        const world = this.screenToWorld(point.x, point.y);
        this.gesture = { ...base, kind: "node", node, offset: { x: node.x - world.x, y: node.y - world.y } };
        this.forceLayout.pin(node.path, { x: node.x, y: node.y });
      } else this.gesture = { ...base, kind: "box", end: point, edge: node ? void 0 : this.edgeAt(point.x, point.y) };
    }
    this.forceLayout.setSelected(this.selected);
    this.startLayoutAnimation();
    this.canvas.setPointerCapture(event.pointerId);
    this.draw();
  }
  onPointerMove(event) {
    var _a;
    if (event.pointerType === "touch") {
      this.touchPoints.set(event.pointerId, event);
      if (this.touchPoints.size >= 2) {
        event.preventDefault();
        this.updateTouchPan();
        return;
      }
    }
    const rect = this.canvas.getBoundingClientRect(), point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (!this.gesture) {
      const nextHover = (_a = this.nodeAt(point.x, point.y)) == null ? void 0 : _a.path;
      const nextEdge = !nextHover && !this.editor && !this.busy ? this.edgeAt(point.x, point.y) : void 0;
      if (nextHover !== this.hovered || nextEdge !== this.hoveredEdge) {
        this.hovered = nextHover;
        this.hoveredEdge = nextEdge;
        if (nextEdge) this.canvas.addClass("is-edge-hovered");
        else this.canvas.removeClass("is-edge-hovered");
        this.draw();
      }
      return;
    }
    const gesture = this.gesture;
    if (event.pointerId !== gesture.pointer) return;
    if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 4) gesture.moved = true;
    if (!gesture.moved) return;
    this.canvas.addClass(gesture.kind === "box" ? "is-selecting" : "is-dragging");
    if (gesture.kind === "box") {
      gesture.end = point;
      const left = Math.min(gesture.start.x, point.x), right = Math.max(gesture.start.x, point.x);
      const top = Math.min(gesture.start.y, point.y), bottom = Math.max(gesture.start.y, point.y);
      this.selectedNodes = new Set(this.nodes.filter((node) => {
        const p = this.worldToScreen(node);
        return !node.placeholder && p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;
      }).map((node) => node.path));
      this.selected = this.selectedNodes.size === 1 ? [...this.selectedNodes][0] : void 0;
      this.forceLayout.setSelected(this.selected);
    } else if (gesture.kind === "node") {
      const world = this.screenToWorld(point.x, point.y);
      gesture.node.x = world.x + gesture.offset.x;
      gesture.node.y = world.y + gesture.offset.y;
      this.forceLayout.movePinned(gesture.node.path, { x: gesture.node.x, y: gesture.node.y });
    } else if (gesture.kind === "pan") {
      this.pan.x += (point.x - gesture.last.x) / this.zoom;
      this.pan.y += (point.y - gesture.last.y) / this.zoom;
      this.scheduleLayoutSave();
    } else gesture.end = point;
    gesture.last = point;
    this.draw();
  }
  onPointerUp(event) {
    if (event.pointerType === "touch") {
      this.touchPoints.delete(event.pointerId);
      if (this.touchPoints.size < 2) {
        this.touchPan = void 0;
        this.canvas.classList.remove("is-touch-panning");
      }
      if (!this.gesture || event.pointerId !== this.gesture.pointer) return;
    }
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointer) return;
    this.cancelGesture();
    if (gesture.kind === "pan" && gesture.right) {
      this.suppressContextMenu = true;
      if (!gesture.moved) this.showContextMenu(event);
      return;
    }
    if (!gesture.moved) {
      if (gesture.kind === "box") {
        const edge = gesture.edge;
        if (edge && this.edges.includes(edge)) void this.disconnectEdge(edge);
      }
      return;
    }
    if (gesture.kind === "node") {
      this.forceLayout.unpin(gesture.node.path);
      this.scheduleLayoutSave();
      this.startLayoutAnimation();
    }
    if (gesture.kind === "link") {
      const rect = this.canvas.getBoundingClientRect(), target = this.nodeAt(event.clientX - rect.left, event.clientY - rect.top);
      if (target && !target.placeholder && target.path !== gesture.node.path) void this.connect(gesture.node, target);
    }
  }
  cancelGesture() {
    var _a, _b, _c;
    const gesture = this.gesture;
    if ((gesture == null ? void 0 : gesture.kind) === "node") this.forceLayout.unpin(gesture.node.path);
    const pointer = (_a = this.gesture) == null ? void 0 : _a.pointer;
    this.gesture = void 0;
    if (pointer !== void 0 && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
    (_b = this.canvas) == null ? void 0 : _b.removeClass("is-dragging");
    (_c = this.canvas) == null ? void 0 : _c.removeClass("is-selecting");
    if (!this.closed) this.draw();
  }
  onPointerCancel(event) {
    var _a, _b;
    if (((_a = this.gesture) == null ? void 0 : _a.kind) === "box") {
      this.selectedNodes.clear();
      this.selected = void 0;
      this.forceLayout.setSelected(void 0);
    }
    if (event.pointerType === "touch") this.touchPoints.delete(event.pointerId);
    this.touchPan = void 0;
    (_b = this.canvas) == null ? void 0 : _b.classList.remove("is-touch-panning");
    this.cancelGesture();
  }
  beginTouchPan() {
    const points = [...this.touchPoints.values()];
    if (points.length < 2) return;
    if (this.gesture) this.cancelGesture();
    const first = points[0], second = points[1], rect = this.canvas.getBoundingClientRect();
    const midpoint = { x: (first.clientX + second.clientX) / 2 - rect.left, y: (first.clientY + second.clientY) / 2 - rect.top };
    this.touchPan = {
      center: midpoint,
      start: this.screenToWorld(midpoint.x, midpoint.y),
      distance: Math.max(1, Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)),
      zoom: this.zoom
    };
    this.canvas.classList.add("is-touch-panning");
  }
  updateTouchPan() {
    if (!this.touchPan) {
      this.beginTouchPan();
      return;
    }
    const points = [...this.touchPoints.values()];
    if (points.length < 2) return;
    const first = points[0], second = points[1], rect = this.canvas.getBoundingClientRect();
    const midpoint = { x: (first.clientX + second.clientX) / 2 - rect.left, y: (first.clientY + second.clientY) / 2 - rect.top };
    const distance = Math.max(1, Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY));
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.touchPan.zoom * distance / this.touchPan.distance));
    this.zoom = nextZoom;
    this.pan = { x: (midpoint.x - this.canvas.clientWidth / 2) / nextZoom - this.touchPan.start.x, y: (midpoint.y - this.canvas.clientHeight / 2) / nextZoom - this.touchPan.start.y };
    this.scheduleLayoutSave();
    this.draw();
  }
  onWheel(event) {
    var _a, _b, _c, _d, _e, _f;
    event.preventDefault();
    if (this.editor) return;
    const platform = (_e = (_d = (_b = (_a = this.canvas.ownerDocument) == null ? void 0 : _a.defaultView) == null ? void 0 : _b.navigator.platform) != null ? _d : (_c = globalThis.navigator) == null ? void 0 : _c.platform) != null ? _e : "";
    if (isMacTrackpadPan(event, platform)) {
      if (this.cameraFrame !== void 0) cancelAnimationFrame(this.cameraFrame);
      this.cameraFrame = void 0;
      this.targetZoom = void 0;
      this.zoomAnchor = void 0;
      this.pan.x -= event.deltaX / this.zoom;
      this.pan.y -= event.deltaY / this.zoom;
      this.hovered = void 0;
      this.clearEdgeHover();
      this.scheduleLayoutSave();
      this.draw();
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    this.zoomAnchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.canvas.clientHeight : 1);
    this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, ((_f = this.targetZoom) != null ? _f : this.zoom) * Math.exp(-delta * 2e-3)));
    this.animateZoom();
  }
  animateZoom() {
    if (this.closed || this.cameraFrame !== void 0) return;
    this.cameraFrame = requestAnimationFrame(() => {
      this.cameraFrame = void 0;
      if (this.closed || this.targetZoom === void 0 || !this.zoomAnchor) return;
      const before = this.screenToWorld(this.zoomAnchor.x, this.zoomAnchor.y);
      this.zoom += (this.targetZoom - this.zoom) * 0.25;
      if (Math.abs(this.targetZoom - this.zoom) < 1e-4) {
        this.zoom = this.targetZoom;
        this.targetZoom = void 0;
      }
      const after = this.screenToWorld(this.zoomAnchor.x, this.zoomAnchor.y);
      this.pan.x += after.x - before.x;
      this.pan.y += after.y - before.y;
      this.draw();
      this.scheduleLayoutSave();
      if (this.targetZoom !== void 0) this.animateZoom();
    });
  }
  onDoubleClick(event) {
    if (this.editor || this.busy) return;
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const node = this.nodeAt(x, y);
    if (node == null ? void 0 : node.nodeId) void this.beginEdit(node);
    else if (node == null ? void 0 : node.openPath) void this.app.workspace.openLinkText(node.openPath, "", false);
    else void this.beginCreate(this.screenToWorld(x, y));
  }
  onKeyDown(event) {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.isComposing && event.key.toLowerCase() === "z" && !this.editor) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat && !this.busy) void this.undoGraphEdit(event.shiftKey);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && !this.editor) {
      event.preventDefault();
      this.toggleSearch(true);
      return;
    }
    if (!event.isComposing && !event.altKey && !event.shiftKey && (event.metaKey || event.ctrlKey) && event.key === "Enter" && !this.editor && !this.busy) {
      if (this.selected) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) void this.insertParent();
      }
      return;
    }
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || this.editor || this.busy) return;
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      this.fitToView();
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && this.selectedNodes.size) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) void this.deleteSelectedNodes();
      return;
    }
    const node = this.nodes.find((item) => item.path === this.selected);
    if (event.key === "Tab" || event.key === "Enter") {
      event.preventDefault();
      void this.createRelative(event.key === "Tab");
    } else if (event.key === " " && node) {
      event.preventDefault();
      if (!event.repeat) void this.beginEdit(node);
    } else if ((event.key === "Delete" || event.key === "Backspace") && node) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) this.removeNode(node, event.key !== "Backspace");
    } else if (event.key === "Escape") {
      this.selectedNodes.clear();
      this.selected = void 0;
      this.forceLayout.setSelected(void 0);
      this.draw();
    }
  }
  editingThought(node) {
    if (this.thoughtPath) return this.thoughtPath;
    if ((node == null ? void 0 : node.thoughts.length) === 1) return node.thoughts[0];
    if (this.snapshot.thoughts.length === 1) return this.snapshot.thoughts[0].path;
    if (node) new import_obsidian6.Notice("\u8282\u70B9\u5C5E\u4E8E\u591A\u4E2A\u601D\u8003\uFF0C\u8BF7\u5148\u5728\u56FE\u8C31\u8BBE\u7F6E\u4E2D\u9009\u62E9\u8981\u4FEE\u6539\u7684\u601D\u8003");
  }
  async createRelative(child) {
    var _a, _b, _c, _d;
    const node = this.nodes.find((item) => item.path === this.selected);
    if (!node) {
      await this.beginCreate(this.screenToWorld(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2));
      return;
    }
    const thought = (_b = (_a = this.file) == null ? void 0 : _a.path) != null ? _b : this.editingThought(node);
    if (this.source === "vault" || !thought) {
      new import_obsidian6.Notice("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u601D\u8003\u6587\u4EF6\uFF0C\u8282\u70B9\u4F1A\u4FDD\u5B58\u5728\u8FD9\u4EFD\u6587\u4EF6\u4E2D");
      return;
    }
    if (node.placeholder) {
      await this.beginCreate({ x: node.x, y: node.y }, void 0, thought);
      return;
    }
    let parent = node.path;
    if (!child) {
      const visits = (_d = (_c = this.snapshot.steps) == null ? void 0 : _c.filter((step) => step.thoughtPath === thought)) != null ? _d : [];
      let index = visits.length - 1;
      while (index >= 0 && visits[index].key !== node.path) index--;
      parent = index > 0 && visits[index - 1].pathIndex === visits[index].pathIndex ? visits[index - 1].key : void 0;
    }
    await this.beginCreate({ x: node.x + (child ? 150 : 0), y: node.y + (child ? 0 : 100) }, parent, thought, !child);
  }
  async insertParent() {
    var _a, _b, _c, _d;
    const node = this.nodes.find((item) => item.path === this.selected);
    if (!node || node.placeholder) return;
    const thought = (_b = (_a = this.file) == null ? void 0 : _a.path) != null ? _b : this.editingThought(node);
    if (this.source === "vault" || !thought) {
      new import_obsidian6.Notice("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u601D\u8003\u6587\u4EF6");
      return;
    }
    const visits = (_d = (_c = this.snapshot.steps) == null ? void 0 : _c.filter((step) => step.thoughtPath === thought)) != null ? _d : [];
    let index = visits.length - 1;
    while (index >= 0 && visits[index].key !== node.path) index--;
    const child = visits[index], parent = visits[index - 1];
    if (!child || !parent || child.pathIndex !== parent.pathIndex) {
      new import_obsidian6.Notice("\u5F53\u524D\u8282\u70B9\u6CA1\u6709\u7236\u8282\u70B9\uFF0C\u65E0\u6CD5\u5728\u4E2D\u95F4\u63D2\u5165");
      return;
    }
    const parentNode = this.nodes.find((item) => item.path === parent.key);
    const point = parentNode ? { x: (node.x + parentNode.x) / 2, y: (node.y + parentNode.y) / 2 } : { x: node.x - 150, y: node.y };
    await this.beginCreate(point, parent.key, thought, false, { child: node.path, parent: parent.key, ordinal: child.ordinal });
  }
  async beginCreate(point, parent, target = this.editingThought(), newPath = false, insertion) {
    var _a, _b;
    if (this.busy) return;
    target = (_b = (_a = this.file) == null ? void 0 : _a.path) != null ? _b : target;
    if (target && !isThoughtFile(target, this.plugin.layout.settings.noteFolder)) {
      new import_obsidian6.Notice("\u8FD9\u7BC7\u7B14\u8BB0\u4E0D\u5728\u601D\u8003\u76EE\u5F55\u4E2D");
      return;
    }
    if (this.source === "vault" || !target) {
      new import_obsidian6.Notice("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u601D\u8003\u6587\u4EF6\uFF0C\u6216\u8FD0\u884C\u300C\u65B0\u5EFA\u601D\u8003\u300D\u547D\u4EE4");
      return;
    }
    this.closeEditor();
    this.selectedNodes.clear();
    const draft = { path: `draft:${crypto.randomUUID()}`, label: "", openPath: "", degree: parent ? 1 : 0, thoughts: target ? [target] : [], kind: "note", ...point };
    this.draftNode = draft;
    this.draftParent = parent;
    this.draftChild = insertion == null ? void 0 : insertion.child;
    this.filterSnapshot();
    this.selected = draft.path;
    this.forceLayout.sync(this.nodes, this.edges, this.plugin.layout.positions);
    this.forceLayout.pin(draft.path, point);
    this.forceLayout.setSelected(draft.path);
    const form = this.contentEl.createEl("form", { cls: "brainos-node-title-editor" });
    this.editor = form;
    const title = form.createEl("input", { cls: "brainos-node-title-input", placeholder: "\u8F93\u5165\u540D\u79F0\uFF0C\u540C\u540D\u590D\u7528\u5DF2\u6709\u8282\u70B9", attr: { "aria-label": "\u8282\u70B9\u6807\u9898", autocomplete: "off", required: "" } });
    if (insertion) title.placeholder = "\u8F93\u5165\u8981\u63D2\u5165\u7684\u65B0\u8282\u70B9\u540D\u79F0";
    let chosen;
    this.titleSuggest = new NodeTitleSuggest(this.app, title, target, async () => {
      const snapshot = await buildThoughtSnapshot(this.app, void 0, this.plugin.layout.settings.noteFolder).catch(() => ({ ...this.snapshot, nodes: this.snapshot.nodes.filter((node) => !!node.ownerPath && isThoughtFile(node.ownerPath, this.plugin.layout.settings.noteFolder)) }));
      return snapshot.nodes;
    }, (candidate) => {
      if (this.editor !== form || this.busy) return;
      chosen = candidate;
      form.requestSubmit();
    }, () => this.composing, !!insertion);
    let continueAfterSave = false;
    title.addEventListener("compositionstart", () => {
      this.composing = true;
    });
    title.addEventListener("compositionend", () => {
      this.composing = false;
    });
    title.oninput = () => {
      chosen = void 0;
      title.style.width = `${Math.max(110, Math.min(420, Array.from(title.value).length * 15 + 28))}px`;
    };
    form.onkeydown = (event) => {
      var _a2;
      if (event.defaultPrevented) return;
      if (((_a2 = this.titleSuggest) == null ? void 0 : _a2.isShowing) && ["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(event.key)) return;
      event.stopPropagation();
      const action = titleKeyAction(event);
      if (action === "none") return;
      event.preventDefault();
      if (action === "cancel") {
        this.closeEditor();
        this.draw();
        return;
      }
      if (this.composing || !title.value.trim()) return;
      continueAfterSave = action === "continue";
      form.requestSubmit();
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      const label = title.value.trim();
      if (!label || this.busy || this.composing) return;
      title.disabled = true;
      const shouldContinue = continueAfterSave;
      void (async () => {
        let committed = false;
        await this.runEdit(async () => {
          const parentNode = parent ? this.nodes.find((node) => node.path === parent) : void 0;
          const reference = (chosen == null ? void 0 : chosen.kind) === "reference" ? chosen.node : void 0;
          const key = reference ? (await referenceThoughtNode(this.app, target, reference, parentNode, newPath), reference.path) : insertion ? await insertThoughtNode(this.app, target, label, insertion) : await createThoughtNode(this.app, target, label, "", parentNode ? { key: parentNode.path, title: parentNode.label, newPath } : void 0);
          if (!this.snapshot.nodes.some((node) => node.path === key)) this.plugin.layout.positions[key] = { x: draft.x, y: draft.y };
          const session = this.plugin.activeSession;
          if (parent && (newPath || (session == null ? void 0 : session.stepKeys[session.stepKeys.length - 1]) !== parent)) this.plugin.recordSessionStep(parent, target);
          this.plugin.recordSessionStep(key, target);
          await this.plugin.saveLayout();
          this.closeEditor();
          this.selected = key;
          this.thoughtPath = target;
          await this.refresh();
          this.plugin.refreshViews();
          this.canvas.focus();
          committed = true;
        });
        title.disabled = false;
        if (!committed && this.editor === form) title.focus();
        if (committed && shouldContinue) await this.createRelative(true);
      })();
    };
    title.onblur = () => requestAnimationFrame(() => {
      if (this.editor !== form || this.busy || this.composing) return;
      if (title.value.trim()) form.requestSubmit();
      else {
        this.closeEditor();
        this.draw();
      }
    });
    this.positionDraftEditor();
    this.startLayoutAnimation();
    this.draw();
    title.focus();
  }
  positionDraftEditor() {
    var _a;
    const anchor = (_a = this.draftNode) != null ? _a : this.nodes.find((node) => {
      var _a2;
      return node.path === ((_a2 = this.editingNode) == null ? void 0 : _a2.path);
    });
    if (!anchor || !this.editor) return;
    const point = this.worldToScreen(anchor);
    const radius = nodeScreenRadius(anchor.degree, this.zoom, this.graphOptions.nodeSizeMultiplier);
    this.editor.style.left = `${this.canvas.offsetLeft + point.x}px`;
    this.editor.style.top = `${this.canvas.offsetTop + point.y + radius + 6 + (this.editingNode ? 15 : 0)}px`;
  }
  async beginEdit(node) {
    var _a, _b;
    if (this.busy || node.placeholder) return;
    if (!node.nodeId) {
      if (node.openPath) await this.app.workspace.openLinkText(node.openPath, (_b = (_a = this.file) == null ? void 0 : _a.path) != null ? _b : "", false);
      return;
    }
    await this.runEdit(async () => {
      const original = await readThoughtNode(this.app, node.path);
      if (this.closed) return;
      this.closeEditor();
      this.selectedNodes.clear();
      this.editingNode = node;
      this.selected = node.path;
      this.hovered = node.path;
      this.forceLayout.setSelected(node.path);
      const form = this.contentEl.createEl("form", { cls: "brainos-node-title-editor" });
      this.editor = form;
      const title = form.createEl("input", { cls: "brainos-node-title-input", attr: { "aria-label": "\u8282\u70B9\u6807\u9898", autocomplete: "off" } });
      title.value = original.node.title;
      const resizeTitle = () => {
        title.style.width = `${Math.max(110, Math.min(420, Array.from(title.value).length * 15 + 28))}px`;
      };
      let chosen;
      this.titleSuggest = new NodeTitleSuggest(
        this.app,
        title,
        original.file.path,
        async () => (await buildThoughtSnapshot(this.app, original.file, this.plugin.layout.settings.noteFolder)).nodes,
        (candidate) => {
          if (this.editor !== form || this.busy) return;
          chosen = candidate;
          resizeTitle();
          form.requestSubmit();
        },
        () => this.composing,
        false,
        node.path
      );
      title.oninput = () => {
        chosen = void 0;
        resizeTitle();
      };
      resizeTitle();
      title.addEventListener("compositionstart", () => {
        this.composing = true;
      });
      title.addEventListener("compositionend", () => {
        this.composing = false;
      });
      form.onkeydown = (event) => {
        var _a2;
        if (event.defaultPrevented) return;
        if (((_a2 = this.titleSuggest) == null ? void 0 : _a2.isShowing) && ["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(event.key)) return;
        event.stopPropagation();
        const action = titleKeyAction(event);
        if (action === "none" || this.busy) return;
        event.preventDefault();
        if (action === "cancel") {
          this.closeEditor();
          this.draw();
          return;
        }
        if (!this.composing && title.value.trim()) form.requestSubmit();
      };
      form.onsubmit = (event) => {
        event.preventDefault();
        if (this.busy || this.composing || !title.value.trim()) return;
        if (title.value.trim() === original.node.title) {
          this.closeEditor();
          this.draw();
          return;
        }
        title.disabled = true;
        void this.runEdit(async () => {
          const reuse = (chosen == null ? void 0 : chosen.kind) === "reuse" && chosen.node.label === title.value.trim();
          const key = await editThoughtNode(this.app, node.path, title.value, void 0, original.node, reuse);
          if (key !== node.path) {
            const point = this.plugin.layout.positions[node.path];
            if (point) {
              if (!this.plugin.layout.positions[key]) this.plugin.layout.positions[key] = point;
              delete this.plugin.layout.positions[node.path];
            }
            for (const session of this.plugin.layout.sessions) session.stepKeys = session.stepKeys.map((step) => step === node.path ? key : step);
            this.plugin.layout.graph.hiddenPaths = this.plugin.layout.graph.hiddenPaths.map((path) => path === node.path ? key : path);
            this.selected = key;
            await this.plugin.saveLayout();
          }
          this.closeEditor();
          await this.refresh();
          this.plugin.refreshViews();
        }).finally(() => {
          title.disabled = false;
          if (this.editor === form) title.focus();
        });
      };
      title.onblur = () => requestAnimationFrame(() => {
        if (this.editor !== form || this.busy || this.composing) return;
        if (title.value.trim()) form.requestSubmit();
        else {
          this.closeEditor();
          this.draw();
        }
      });
      this.positionDraftEditor();
      this.startLayoutAnimation();
      this.draw();
      title.focus();
      title.select();
    });
  }
  async openReferencePicker() {
    var _a, _b;
    const thought = (_b = (_a = this.file) == null ? void 0 : _a.path) != null ? _b : this.editingThought();
    if (!thought || this.source === "vault") {
      new import_obsidian6.Notice("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u601D\u8003\u6587\u4EF6");
      return;
    }
    await this.runEdit(async () => {
      const snapshot = await buildThoughtSnapshot(this.app, void 0, this.plugin.layout.settings.noteFolder);
      const current = this.nodes.filter((node) => node.nodeId && !!node.ownerPath && isThoughtFile(node.ownerPath, this.plugin.layout.settings.noteFolder));
      const byKey = new Map([...snapshot.nodes, ...current].filter((node) => node.nodeId).map((node) => [node.path, node]));
      const parent = this.nodes.find((node) => node.path === this.selected && node.nodeId);
      new NodeReferenceModal(this.app, [...byKey.values()], (node) => {
        void this.runEdit(async () => {
          await referenceThoughtNode(this.app, thought, node, parent);
          this.selectedNodes.clear();
          this.selected = node.path;
          this.plugin.recordSessionStep(node.path, thought);
          await this.refresh();
          this.plugin.refreshViews();
          this.canvas.focus();
        });
      }).open();
    });
  }
  cancelNodeEditing() {
    this.closeEditor();
    this.draw();
  }
  closeEditor() {
    var _a, _b, _c;
    this.clearEdgeHover();
    (_a = this.titleSuggest) == null ? void 0 : _a.dispose();
    this.titleSuggest = void 0;
    this.editingNode = void 0;
    (_b = this.editor) == null ? void 0 : _b.remove();
    this.editor = void 0;
    if (this.draftNode) {
      const path = this.draftNode.path;
      this.forceLayout.unpin(path);
      this.draftNode = void 0;
      this.draftParent = void 0;
      this.draftChild = void 0;
      this.nodes = this.nodes.filter((node) => node.path !== path);
      this.edges = this.edges.filter((edge) => edge.from !== path && edge.to !== path);
      if (this.selected === path) this.selected = void 0;
      if (!this.closed) this.filterSnapshot();
    }
    this.composing = false;
    if (!this.closed) (_c = this.canvas) == null ? void 0 : _c.focus();
  }
  async undoGraphEdit(redo = false) {
    if (this.busy) return;
    this.busy = true;
    try {
      const history = graphHistory(this.app);
      if (await (redo ? history.redo() : history.undo())) {
        this.closeEditor();
        await this.refresh();
        this.plugin.refreshViews();
        this.canvas.focus();
      }
    } catch (error) {
      new import_obsidian6.Notice(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
    }
  }
  async runEdit(action) {
    if (this.busy) return;
    this.busy = true;
    try {
      await graphHistory(this.app).record(action, {
        capture: () => ({
          positions: JSON.parse(JSON.stringify(this.plugin.layout.positions)),
          steps: this.plugin.layout.sessions.map((session) => [...session.stepKeys]),
          selected: this.selected,
          selectedNodes: [...this.selectedNodes]
        }),
        restore: async (value, previous) => {
          for (const key of /* @__PURE__ */ new Set([...Object.keys(value.positions), ...Object.keys(previous.positions)])) {
            if (JSON.stringify(value.positions[key]) === JSON.stringify(previous.positions[key])) continue;
            if (value.positions[key]) this.plugin.layout.positions[key] = { ...value.positions[key] };
            else delete this.plugin.layout.positions[key];
          }
          value.steps.forEach((steps, index) => {
            const session = this.plugin.layout.sessions[index];
            if (session && JSON.stringify(steps) !== JSON.stringify(previous.steps[index])) session.stepKeys = [...steps];
          });
          this.selected = value.selected;
          this.selectedNodes = new Set(value.selectedNodes);
          await this.plugin.saveLayout();
        }
      });
    } catch (error) {
      new import_obsidian6.Notice(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
    }
  }
  async connect(from, to) {
    var _a, _b;
    const thought = (_b = (_a = this.file) == null ? void 0 : _a.path) != null ? _b : this.editingThought(from);
    if (this.source === "vault" || !thought) {
      new import_obsidian6.Notice("\u8BF7\u5728\u601D\u8003\u6587\u4EF6\u5185\u7EC4\u5408\u8282\u70B9\uFF1B\u5168\u5E93\u56FE\u8C31\u4EC5\u7528\u4E8E\u67E5\u770B\u7B14\u8BB0\u53CC\u94FE");
      return;
    }
    if (from.placeholder || to.placeholder) return;
    await this.runEdit(async () => {
      await linkThoughtNodes(this.app, thought, from, to);
      const session = this.plugin.activeSession;
      if ((session == null ? void 0 : session.stepKeys[session.stepKeys.length - 1]) !== from.path) this.plugin.recordSessionStep(from.path, thought);
      this.plugin.recordSessionStep(to.path, thought);
      await this.refresh();
      this.plugin.refreshViews();
    });
  }
  async deleteSelectedNodes() {
    var _a, _b;
    if (this.busy || !this.selectedNodes.size) return;
    const selected = [...this.selectedNodes];
    if (this.source === "vault") {
      this.plugin.layout.graph.hiddenPaths = [.../* @__PURE__ */ new Set([...this.plugin.layout.graph.hiddenPaths, ...selected])];
      this.selectedNodes.clear();
      this.selected = void 0;
      await this.plugin.saveLayout();
      this.filterSnapshot();
      this.draw();
      return;
    }
    const thought = (_b = (_a = this.file) == null ? void 0 : _a.path) != null ? _b : this.thoughtPath;
    if (!thought) {
      new import_obsidian6.Notice("\u8BF7\u5148\u9009\u62E9\u8981\u4FEE\u6539\u7684\u601D\u8003\u6587\u4EF6");
      return;
    }
    await this.runEdit(async () => {
      await removeThoughtNodes(this.app, thought, selected);
      this.selectedNodes.clear();
      this.selected = void 0;
      await this.refresh();
      this.plugin.refreshViews();
    });
  }
  removeNode(node, confirm = true) {
    var _a, _b, _c;
    if (this.source === "vault") {
      this.plugin.layout.graph.hiddenPaths.push(node.path);
      this.selected = void 0;
      void this.plugin.saveLayout();
      this.filterSnapshot();
      this.draw();
      return;
    }
    if (node.placeholder) return;
    const thought = (_b = (_a = this.file) == null ? void 0 : _a.path) != null ? _b : this.editingThought(node);
    if (!thought) return;
    const owned = ((_c = splitNodeKey(node.path)) == null ? void 0 : _c.file) === thought;
    const remove = () => this.runEdit(async () => {
      await removeThoughtNode(this.app, thought, node.path);
      this.selected = void 0;
      await this.refresh();
      this.plugin.refreshViews();
    });
    if (confirm) new RemoveNodeModal(this.app, node.label, owned, remove).open();
    else void remove();
  }
  edgeAt(x, y) {
    const byPath = new Map(this.nodes.map((node) => [node.path, node]));
    let closest, distance = 8 + this.graphOptions.lineSizeMultiplier / 2;
    for (const edge of this.edges) {
      const a = byPath.get(edge.from), b = byPath.get(edge.to);
      if (!a || !b) continue;
      const p = this.worldToScreen(a), q = this.worldToScreen(b), dx = q.x - p.x, dy = q.y - p.y;
      const length = dx * dx + dy * dy;
      if (!Number.isFinite(length) || length < 1e-3) continue;
      const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / length));
      const next = Math.hypot(x - p.x - t * dx, y - p.y - t * dy);
      if (next < distance) {
        distance = next;
        closest = edge;
      }
    }
    return closest;
  }
  clearEdgeHover() {
    var _a;
    this.hoveredEdge = void 0;
    (_a = this.canvas) == null ? void 0 : _a.removeClass("is-edge-hovered");
  }
  async disconnectEdge(edge) {
    var _a;
    if (this.busy) return;
    const thought = ((_a = this.file) == null ? void 0 : _a.path) || this.thoughtPath || (edge.thoughts.length === 1 ? edge.thoughts[0] : void 0);
    if (this.source !== "vault" && !thought) {
      new import_obsidian6.Notice("\u8FDE\u7EBF\u5C5E\u4E8E\u591A\u4E2A\u601D\u8003\uFF0C\u8BF7\u5148\u9009\u62E9\u8981\u4FEE\u6539\u7684\u601D\u8003");
      return;
    }
    await this.runEdit(async () => {
      if (this.source === "vault") {
        const directions = this.edges.filter((value) => edgeStrokeKey(value.from, value.to) === edgeStrokeKey(edge.from, edge.to));
        for (const direction2 of directions) await removeVaultLink(this.app, direction2.from, direction2.to);
      } else await unlinkThoughtNodes(this.app, thought, edge.from, edge.to, true);
      this.clearEdgeHover();
      await this.refresh();
      this.plugin.refreshViews();
      this.canvas.focus();
    });
  }
  onContextMenu(event) {
    var _a;
    event.preventDefault();
    if (((_a = this.gesture) == null ? void 0 : _a.kind) === "pan" && this.gesture.right || this.suppressContextMenu && event.button === 2) return;
    this.showContextMenu(event);
  }
  showContextMenu(event) {
    event.preventDefault();
    if (this.editor || this.busy) return;
    this.clearEdgeHover();
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const node = this.nodeAt(x, y), menu = new import_obsidian6.Menu();
    if (node) {
      this.selectedNodes.clear();
      this.selected = node.path;
      this.forceLayout.setSelected(this.selected);
      this.startLayoutAnimation();
      this.draw();
      menu.addItem((item) => item.setTitle("\u7F16\u8F91\u8282\u70B9").setIcon("pencil").onClick(() => void this.beginEdit(node)));
      menu.addItem((item) => item.setTitle("\u6253\u5F00\u6765\u6E90 Markdown").setIcon("file-text").onClick(() => void this.app.workspace.openLinkText(node.openPath, "", false)));
      menu.addItem((item) => item.setTitle("\u5F15\u7528\u5DF2\u6709\u8282\u70B9\u2026").setIcon("link").onClick(() => void this.openReferencePicker()));
      menu.addItem((item) => item.setTitle("\u5EF6\u4F38\u8282\u70B9\uFF08Tab\uFF09").setIcon("git-branch").onClick(() => void this.createRelative(true)));
      menu.addItem((item) => item.setTitle("\u4ECE\u8FD9\u91CC\u53E6\u5F00\u4E00\u8DEF").setIcon("git-fork").onClick(() => void this.beginCreate({ x: node.x + 150, y: node.y + 100 }, node.path, this.editingThought(node), true)));
      menu.addItem((item) => {
        var _a;
        return item.setTitle(this.source === "vault" ? "\u4ECE\u56FE\u8C31\u9690\u85CF" : node.ownerPath === ((_a = this.file) == null ? void 0 : _a.path) ? "\u5220\u9664\u6B64\u8282\u70B9\u2026" : "\u4ECE\u5F53\u524D\u601D\u8003\u79FB\u9664\u5F15\u7528\u2026").setIcon("unlink").onClick(() => this.removeNode(node));
      });
    } else {
      const edge = this.edgeAt(x, y);
      if (!edge) return;
      menu.addItem((item) => item.setTitle("\u65AD\u5F00\u6B64\u8FDE\u7EBF").setIcon("unlink").onClick(() => void this.disconnectEdge(edge)));
    }
    menu.showAtMouseEvent(event);
  }
};
var RemoveNodeModal = class extends import_obsidian6.Modal {
  constructor(app, label, owned, remove) {
    super(app);
    this.label = label;
    this.owned = owned;
    this.remove = remove;
  }
  onOpen() {
    this.titleEl.setText(`\u79FB\u9664\u300C${this.label}\u300D\uFF1F`);
    this.contentEl.createEl("p", { text: this.owned ? "\u5220\u9664\u672C\u6587\u4EF6\u4E2D\u8FD9\u4E2A\u540D\u79F0\u7684\u5168\u90E8\u8BB0\u5F55\u53CA\u76F8\u90BB\u8FDE\u7EBF\u3002\u5176\u4ED6\u601D\u8003\u5BF9\u5B83\u7684\u5F15\u7528\u4F1A\u663E\u793A\u4E3A\u5931\u6548\uFF1B\u4E0D\u4F1A\u5220\u9664\u601D\u8003\u6587\u4EF6\u3002" : "\u4EC5\u79FB\u9664\u672C\u601D\u8003\u4E2D\u7684\u5F15\u7528\u53CA\u76F8\u90BB\u5173\u7CFB\uFF0C\u6765\u6E90\u8282\u70B9\u7684\u6807\u9898\u548C\u6B63\u6587\u4FDD\u6301\u4E0D\u53D8\u3002" });
    new import_obsidian6.Setting(this.contentEl).addButton((button) => button.setButtonText("\u53D6\u6D88").onClick(() => this.close())).addButton((button) => button.setButtonText(this.owned ? "\u5220\u9664\u8282\u70B9" : "\u79FB\u9664\u5F15\u7528").setWarning().onClick(() => {
      this.close();
      void this.remove();
    }));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var NodeReferenceModal = class extends import_obsidian6.SuggestModal {
  constructor(app, nodes, choose) {
    super(app);
    this.nodes = nodes;
    this.choose = choose;
    this.setPlaceholder("\u641C\u7D22\u5DF2\u6709\u8282\u70B9\uFF0C\u5F15\u7528\u5230\u5F53\u524D\u601D\u8003\u2026");
  }
  getSuggestions(query) {
    const tokens = query.trim().toLocaleLowerCase().split(/\s+/);
    return this.nodes.filter((node) => tokens.every((token) => `${node.label} ${node.ownerPath}`.toLocaleLowerCase().includes(token))).slice(0, 50);
  }
  renderSuggestion(node, el) {
    var _a;
    el.createDiv({ text: node.label });
    el.createDiv({ cls: "brainos-node-editor-target", text: (_a = node.ownerPath) != null ? _a : "" });
  }
  onChooseSuggestion(node) {
    this.choose(node);
  }
};

// src/ai.ts
var UnconfiguredAIProvider = class {
  constructor() {
    __publicField(this, "id", "unconfigured");
  }
  async complete(_request) {
    throw new Error("\u5C1A\u672A\u914D\u7F6E BrainOS AI \u63D0\u4F9B\u65B9\uFF1B\u56FE\u8C31\u548C Markdown \u5DE5\u4F5C\u6D41\u53EF\u72EC\u7ACB\u4F7F\u7528");
  }
};

// src/folder-suggest.ts
var import_obsidian7 = require("obsidian");
var FolderSuggest = class extends import_obsidian7.AbstractInputSuggest {
  constructor(app, input, folders, choose) {
    super(app, input);
    this.folders = folders;
    this.choose = choose;
    __publicField(this, "disposed", false);
  }
  getSuggestions(query) {
    if (this.disposed) return [];
    const value = query.trim().replace(/\\/g, "/").toLocaleLowerCase();
    return ["/", ...new Set(this.folders().filter((path) => path && path !== "/").sort((a, b) => a.localeCompare(b)))].filter((path) => path.toLocaleLowerCase().includes(value));
  }
  renderSuggestion(path, el) {
    el.setText(path);
  }
  selectSuggestion(path, event) {
    if (this.disposed || event.isComposing) return;
    const value = path === "/" ? "" : path;
    this.setValue(value);
    this.close();
    void this.choose(value);
  }
  dispose() {
    this.disposed = true;
    this.close();
  }
};

// src/main.ts
var DATA_VERSION = 5;
var DEFAULT_SETTINGS = { noteFolder: DEFAULT_NOTE_FOLDER };
var BrainOSPlugin = class extends import_obsidian8.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "layout", {
      version: DATA_VERSION,
      positions: {},
      viewports: {},
      settings: { ...DEFAULT_SETTINGS },
      sessions: [],
      graph: defaultGraphOptions()
    });
    /** Provider seam for a future OpenAI/DeepSeek adapter. */
    __publicField(this, "aiProvider", new UnconfiguredAIProvider());
    __publicField(this, "refreshTimer");
    __publicField(this, "lastMarkdownPath");
    __publicField(this, "viewMode", new MindViewMode());
    __publicField(this, "headerActions", /* @__PURE__ */ new Map());
    __publicField(this, "newTabActions", /* @__PURE__ */ new Map());
    __publicField(this, "unloading", false);
    __publicField(this, "creatingThought", false);
  }
  async onload() {
    var _a, _b;
    const saved = await this.loadData();
    const savedPositions = isRecord(saved == null ? void 0 : saved.positions) ? Object.fromEntries(Object.entries(saved.positions).filter(([, point]) => isPoint(point))) : {};
    const savedViewports = isRecord(saved == null ? void 0 : saved.viewports) ? Object.fromEntries(Object.entries(saved.viewports).filter(([, viewport]) => isViewport(viewport))) : {};
    this.layout = {
      version: DATA_VERSION,
      positions: savedPositions,
      viewports: savedViewports,
      settings: { ...DEFAULT_SETTINGS, ...(_a = saved == null ? void 0 : saved.settings) != null ? _a : {} },
      sessions: Array.isArray(saved == null ? void 0 : saved.sessions) ? saved.sessions : [],
      activeSessionId: saved == null ? void 0 : saved.activeSessionId,
      graph: loadGraphOptions(saved == null ? void 0 : saved.graph)
    };
    this.lastMarkdownPath = (_b = this.app.workspace.getActiveFile()) == null ? void 0 : _b.path;
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if ((file == null ? void 0 : file.extension) === "md") this.lastMarkdownPath = file.path;
      this.syncHeaderActions();
    }));
    this.registerView(VIEW_TYPE, (leaf) => new BrainOSGraphView(leaf, this));
    this.app.workspace.onLayoutReady(() => this.syncHeaderActions());
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncHeaderActions()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncHeaderActions()));
    this.addRibbonIcon("git-branch", "\u5207\u6362\u601D\u7EF4\u89C6\u56FE", () => void this.toggleMindView());
    this.addCommand({ id: "toggle-mind-view", name: "\u5207\u6362\u7F16\u8F91\uFF0F\u601D\u7EF4\u89C6\u56FE", checkCallback: (checking) => {
      var _a2, _b2;
      const supported = !!((_a2 = this.app.workspace.getActiveViewOfType(import_obsidian8.MarkdownView)) == null ? void 0 : _a2.file) || !!((_b2 = this.app.workspace.getActiveViewOfType(BrainOSGraphView)) == null ? void 0 : _b2.file);
      if (supported && !checking) void this.toggleMindView();
      return supported;
    } });
    this.addCommand({ id: "open-graph", name: "\u6253\u5F00 BrainOS \u56FE\u8C31", callback: () => this.activateView() });
    this.addCommand({ id: "refresh-graph", name: "\u5237\u65B0 BrainOS \u56FE\u8C31", callback: () => this.refreshViews() });
    this.addCommand({ id: "focus-current-note", name: "\u5C06\u56FE\u8C31\u805A\u7126\u5230\u5F53\u524D\u7B14\u8BB0", checkCallback: (checking) => {
      var _a2;
      const view = (_a2 = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]) == null ? void 0 : _a2.view;
      if (!view || !(view instanceof BrainOSGraphView)) return false;
      if (!checking) view.focusCurrent();
      return true;
    } });
    this.addCommand({ id: "create-thought", name: "\u65B0\u5EFA\u601D\u8003", callback: () => void this.createNewThought() });
    this.addCommand({ id: "reference-node", name: "\u5F15\u7528\u5DF2\u6709\u8282\u70B9\u5230\u5F53\u524D\u601D\u8003", checkCallback: (checking) => {
      const view = this.app.workspace.getActiveViewOfType(BrainOSGraphView);
      if (!(view == null ? void 0 : view.file)) return false;
      if (!checking) void view.openReferencePicker();
      return true;
    } });
    this.addCommand({ id: "start-session", name: "\u5F00\u59CB BrainOS Session", callback: () => this.startSession() });
    this.addCommand({ id: "end-session", name: "\u7ED3\u675F BrainOS Session", checkCallback: (checking) => {
      const active = this.activeSession;
      if (!active) return false;
      if (!checking) this.endSession();
      return true;
    } });
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("modify", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRefresh()));
    this.addSettingTab(new BrainOSSettingTab(this.app, this));
  }
  onunload() {
    this.unloading = true;
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    for (const action of this.headerActions.values()) action.remove();
    this.headerActions.clear();
    for (const action of this.newTabActions.values()) action.remove();
    this.newTabActions.clear();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const file = leaf.view.file;
      if (file) void this.viewMode.showMarkdown(leaf, file.path);
    }
  }
  refreshIntegrations() {
    this.syncHeaderActions();
  }
  syncHeaderActions() {
    if (this.unloading) return;
    this.syncNewTabActions();
    const views = /* @__PURE__ */ new Set();
    this.app.workspace.iterateAllLeaves((leaf) => {
      var _a;
      if (!(leaf.view instanceof import_obsidian8.MarkdownView) || !leaf.view.file || !isThoughtFile(leaf.view.file.path, this.layout.settings.noteFolder)) return;
      const view = leaf.view;
      views.add(view);
      const existing = this.headerActions.get(view);
      if (existing == null ? void 0 : existing.isConnected) return;
      existing == null ? void 0 : existing.remove();
      const action = view.addAction("git-branch", "\u5207\u6362\u5230\u601D\u7EF4\u89C6\u56FE", () => void this.openMindView(leaf, view.file));
      action.addClass("brainos-mind-view-action");
      (_a = action.parentElement) == null ? void 0 : _a.prepend(action);
      this.headerActions.set(view, action);
    });
    for (const [view, action] of this.headerActions) {
      if (!views.has(view)) {
        action.remove();
        this.headerActions.delete(view);
      }
    }
  }
  syncNewTabActions() {
    if (this.unloading) return;
    const leaves = new Set(this.app.workspace.getLeavesOfType("empty"));
    for (const [leaf, action] of this.newTabActions) {
      if (!leaves.has(leaf) || !action.isConnected) {
        action.remove();
        this.newTabActions.delete(leaf);
      }
    }
    for (const leaf of leaves) {
      if (this.newTabActions.has(leaf)) continue;
      const list = leaf.view.containerEl.querySelector(".empty-state-action-list");
      if (!list) continue;
      const button = list.createDiv({
        cls: "text-icon-button tappable mod-pill empty-state-action brainos-new-thought-action",
        attr: { tabindex: "0", role: "button", "aria-label": "\u65B0\u5EFA\u601D\u8003" }
      });
      (0, import_obsidian8.setIcon)(button.createSpan({ cls: "text-button-icon" }), "git-branch");
      button.createSpan({ cls: "text-button-label", text: "\u65B0\u5EFA\u601D\u8003" });
      button.onclick = () => {
        void this.createNewThought("\u672A\u547D\u540D\u601D\u8003", leaf);
      };
      button.onkeydown = (event) => {
        if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          button.click();
        }
      };
      this.newTabActions.set(leaf, button);
    }
  }
  async openMindView(leaf, file) {
    if (!file || file.extension !== "md") return;
    if (!isThoughtFile(file.path, this.layout.settings.noteFolder)) {
      new import_obsidian8.Notice("\u8FD9\u7BC7\u7B14\u8BB0\u4E0D\u5728\u601D\u8003\u76EE\u5F55\u4E2D\uFF0C\u8BF7\u5148\u5728\u63D2\u4EF6\u8BBE\u7F6E\u4E2D\u9009\u62E9\u5BF9\u5E94\u76EE\u5F55");
      return;
    }
    this.lastMarkdownPath = file.path;
    await this.viewMode.showMind(leaf, file.path);
  }
  async openMarkdownView(leaf, file) {
    await this.viewMode.showMarkdown(leaf, file.path);
    this.syncHeaderActions();
  }
  async toggleMindView() {
    const mind = this.app.workspace.getActiveViewOfType(BrainOSGraphView);
    if (mind == null ? void 0 : mind.file) {
      await this.openMarkdownView(mind.leaf, mind.file);
      return;
    }
    const markdown = this.app.workspace.getActiveViewOfType(import_obsidian8.MarkdownView);
    if (markdown == null ? void 0 : markdown.file) {
      await this.openMindView(markdown.leaf, markdown.file);
      return;
    }
    await this.activateView();
  }
  async createNewThought(title = "\u672A\u547D\u540D\u601D\u8003", targetLeaf) {
    if (this.creatingThought) return false;
    this.creatingThought = true;
    try {
      const file = await createThought(this.app, title, this.layout.settings.noteFolder);
      const leaf = (targetLeaf == null ? void 0 : targetLeaf.view.getViewType()) === "empty" ? targetLeaf : this.app.workspace.getLeaf("tab");
      await this.openMindView(leaf, file);
      await this.app.workspace.revealLeaf(leaf);
      this.refreshViews();
      return true;
    } catch (error) {
      new import_obsidian8.Notice(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      this.creatingThought = false;
    }
  }
  async activateView() {
    const workspace = this.app.workspace;
    const mainRoot = workspace.rootSplit;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE);
    const mainLeaf = leaves.find((leaf2) => leaf2.getRoot() === mainRoot);
    for (const leaf2 of leaves) {
      const root = leaf2.getRoot();
      if (root === workspace.leftSplit || root === workspace.rightSplit) leaf2.detach();
    }
    if (mainLeaf) {
      await workspace.revealLeaf(mainLeaf);
      return;
    }
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
  }
  scheduleRefresh() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.refreshViews(), 350);
  }
  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof BrainOSGraphView) void view.refresh();
    }
  }
  async saveLayout() {
    await this.saveData(this.layout);
  }
  get activeSession() {
    var _a;
    return (_a = this.layout.sessions.find((session) => session.id === this.layout.activeSessionId && !session.endedAt)) != null ? _a : this.layout.sessions.find((session) => !session.endedAt);
  }
  startSession(thoughtPath) {
    var _a, _b;
    if (this.activeSession) {
      new import_obsidian8.Notice("\u5DF2\u6709\u4E00\u4E2A BrainOS Session \u6B63\u5728\u8BB0\u5F55");
      return;
    }
    const path = (thoughtPath == null ? void 0 : thoughtPath.trim()) || void 0;
    const thoughtFile = path ? this.app.vault.getAbstractFileByPath(path) : void 0;
    const thoughtTitle = thoughtFile instanceof import_obsidian8.TFile ? (_b = (_a = this.app.metadataCache.getFileCache(thoughtFile)) == null ? void 0 : _a.frontmatter) == null ? void 0 : _b.title : void 0;
    const title = path ? String(thoughtTitle != null ? thoughtTitle : path) : "\u672A\u547D\u540D Session";
    const session = {
      id: crypto.randomUUID(),
      title: path ? `\u4ECE\u300C${title}\u300D\u5F00\u59CB` : "\u672A\u547D\u540D Session",
      ...path ? { thoughtPath: path } : {},
      stepKeys: [],
      startedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.layout.sessions.unshift(session);
    this.layout.activeSessionId = session.id;
    void this.saveLayout();
    new import_obsidian8.Notice(`Session \u5DF2\u5F00\u59CB\uFF1A${session.title}`);
    this.refreshViews();
  }
  endSession() {
    const session = this.activeSession;
    if (!session) return;
    session.endedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.layout.activeSessionId = void 0;
    void this.saveLayout();
    new import_obsidian8.Notice(`Session \u5DF2\u4FDD\u5B58\uFF1A${session.stepKeys.length} \u6B65`);
    this.refreshViews();
  }
  recordSessionStep(stepPath, thoughtPath) {
    const session = this.activeSession;
    if (!session) return;
    if (thoughtPath && !session.thoughtPath) session.thoughtPath = thoughtPath;
    session.stepKeys.push(stepPath);
    void this.saveLayout();
  }
};
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function isPoint(value) {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y) && Math.abs(value.x) <= 1e7 && Math.abs(value.y) <= 1e7;
}
function isViewport(value) {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y) && Math.abs(value.x) <= 1e7 && Math.abs(value.y) <= 1e7 && Number.isFinite(value.zoom) && value.zoom > 0 && value.zoom <= 100;
}
var BrainOSSettingTab = class extends import_obsidian8.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    __publicField(this, "folderSuggest");
    plugin.register(() => {
      var _a;
      return (_a = this.folderSuggest) == null ? void 0 : _a.dispose();
    });
  }
  hide() {
    var _a;
    (_a = this.folderSuggest) == null ? void 0 : _a.dispose();
    this.folderSuggest = void 0;
  }
  display() {
    this.hide();
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "BrainOS Graph" });
    new import_obsidian8.Setting(this.containerEl).setName("\u601D\u8003\u76EE\u5F55").setDesc("\u586B\u5199\u7B14\u8BB0\u5E93\u5185\u7684\u6587\u4EF6\u5939\u8DEF\u5F84\uFF0C\u4F8B\u5982 BrainOS/\u601D\u8003\u3002\u65B0\u601D\u8003\u4FDD\u5B58\u5230\u8FD9\u91CC\uFF0C\u8282\u70B9\u68C0\u7D22\u4EC5\u5305\u542B\u6B64\u76EE\u5F55\u53CA\u5B50\u76EE\u5F55\u7684 Markdown\uFF1B\u7559\u7A7A\u4F7F\u7528\u6574\u4E2A\u7B14\u8BB0\u5E93\u3002").addText((text) => {
      const updateFolder = async (value) => {
        const folder = value.trim();
        this.plugin.layout.settings.noteFolder = folder;
        await this.plugin.saveLayout();
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
          const view = leaf.view;
          if (view.file && !isThoughtFile(view.file.path, folder)) await this.plugin.openMarkdownView(leaf, view.file);
          else {
            view.cancelNodeEditing();
          }
        }
        this.plugin.refreshIntegrations();
        this.plugin.refreshViews();
      };
      text.setPlaceholder("\u4F8B\u5982 BrainOS/\u601D\u8003\uFF1B\u7559\u7A7A\u4F7F\u7528\u6839\u76EE\u5F55").setValue(this.plugin.layout.settings.noteFolder).onChange(updateFolder);
      this.folderSuggest = new FolderSuggest(
        this.app,
        text.inputEl,
        () => this.app.vault.getAllLoadedFiles().filter((file) => file instanceof import_obsidian8.TFolder).map((folder) => folder.path),
        updateFolder
      );
    });
    new import_obsidian8.Setting(this.containerEl).setName("\u91CD\u65B0\u751F\u6210\u5E03\u5C40").setDesc("\u5220\u9664\u4FDD\u5B58\u7684\u5750\u6807\uFF0C\u4E0B\u4E00\u6B21\u6253\u5F00\u56FE\u8C31\u65F6\u81EA\u52A8\u6392\u5217\u8282\u70B9\u3002").addButton((button) => button.setButtonText("\u91CD\u7F6E").onClick(async () => {
      this.plugin.layout.positions = {};
      await this.plugin.saveLayout();
      this.plugin.refreshViews();
      new import_obsidian8.Notice("\u56FE\u8C31\u5E03\u5C40\u5DF2\u91CD\u7F6E");
    }));
  }
};
