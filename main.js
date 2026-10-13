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
var import_obsidian3 = require("obsidian");

// src/graph-view.ts
var import_obsidian2 = require("obsidian");

// src/thoughts.ts
var import_obsidian = require("obsidian");
var DEFAULT_THOUGHT_FOLDER = "";
var THOUGHT_STATE_FOLDER = ".brainos/thoughts/.state";
var FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
var HTML_COMMENT = /<!--[\s\S]*?-->/g;
var LEGACY_STATE = /<!--\s*brainos-state\s*\n([\s\S]*?)\n-->/;
var HEADING = /^#+\s/;
var LIST_MARKER = /^[-*+]\s+/;
function legacyRows(markdown) {
  var _a, _b, _c, _d;
  const match = markdown.match(LEGACY_STATE);
  if (!match) return void 0;
  try {
    const value = JSON.parse(match[1]);
    if (!Array.isArray(value.paths)) return void 0;
    const rows = [];
    for (const path of value.paths) {
      for (const step of (_a = path.steps) != null ? _a : []) {
        const key = String((_d = (_c = (_b = step.atom) != null ? _b : step.nodeID) != null ? _c : step.node) != null ? _d : "").trim();
        if (key) rows.push({ text: atomLabel(key), depth: 0 });
      }
    }
    return rows;
  } catch (e) {
    return void 0;
  }
}
function atomLabel(key) {
  var _a;
  const last = (_a = key.split("/").pop()) != null ? _a : key;
  return last.replace(/\.thought\.md$/i, "").replace(/\.md$/i, "") || key;
}
function parseOutline(markdown) {
  const legacy = legacyRows(markdown);
  if (legacy) return legacy;
  const body = markdown.replace(FRONTMATTER, "").replace(HTML_COMMENT, "");
  const rows = [];
  const widths = [];
  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    const indent = raw.match(/^[ \t]*/)[0];
    const width = [...indent].reduce((total, char) => total + (char === "	" ? 4 : 1), 0);
    let text = raw.slice(indent.length).trim();
    if (LIST_MARKER.test(text)) text = text.replace(LIST_MARKER, "");
    text = text.replace(/&#x20;/g, " ").trim();
    if (!text || HEADING.test(text)) continue;
    if (text.startsWith("[[") && text.endsWith("]]") && text.length > 4) {
      text = atomLabel(text.slice(2, -2));
    }
    while (widths.length && widths[widths.length - 1] >= width) widths.pop();
    rows.push({ text, depth: widths.length });
    widths.push(width);
  }
  return rows;
}
function outlineText(rows) {
  return rows.map((row) => "    ".repeat(row.depth) + row.text).join("\n");
}
function parentIndex(rows, index) {
  if (!rows[index] || rows[index].depth <= 0) return void 0;
  for (let i = index - 1; i >= 0; i--) if (rows[i].depth < rows[index].depth) return i;
  return void 0;
}
function subtreeEnd(rows, index) {
  let end = index + 1;
  while (end < rows.length && rows[end].depth > rows[index].depth) end++;
  return end;
}
function thoughtTitle(file) {
  return file.basename.replace(/\.thought$/i, "") || file.basename;
}
function targetFolder(folder) {
  return (0, import_obsidian.normalizePath)(folder.trim().replace(/^\/+|\/+$/g, ""));
}
async function uniquePath(app, title, folder) {
  const normalized = targetFolder(folder);
  if (normalized) await ensureFolder(app, normalized);
  const safe = title.replace(/[\\/:*?"<>|\r\n]/g, "-").trim().replace(/[. ]+$/g, "") || "\u672A\u547D\u540D\u601D\u8003";
  const base = (0, import_obsidian.normalizePath)(`${normalized}/${safe}.md`.replace(/^\/+/, ""));
  if (!app.vault.getAbstractFileByPath(base)) return base;
  for (let i = 2; ; i++) {
    const path = (0, import_obsidian.normalizePath)(`${normalized}/${safe} ${i}.md`.replace(/^\/+/, ""));
    if (!app.vault.getAbstractFileByPath(path)) return path;
  }
}
async function ensureFolder(app, folder) {
  const normalized = targetFolder(folder);
  let current = "";
  for (const part of normalized.split("/")) {
    if (!part) continue;
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}
async function createThought(app, title, folder) {
  const path = await uniquePath(app, title, folder);
  return app.vault.create(path, "");
}
async function cachedThoughtPaths(app) {
  const paths = /* @__PURE__ */ new Set();
  let listing;
  try {
    listing = await app.vault.adapter.list(THOUGHT_STATE_FOLDER);
  } catch (e) {
    return paths;
  }
  for (const file of listing.files) {
    if (!file.endsWith(".json")) continue;
    try {
      const value = JSON.parse(await app.vault.adapter.read(file));
      if (value.filename) paths.add((0, import_obsidian.normalizePath)(value.filename));
    } catch (e) {
    }
  }
  return paths;
}
async function listThoughtFiles(app, folder, known) {
  const normalized = targetFolder(folder);
  const cached = await cachedThoughtPaths(app);
  const recorded = new Set(known.map((path) => (0, import_obsidian.normalizePath)(path)));
  return app.vault.getMarkdownFiles().filter((file) => {
    var _a, _b;
    if (recorded.has(file.path) || cached.has(file.path)) return true;
    if (/\.thought\.md$/i.test(file.path)) return true;
    if (((_b = (_a = app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter) == null ? void 0 : _b.brainos_type) === "thought-file") return true;
    return normalized.length > 0 && file.path.startsWith(normalized + "/");
  });
}
async function buildSnapshot(app, thoughts) {
  var _a, _b;
  const nodes = /* @__PURE__ */ new Map();
  const edges = /* @__PURE__ */ new Map();
  const list = [];
  for (const file of thoughts) {
    const title = thoughtTitle(file);
    list.push({ path: file.path, title });
    const rows = parseOutline(await app.vault.cachedRead(file));
    if (!rows.length) {
      nodes.set(`thought:${file.path}`, { path: `thought:${file.path}`, label: title, openPath: file.path, x: 0, y: 0, degree: 0, thoughts: [file.path], placeholder: true });
      continue;
    }
    for (let i = 0; i < rows.length; i++) {
      const key = rows[i].text;
      const node = (_a = nodes.get(key)) != null ? _a : { path: key, label: key, openPath: file.path, x: 0, y: 0, degree: 0, thoughts: [] };
      if (!node.thoughts.includes(file.path)) node.thoughts.push(file.path);
      nodes.set(key, node);
      const parent = parentIndex(rows, i);
      if (parent === void 0) continue;
      const from = rows[parent].text;
      if (from === key) continue;
      const edgeKey = JSON.stringify([from, key]);
      const edge = (_b = edges.get(edgeKey)) != null ? _b : { from, to: key, thoughts: [] };
      if (!edge.thoughts.includes(file.path)) edge.thoughts.push(file.path);
      edges.set(edgeKey, edge);
    }
  }
  for (const edge of edges.values()) {
    nodes.get(edge.from).degree++;
    nodes.get(edge.to).degree++;
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], thoughts: list };
}
async function editOutline(app, path, edit) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof import_obsidian.TFile)) throw new Error("\u601D\u8003\u6587\u4EF6\u5DF2\u4E0D\u5B58\u5728");
  await app.vault.process(file, (markdown) => {
    var _a;
    const rows = parseOutline(markdown);
    return outlineText((_a = edit(rows)) != null ? _a : rows);
  });
}
async function appendRoot(app, thought, text) {
  await editOutline(app, thought, (rows) => {
    rows.push({ text, depth: 0 });
  });
}
async function addChild(app, thought, parentText, text) {
  await editOutline(app, thought, (rows) => {
    const parent = parentText === void 0 ? -1 : rows.findIndex((row) => row.text === parentText);
    if (parent >= 0) {
      rows.splice(subtreeEnd(rows, parent), 0, { text, depth: rows[parent].depth + 1 });
      return;
    }
    rows.push({ text, depth: 0 });
  });
}
async function addSibling(app, thought, siblingText, text) {
  await editOutline(app, thought, (rows) => {
    const sibling = rows.findIndex((row) => row.text === siblingText);
    if (sibling >= 0) {
      rows.splice(subtreeEnd(rows, sibling), 0, { text, depth: rows[sibling].depth });
      return;
    }
    rows.push({ text, depth: 0 });
  });
}
async function renameNode(app, thought, from, to) {
  await editOutline(app, thought, (rows) => {
    let changed = false;
    for (const row of rows) if (row.text === from) {
      row.text = to;
      changed = true;
    }
    if (!changed) throw new Error("\u8282\u70B9\u5DF2\u4E0D\u5B58\u5728");
  });
}
async function removeNode(app, thought, text) {
  await editOutline(app, thought, (rows) => {
    let changed = false;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].text !== text) continue;
      rows.splice(i, subtreeEnd(rows, i) - i);
      changed = true;
    }
    if (!changed) throw new Error("\u8282\u70B9\u5DF2\u4E0D\u5B58\u5728");
  });
}

// src/graph-view.ts
var VIEW_TYPE = "brainos-graph-view";
var BrainOSGraphView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    __publicField(this, "canvas");
    __publicField(this, "search");
    __publicField(this, "thoughtSelect");
    __publicField(this, "status");
    __publicField(this, "snapshot", { nodes: [], edges: [], thoughts: [] });
    __publicField(this, "nodes", []);
    __publicField(this, "edges", []);
    __publicField(this, "thoughtPath", "");
    __publicField(this, "zoom", 1);
    __publicField(this, "pan", { x: 0, y: 0 });
    __publicField(this, "selected");
    __publicField(this, "gesture");
    __publicField(this, "editor");
    __publicField(this, "busy", false);
    __publicField(this, "refreshRevision", 0);
    __publicField(this, "closed", false);
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "BrainOS \u56FE\u8C31";
  }
  getIcon() {
    return "git-branch";
  }
  async onOpen() {
    this.closed = false;
    this.contentEl.empty();
    this.contentEl.addClass("brainos-graph-view");
    const toolbar = this.contentEl.createDiv({ cls: "brainos-graph-toolbar" });
    this.thoughtSelect = toolbar.createEl("select", { attr: { "aria-label": "\u5F53\u524D\u601D\u8003" } });
    this.thoughtSelect.onchange = () => {
      this.thoughtPath = this.thoughtSelect.value;
      this.selected = void 0;
      this.closeEditor();
      this.filterSnapshot();
      this.draw();
    };
    const create = toolbar.createEl("button", { text: "\u65B0\u5EFA\u8282\u70B9" });
    create.onclick = () => void this.beginCreate(this.screenToWorld(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2));
    const extend = toolbar.createEl("button", { text: "\u5EF6\u4F38\u8282\u70B9", attr: { title: "\u9009\u4E2D\u8282\u70B9\u540E\u6309 Tab" } });
    extend.onclick = () => void this.createRelative(true);
    const refresh = toolbar.createEl("button", { attr: { "aria-label": "\u5237\u65B0\u56FE\u8C31" } });
    (0, import_obsidian2.setIcon)(refresh, "refresh-cw");
    refresh.onclick = () => void this.refresh();
    const focus = toolbar.createEl("button", { text: "\u805A\u7126\u5F53\u524D" });
    focus.onclick = () => this.focusCurrent();
    this.search = toolbar.createEl("input", { type: "search", placeholder: "\u641C\u7D22\u8282\u70B9\u2026", attr: { "aria-label": "\u641C\u7D22\u8282\u70B9" } });
    this.search.oninput = () => this.draw();
    this.canvas = this.contentEl.createEl("canvas", { cls: "brainos-graph-canvas", attr: { "aria-label": "BrainOS \u53EF\u7F16\u8F91\u56FE\u8C31" } });
    this.canvas.tabIndex = 0;
    this.status = this.contentEl.createDiv({ cls: "brainos-graph-status" });
    this.registerDomEvent(this.canvas, "pointerdown", (event) => this.onPointerDown(event));
    this.registerDomEvent(this.canvas, "pointermove", (event) => this.onPointerMove(event));
    this.registerDomEvent(this.canvas, "pointerup", (event) => this.onPointerUp(event));
    this.registerDomEvent(this.canvas, "pointercancel", () => this.cancelGesture());
    this.registerDomEvent(this.canvas, "lostpointercapture", () => this.cancelGesture());
    this.registerDomEvent(this.canvas, "wheel", (event) => this.onWheel(event), { passive: false });
    this.registerDomEvent(this.canvas, "dblclick", (event) => this.onDoubleClick(event));
    this.registerDomEvent(this.canvas, "contextmenu", (event) => this.onContextMenu(event));
    this.registerDomEvent(this.canvas, "keydown", (event) => this.onKeyDown(event));
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(this.contentEl);
    this.register(() => observer.disconnect());
    await this.refresh();
  }
  async onClose() {
    this.closed = true;
    this.refreshRevision++;
    this.cancelGesture();
    this.closeEditor();
  }
  async refresh() {
    const revision = ++this.refreshRevision;
    const thoughts = await listThoughtFiles(this.app, this.plugin.layout.settings.thoughtFolder, this.plugin.layout.thoughts);
    const snapshot = await buildSnapshot(this.app, thoughts);
    if (this.closed || revision !== this.refreshRevision) return;
    this.snapshot = snapshot;
    if (this.thoughtPath && !snapshot.thoughts.some((thought) => thought.path === this.thoughtPath)) this.thoughtPath = "";
    this.thoughtSelect.empty();
    this.thoughtSelect.createEl("option", { text: "\u5168\u90E8\u601D\u8003", value: "" });
    for (const thought of snapshot.thoughts) this.thoughtSelect.createEl("option", { text: `${thought.title} \u2014 ${thought.path}`, value: thought.path });
    this.thoughtSelect.value = this.thoughtPath;
    const radius = Math.max(180, Math.sqrt(snapshot.nodes.length) * 85);
    snapshot.nodes.forEach((node, index) => {
      var _a;
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const r = radius * Math.sqrt((index + 1) / Math.max(1, snapshot.nodes.length));
      const position = (_a = this.plugin.layout.positions[node.path]) != null ? _a : { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
      Object.assign(node, position);
      this.plugin.layout.positions[node.path] = { ...position };
    });
    this.filterSnapshot();
    if (this.selected && !this.nodes.some((node) => node.path === this.selected)) this.selected = void 0;
    this.resize();
  }
  filterSnapshot() {
    this.nodes = this.thoughtPath ? this.snapshot.nodes.filter((node) => node.thoughts.includes(this.thoughtPath)) : this.snapshot.nodes;
    this.edges = this.thoughtPath ? this.snapshot.edges.filter((edge) => edge.thoughts.includes(this.thoughtPath)) : this.snapshot.edges;
  }
  /// 工具栏当前选中的思考文件；「全部思考」时为空。
  currentThought() {
    return this.thoughtPath;
  }
  focusCurrent() {
    var _a;
    const file = (_a = this.app.workspace.getActiveViewOfType(import_obsidian2.MarkdownView)) == null ? void 0 : _a.file;
    if (!file) {
      new import_obsidian2.Notice("\u5F53\u524D\u6CA1\u6709\u6253\u5F00\u7684 Markdown \u6587\u4EF6");
      return;
    }
    if (this.snapshot.thoughts.some((thought) => thought.path === file.path)) {
      this.thoughtPath = file.path;
      this.selected = void 0;
      this.closeEditor();
      this.thoughtSelect.value = file.path;
      this.filterSnapshot();
      this.draw();
      return;
    }
    const node = this.nodes.find((item) => item.path === file.basename);
    if (!node) {
      new import_obsidian2.Notice("\u5F53\u524D\u6587\u4EF6\u4E0D\u662F\u601D\u8003\u6587\u4EF6\uFF0C\u4E5F\u6CA1\u6709\u540C\u540D\u8282\u70B9");
      return;
    }
    this.selected = node.path;
    this.pan = { x: -node.x, y: -node.y };
    this.draw();
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
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const point = this.worldToScreen(this.nodes[i]);
      if (Math.hypot(point.x - x, point.y - y) <= Math.max(10, Math.min(12, 5 + this.nodes[i].degree * 0.7))) return this.nodes[i];
    }
  }
  draw() {
    var _a;
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    const colors = getComputedStyle(this.canvas);
    const edgeColor = colors.getPropertyValue("--text-muted") || "#888";
    const accent = colors.getPropertyValue("--interactive-accent") || "#7c3aed";
    const text = colors.getPropertyValue("--text-normal") || "#222";
    const query = this.search.value.trim().toLocaleLowerCase();
    const matches = new Set(this.nodes.filter((node) => node.label.toLocaleLowerCase().includes(query) || node.path.toLocaleLowerCase().includes(query)).map((node) => node.path));
    const byPath = new Map(this.nodes.map((node) => [node.path, node]));
    ctx.lineWidth = 1;
    ctx.strokeStyle = edgeColor;
    for (const edge of this.edges) {
      const a = byPath.get(edge.from), b = byPath.get(edge.to);
      if (!a || !b) continue;
      const p = this.worldToScreen(a), q = this.worldToScreen(b);
      ctx.globalAlpha = query && (!matches.has(a.path) || !matches.has(b.path)) ? 0.18 : 0.55;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      const angle = Math.atan2(q.y - p.y, q.x - p.x), tip = { x: q.x - Math.cos(angle) * 15, y: q.y - Math.sin(angle) * 15 };
      ctx.beginPath();
      ctx.moveTo(tip.x - Math.cos(angle - 0.5) * 7, tip.y - Math.sin(angle - 0.5) * 7);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(tip.x - Math.cos(angle + 0.5) * 7, tip.y - Math.sin(angle + 0.5) * 7);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (((_a = this.gesture) == null ? void 0 : _a.kind) === "link") {
      const point = this.worldToScreen(this.gesture.node);
      ctx.strokeStyle = accent;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
      ctx.lineTo(this.gesture.end.x, this.gesture.end.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const node of this.nodes) {
      const point = this.worldToScreen(node), radius = Math.max(5, Math.min(12, 5 + node.degree * 0.7));
      ctx.globalAlpha = query && !matches.has(node.path) ? 0.18 : 1;
      ctx.fillStyle = node.placeholder ? edgeColor : accent;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
      if (node.path === this.selected) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      ctx.font = `12px ${colors.getPropertyValue("--font-text") || "sans-serif"}`;
      ctx.textAlign = "center";
      ctx.fillStyle = text;
      ctx.fillText(node.label.slice(0, 32), point.x, point.y + radius + 15);
    }
    ctx.globalAlpha = 1;
    let empty = this.contentEl.querySelector(".brainos-graph-empty");
    if (!this.nodes.length && !empty) empty = this.contentEl.createDiv({ cls: "brainos-graph-empty", text: "\u53CC\u51FB\u7A7A\u767D\u5904\u6216\u70B9\u51FB\u300C\u65B0\u5EFA\u8282\u70B9\u300D\uFF0C\u5F00\u59CB\u4E00\u4E2A\u601D\u8003\u3002" });
    if (this.nodes.length) empty == null ? void 0 : empty.remove();
    const selected = this.nodes.find((node) => node.path === this.selected);
    this.status.setText(selected ? `\u5DF2\u9009\uFF1A${selected.label} \xB7 Tab \u5EF6\u4F38 \xB7 Enter \u540C\u7EA7 \xB7 \u7A7A\u683C\u7F16\u8F91 \xB7 Alt \u62D6\u52A8\u8FDE\u7EBF \xB7 \u53F3\u952E\u66F4\u591A` : "\u53CC\u51FB\u7A7A\u767D\u521B\u5EFA \xB7 \u62D6\u52A8\u8282\u70B9\u79FB\u52A8 \xB7 \u62D6\u52A8\u7A7A\u767D\u5E73\u79FB \xB7 \u6EDA\u8F6E\u7F29\u653E");
  }
  onPointerDown(event) {
    if (event.button !== 0 || this.editor || this.busy) return;
    this.canvas.focus();
    const rect = this.canvas.getBoundingClientRect(), point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const node = this.nodeAt(point.x, point.y);
    const base = { pointer: event.pointerId, start: point, last: point, moved: false };
    if (node) {
      this.selected = node.path;
      const world = this.screenToWorld(point.x, point.y);
      this.gesture = event.altKey && !node.placeholder ? { ...base, kind: "link", node, end: point } : { ...base, kind: "node", node, offset: { x: node.x - world.x, y: node.y - world.y } };
    } else {
      this.selected = void 0;
      this.gesture = { ...base, kind: "pan" };
    }
    this.canvas.setPointerCapture(event.pointerId);
    this.draw();
  }
  onPointerMove(event) {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointer) return;
    const rect = this.canvas.getBoundingClientRect(), point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 4) gesture.moved = true;
    if (!gesture.moved) return;
    this.canvas.addClass("is-dragging");
    if (gesture.kind === "node") {
      const world = this.screenToWorld(point.x, point.y);
      gesture.node.x = world.x + gesture.offset.x;
      gesture.node.y = world.y + gesture.offset.y;
      this.plugin.layout.positions[gesture.node.path] = { x: gesture.node.x, y: gesture.node.y };
    } else if (gesture.kind === "pan") {
      this.pan.x += (point.x - gesture.last.x) / this.zoom;
      this.pan.y += (point.y - gesture.last.y) / this.zoom;
    } else gesture.end = point;
    gesture.last = point;
    this.draw();
  }
  onPointerUp(event) {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointer) return;
    this.cancelGesture();
    if (!gesture.moved) return;
    if (gesture.kind === "node") void this.runEdit(() => this.plugin.saveLayout());
    if (gesture.kind === "link") {
      const rect = this.canvas.getBoundingClientRect(), target = this.nodeAt(event.clientX - rect.left, event.clientY - rect.top);
      if (target && !target.placeholder && target.path !== gesture.node.path) void this.connect(gesture.node, target);
    }
  }
  cancelGesture() {
    var _a, _b;
    const pointer = (_a = this.gesture) == null ? void 0 : _a.pointer;
    this.gesture = void 0;
    if (pointer !== void 0 && this.canvas.hasPointerCapture(pointer)) this.canvas.releasePointerCapture(pointer);
    (_b = this.canvas) == null ? void 0 : _b.removeClass("is-dragging");
    if (!this.closed) this.draw();
  }
  onWheel(event) {
    event.preventDefault();
    if (this.editor) return;
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const before = this.screenToWorld(x, y);
    this.zoom = Math.max(0.2, Math.min(3, this.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
    const after = this.screenToWorld(x, y);
    this.pan.x += after.x - before.x;
    this.pan.y += after.y - before.y;
    this.draw();
  }
  onDoubleClick(event) {
    if (this.editor || this.busy) return;
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const node = this.nodeAt(x, y);
    if (node) void this.app.workspace.openLinkText(node.openPath, "", false);
    else void this.beginCreate(this.screenToWorld(x, y));
  }
  onKeyDown(event) {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || this.editor || this.busy) return;
    const node = this.nodes.find((item) => item.path === this.selected);
    if (event.key === "Tab" || event.key === "Enter") {
      event.preventDefault();
      void this.createRelative(event.key === "Tab");
    } else if (event.key === " " && node) {
      event.preventDefault();
      void this.beginEdit(node);
    } else if ((event.key === "Delete" || event.key === "Backspace") && node) {
      event.preventDefault();
      this.removeNode(node);
    } else if (event.key === "Escape") {
      this.selected = void 0;
      this.draw();
    }
  }
  /// 优先用工具栏选中的思考；否则只有唯一归属时才自动落盘。
  editingThought(node) {
    if (this.thoughtPath) return this.thoughtPath;
    if (node == null ? void 0 : node.placeholder) return node.thoughts[0];
    if ((node == null ? void 0 : node.thoughts.length) === 1) return node.thoughts[0];
    if (this.snapshot.thoughts.length === 1) return this.snapshot.thoughts[0].path;
    if (node) new import_obsidian2.Notice("\u8282\u70B9\u5C5E\u4E8E\u591A\u4E2A\u601D\u8003\uFF0C\u8BF7\u5148\u5728\u5DE5\u5177\u680F\u9009\u62E9\u8981\u5199\u5165\u7684\u601D\u8003");
  }
  async createRelative(child) {
    const node = this.nodes.find((item) => item.path === this.selected);
    if (!node) {
      await this.beginCreate(this.screenToWorld(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2));
      return;
    }
    const thought = this.editingThought(node);
    if (!thought) return;
    if (node.placeholder) {
      await this.beginCreate({ x: node.x, y: node.y }, {}, thought);
      return;
    }
    if (child) await this.beginCreate({ x: node.x + 150, y: node.y }, { parent: node.path }, thought);
    else await this.beginCreate({ x: node.x, y: node.y + 100 }, { after: node.path }, thought);
  }
  async beginCreate(point, options = {}, target = this.editingThought()) {
    var _a, _b;
    if (this.busy) return;
    this.closeEditor();
    const form = this.openEditor(point, options.parent ? "\u5EF6\u4F38\u8282\u70B9" : options.after ? "\u540C\u7EA7\u8282\u70B9" : "\u65B0\u5EFA\u8282\u70B9");
    form.createDiv({ cls: "brainos-node-editor-target", text: target ? `\u5199\u5165\uFF1A${(_b = (_a = this.snapshot.thoughts.find((thought) => thought.path === target)) == null ? void 0 : _a.title) != null ? _b : target}` : "\u5199\u5165\u65F6\u81EA\u52A8\u65B0\u5EFA\u4E00\u4E2A\u601D\u8003\u6587\u4EF6" });
    const title = form.createEl("input", { placeholder: "\u4E00\u884C\u6587\u5B57\u5C31\u662F\u8282\u70B9", attr: { "aria-label": "\u8282\u70B9\u6587\u5B57", required: "" } });
    const controls = form.createDiv({ cls: "brainos-node-editor-actions" });
    const cancel = controls.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
    cancel.onclick = () => this.closeEditor();
    const save = controls.createEl("button", { text: "\u521B\u5EFA", cls: "mod-cta", attr: { type: "submit" } });
    form.onsubmit = (event) => {
      event.preventDefault();
      const label = title.value.trim();
      if (!label || this.busy) return;
      save.disabled = true;
      void this.runEdit(async () => {
        let thought = target;
        if (thought) {
          if (!(this.app.vault.getAbstractFileByPath(thought) instanceof import_obsidian2.TFile)) throw new Error("\u601D\u8003\u6587\u4EF6\u5DF2\u4E0D\u5B58\u5728");
        } else {
          const file = await createThought(this.app, label, this.plugin.layout.settings.thoughtFolder);
          this.plugin.layout.thoughts.push(file.path);
          thought = file.path;
        }
        if (options.parent !== void 0) await addChild(this.app, thought, options.parent, label);
        else if (options.after !== void 0) await addSibling(this.app, thought, options.after, label);
        else await appendRoot(this.app, thought, label);
        this.plugin.layout.positions[label] = point;
        await this.plugin.saveLayout();
        this.thoughtPath = thought;
        this.selected = label;
        this.closeEditor();
        await this.refresh();
        this.plugin.refreshViews();
      }).finally(() => {
        save.disabled = false;
      });
    };
    title.focus();
  }
  async beginEdit(node) {
    if (this.busy) return;
    if (node.placeholder) {
      new import_obsidian2.Notice("\u8FD9\u662F\u7A7A\u601D\u8003\u7684\u5165\u53E3\uFF1B\u53EF\u4EE5\u5EF6\u4F38\u65B0\u8282\u70B9");
      return;
    }
    const thought = this.editingThought(node);
    if (!thought) return;
    this.closeEditor();
    const form = this.openEditor(node, `\u7F16\u8F91\uFF1A${node.label}`);
    const field = form.createEl("input", { attr: { "aria-label": "\u8282\u70B9\u6587\u5B57" } });
    field.value = node.label;
    form.createDiv({ cls: "brainos-node-editor-target", text: "\u76F8\u540C\u6587\u5B57\u5171\u7528\u4E00\u4E2A\u8282\u70B9\uFF1B\u6539\u540D\u4F1A\u6539\u6389\u8FD9\u4EFD\u601D\u8003\u91CC\u8BE5\u6587\u5B57\u7684\u6240\u6709\u51FA\u73B0\u3002" });
    const controls = form.createDiv({ cls: "brainos-node-editor-actions" });
    const cancel = controls.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
    cancel.onclick = () => this.closeEditor();
    const save = controls.createEl("button", { text: "\u4FDD\u5B58", cls: "mod-cta", attr: { type: "submit" } });
    form.onsubmit = (event) => {
      event.preventDefault();
      const value = field.value.trim();
      if (!value || this.busy) return;
      save.disabled = true;
      void this.runEdit(async () => {
        if (value !== node.label) await renameNode(this.app, thought, node.label, value);
        this.selected = value;
        this.closeEditor();
        await this.refresh();
        this.plugin.refreshViews();
      }).finally(() => {
        save.disabled = false;
      });
    };
    field.focus();
  }
  openEditor(point, heading) {
    const form = this.contentEl.createEl("form", { cls: "brainos-node-editor" });
    this.editor = form;
    form.createEl("strong", { text: heading });
    const screen = this.worldToScreen(point);
    form.style.left = `${Math.max(8, Math.min(this.contentEl.clientWidth - 348, screen.x - 160))}px`;
    form.style.top = `${Math.max(60, Math.min(this.contentEl.clientHeight - 240, screen.y + 65))}px`;
    form.onkeydown = (event) => {
      event.stopPropagation();
      if (event.key === "Escape" && !this.busy) {
        event.preventDefault();
        this.closeEditor();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        form.requestSubmit();
      }
    };
    return form;
  }
  closeEditor() {
    var _a, _b;
    (_a = this.editor) == null ? void 0 : _a.remove();
    this.editor = void 0;
    if (!this.closed) (_b = this.canvas) == null ? void 0 : _b.focus();
  }
  async runEdit(action) {
    if (this.busy) return;
    this.busy = true;
    try {
      await action();
    } catch (error) {
      new import_obsidian2.Notice(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
    }
  }
  /// 连线就是让目标成为来源的子行；再次连线已存在的父子会被跳过。
  async connect(from, to) {
    const thought = this.editingThought(from);
    if (!thought) return;
    if (this.edges.some((edge) => edge.from === from.path && edge.to === to.path && edge.thoughts.includes(thought))) return;
    await this.runEdit(async () => {
      await addChild(this.app, thought, from.path, to.path);
      await this.refresh();
      this.plugin.refreshViews();
    });
  }
  removeNode(node) {
    if (node.placeholder) {
      new import_obsidian2.Notice("\u8FD9\u662F\u7A7A\u601D\u8003\u7684\u5165\u53E3\uFF1B\u53EF\u4EE5\u5EF6\u4F38\u65B0\u8282\u70B9\u6216\u6253\u5F00\u601D\u8003\u6587\u4EF6");
      return;
    }
    const thought = this.editingThought(node);
    if (!thought) return;
    new RemoveNodeModal(this.app, node.label, () => this.runEdit(async () => {
      await removeNode(this.app, thought, node.path);
      this.selected = void 0;
      await this.refresh();
      this.plugin.refreshViews();
    })).open();
  }
  onContextMenu(event) {
    event.preventDefault();
    if (this.editor || this.busy) return;
    const rect = this.canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const node = this.nodeAt(x, y), menu = new import_obsidian2.Menu();
    if (node) {
      this.selected = node.path;
      this.draw();
      menu.addItem((item) => item.setTitle("\u7F16\u8F91\u8FD9\u4E00\u884C").setIcon("pencil").onClick(() => void this.beginEdit(node)));
      menu.addItem((item) => item.setTitle("\u6253\u5F00\u601D\u8003\u6587\u4EF6").setIcon("file-text").onClick(() => void this.app.workspace.openLinkText(node.openPath, "", false)));
      menu.addItem((item) => item.setTitle("\u5EF6\u4F38\u8282\u70B9\uFF08Tab\uFF09").setIcon("git-branch").onClick(() => void this.createRelative(true)));
      menu.addItem((item) => item.setTitle("\u4ECE\u5F53\u524D\u601D\u8003\u5220\u9664\u2026").setIcon("trash").onClick(() => this.removeNode(node)));
    } else {
      menu.addItem((item) => item.setTitle("\u5728\u8FD9\u91CC\u65B0\u5EFA\u8282\u70B9").setIcon("plus").onClick(() => void this.beginCreate(this.screenToWorld(x, y))));
    }
    menu.showAtMouseEvent(event);
  }
};
var RemoveNodeModal = class extends import_obsidian2.Modal {
  constructor(app, label, remove) {
    super(app);
    this.label = label;
    this.remove = remove;
  }
  onOpen() {
    this.titleEl.setText(`\u5220\u9664\u300C${this.label}\u300D\uFF1F`);
    this.contentEl.createEl("p", { text: "\u4F1A\u4ECE\u5F53\u524D\u601D\u8003\u7684\u5927\u7EB2\u6587\u4EF6\u91CC\u5220\u6389\u8FD9\u4E00\u884C\uFF0C\u8FDE\u540C\u5B83\u7F29\u8FDB\u66F4\u6DF1\u7684\u6240\u6709\u5B50\u884C\u3002\u5176\u4ED6\u601D\u8003\u4E0E\u6587\u4EF6\u4E0D\u53D8\u3002" });
    new import_obsidian2.Setting(this.contentEl).addButton((button) => button.setButtonText("\u53D6\u6D88").onClick(() => this.close())).addButton((button) => button.setButtonText("\u5220\u9664").setWarning().onClick(() => {
      this.close();
      void this.remove();
    }));
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/main.ts
var DATA_VERSION = 2;
var DEFAULT_SETTINGS = { thoughtFolder: DEFAULT_THOUGHT_FOLDER };
var BrainOSPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "layout", { version: DATA_VERSION, positions: {}, thoughts: [], settings: { ...DEFAULT_SETTINGS } });
    __publicField(this, "refreshTimer");
  }
  async onload() {
    var _a, _b, _c;
    const saved = await this.loadData();
    this.layout = {
      version: DATA_VERSION,
      positions: (_a = saved == null ? void 0 : saved.positions) != null ? _a : {},
      thoughts: (_b = saved == null ? void 0 : saved.thoughts) != null ? _b : [],
      settings: { ...DEFAULT_SETTINGS, ...(_c = saved == null ? void 0 : saved.settings) != null ? _c : {} }
    };
    this.registerView(VIEW_TYPE, (leaf) => new BrainOSGraphView(leaf, this));
    this.addRibbonIcon("git-branch", "\u6253\u5F00 BrainOS \u56FE\u8C31", () => this.activateView());
    this.addRibbonIcon("lightbulb", "\u521B\u5EFA\u65B0\u601D\u8003", () => new ThoughtModal(this.app, this).open());
    this.addCommand({ id: "open-graph", name: "\u6253\u5F00 BrainOS \u56FE\u8C31", callback: () => this.activateView() });
    this.addCommand({ id: "refresh-graph", name: "\u5237\u65B0 BrainOS \u56FE\u8C31", callback: () => this.refreshViews() });
    this.addCommand({ id: "focus-current-note", name: "\u5C06\u56FE\u8C31\u805A\u7126\u5230\u5F53\u524D\u6587\u4EF6", checkCallback: (checking) => {
      var _a2;
      const view = (_a2 = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]) == null ? void 0 : _a2.view;
      if (!view || !(view instanceof BrainOSGraphView)) return false;
      if (!checking) view.focusCurrent();
      return true;
    } });
    this.addCommand({ id: "create-thought", name: "\u521B\u5EFA\u65B0\u601D\u8003", callback: () => new ThoughtModal(this.app, this).open() });
    this.addCommand({ id: "append-current-note", name: "\u5C06\u5F53\u524D\u6587\u4EF6\u52A0\u5165\u5F53\u524D\u601D\u8003", callback: () => void this.appendCurrentNote() });
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("modify", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleRefresh()));
    this.addSettingTab(new BrainOSSettingTab(this.app, this));
  }
  onunload() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
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
  async registerThought(path) {
    if (this.layout.thoughts.includes(path)) return;
    this.layout.thoughts.push(path);
    await this.saveLayout();
  }
  activeThoughtPath() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof BrainOSGraphView && view.currentThought()) return view.currentThought();
    }
  }
  async appendCurrentNote() {
    var _a;
    const note = (_a = this.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView)) == null ? void 0 : _a.file;
    if (!note) {
      new import_obsidian3.Notice("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A Markdown \u6587\u4EF6");
      return;
    }
    const thought = this.activeThoughtPath();
    if (!thought) {
      new import_obsidian3.Notice("\u8BF7\u5148\u6253\u5F00 BrainOS \u56FE\u8C31\uFF0C\u5E76\u5728\u5DE5\u5177\u680F\u9009\u62E9\u4E00\u4E2A\u601D\u8003");
      return;
    }
    try {
      await appendRoot(this.app, thought, note.basename);
      new import_obsidian3.Notice(`\u5DF2\u628A\u300C${note.basename}\u300D\u52A0\u5165\u5F53\u524D\u601D\u8003`);
      this.refreshViews();
    } catch (error) {
      new import_obsidian3.Notice(error instanceof Error ? error.message : String(error));
    }
  }
};
var ThoughtModal = class extends import_obsidian3.Modal {
  constructor(app, plugin) {
    super(app);
    __publicField(this, "plugin");
    __publicField(this, "title", "");
    this.plugin = plugin;
  }
  onOpen() {
    this.titleEl.setText("\u521B\u5EFA BrainOS \u601D\u8003");
    new import_obsidian3.Setting(this.contentEl).setName("\u6807\u9898").setDesc("\u601D\u8003\u5C31\u662F\u4E00\u4EFD Markdown\uFF1B\u6BCF\u4E00\u884C\u6587\u5B57\u662F\u4E00\u4E2A\u8282\u70B9\u3002").addText((text) => text.setPlaceholder("\u4E00\u4E2A\u6E05\u6670\u7684\u60F3\u6CD5").onChange((value) => this.title = value));
    new import_obsidian3.Setting(this.contentEl).addButton((button) => button.setButtonText("\u521B\u5EFA").setCta().onClick(() => void this.create()));
  }
  async create() {
    const title = this.title.trim();
    if (!title) {
      new import_obsidian3.Notice("\u8BF7\u8F93\u5165\u6807\u9898");
      return;
    }
    try {
      const file = await createThought(this.app, title, this.plugin.layout.settings.thoughtFolder);
      await this.plugin.registerThought(file.path);
      this.close();
      this.plugin.refreshViews();
      await this.plugin.app.workspace.openLinkText(file.path, "", true);
    } catch (error) {
      new import_obsidian3.Notice(error instanceof Error ? error.message : String(error));
    }
  }
  onClose() {
    this.contentEl.empty();
  }
};
var BrainOSSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "BrainOS Graph" });
    new import_obsidian3.Setting(this.containerEl).setName("\u601D\u8003\u6587\u4EF6\u5B58\u653E\u4F4D\u7F6E").setDesc("\u65B0\u5EFA\u601D\u8003\u7684 .md \u653E\u5728 vault \u7684\u54EA\u4E2A\u6587\u4EF6\u5939\uFF1B\u7559\u7A7A\u8868\u793A\u8D44\u6599\u5E93\u6839\u76EE\u5F55\u3002").addText((text) => text.setPlaceholder("\uFF08\u6839\u76EE\u5F55\uFF09").setValue(this.plugin.layout.settings.thoughtFolder).onChange(async (value) => {
      this.plugin.layout.settings.thoughtFolder = value.trim();
      await this.plugin.saveLayout();
      this.plugin.refreshViews();
    }));
    new import_obsidian3.Setting(this.containerEl).setName("\u91CD\u65B0\u751F\u6210\u5E03\u5C40").setDesc("\u5220\u9664\u4FDD\u5B58\u7684\u5750\u6807\uFF0C\u4E0B\u4E00\u6B21\u6253\u5F00\u56FE\u8C31\u65F6\u81EA\u52A8\u6392\u5217\u8282\u70B9\u3002").addButton((button) => button.setButtonText("\u91CD\u7F6E").onClick(async () => {
      this.plugin.layout.positions = {};
      await this.plugin.saveLayout();
      this.plugin.refreshViews();
      new import_obsidian3.Notice("\u56FE\u8C31\u5E03\u5C40\u5DF2\u91CD\u7F6E");
    }));
  }
};
