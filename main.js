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
var DEFAULT_NOTE_FOLDER = "BrainOS/Thoughts";
var STATE_BLOCK = /<!--\s*brainos-state\s*\n([\s\S]*?)\n-->/;
function stepKey(step) {
  var _a, _b, _c;
  return String((_c = (_b = (_a = step.atom) != null ? _a : step.nodeID) != null ? _b : step.node) != null ? _c : "").trim();
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
function updateThoughtState(markdown, state) {
  if (!STATE_BLOCK.test(markdown)) throw new Error("\u601D\u8003\u6587\u4EF6\u7F3A\u5C11 brainos-state\uFF0C\u65E0\u6CD5\u4FDD\u5B58\u56FE\u8C31\u4FEE\u6539");
  return markdown.replace(STATE_BLOCK, () => `<!-- brainos-state
${JSON.stringify(state, null, 2)}
-->`);
}
async function editThought(app, path, edit) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof import_obsidian.TFile)) throw new Error("\u601D\u8003\u6587\u4EF6\u5DF2\u4E0D\u5B58\u5728");
  await app.vault.process(file, (markdown) => {
    const state = parseThoughtState(markdown);
    if (!state) throw new Error("\u601D\u8003\u72B6\u6001\u7F3A\u5931\u6216\u635F\u574F\uFF0C\u8BF7\u5148\u4FEE\u590D brainos-state\uFF1B\u539F\u6587\u4EF6\u672A\u4FEE\u6539");
    edit(state);
    return updateThoughtState(markdown, state);
  });
}
function addRoute(state, keys, title) {
  var _a;
  (_a = state.paths) != null ? _a : state.paths = [];
  state.paths.push({ id: crypto.randomUUID(), title, steps: keys.map((atom) => ({ id: crypto.randomUUID(), atom })) });
}
function splitRoutes(state, removeNode, removeEdge) {
  var _a, _b;
  const paths = [];
  for (const path of (_a = state.paths) != null ? _a : []) {
    let segment = [];
    let first = true;
    const flush = () => {
      if (!segment.length) return;
      paths.push({ ...path, id: first ? path.id : crypto.randomUUID(), steps: segment });
      first = false;
      segment = [];
    };
    for (const step of (_b = path.steps) != null ? _b : []) {
      const key = stepKey(step);
      if (key === removeNode) {
        flush();
        continue;
      }
      const previous = segment[segment.length - 1];
      if (removeEdge && previous && stepKey(previous) === removeEdge.from && key === removeEdge.to) flush();
      segment.push(step);
    }
    flush();
  }
  state.paths = paths;
}
async function buildSnapshot(app) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i;
  const files = app.vault.getMarkdownFiles().filter((file) => {
    var _a2, _b2;
    return ((_b2 = (_a2 = app.metadataCache.getFileCache(file)) == null ? void 0 : _a2.frontmatter) == null ? void 0 : _b2.brainos_type) === "thought-file";
  });
  const nodes = /* @__PURE__ */ new Map();
  const edges = /* @__PURE__ */ new Map();
  const thoughts = [];
  for (const file of files) {
    const title = String((_c = (_b = (_a = app.metadataCache.getFileCache(file)) == null ? void 0 : _a.frontmatter) == null ? void 0 : _b.title) != null ? _c : file.basename.replace(/\.thought$/, ""));
    thoughts.push({ path: file.path, title });
    const state = parseThoughtState(await app.vault.cachedRead(file));
    let count = 0;
    for (const route of (_d = state == null ? void 0 : state.paths) != null ? _d : []) {
      let previous = "";
      for (const step of (_e = route.steps) != null ? _e : []) {
        const key = stepKey(step);
        if (!key) {
          previous = "";
          continue;
        }
        const resolved = app.vault.getAbstractFileByPath(key);
        const atom = resolved instanceof import_obsidian.TFile ? resolved : app.metadataCache.getFirstLinkpathDest(key, file.path);
        const node = (_h = nodes.get(key)) != null ? _h : { path: key, label: (_f = atom == null ? void 0 : atom.basename) != null ? _f : key, openPath: (_g = atom == null ? void 0 : atom.path) != null ? _g : file.path, x: 0, y: 0, degree: 0, thoughts: [] };
        if (!node.thoughts.includes(file.path)) node.thoughts.push(file.path);
        nodes.set(key, node);
        count++;
        if (previous && previous !== key) {
          const edgeKey = JSON.stringify([previous, key]);
          const edge = (_i = edges.get(edgeKey)) != null ? _i : { from: previous, to: key, thoughts: [] };
          if (!edge.thoughts.includes(file.path)) edge.thoughts.push(file.path);
          edges.set(edgeKey, edge);
        }
        previous = key;
      }
    }
    if (!count) nodes.set(`thought:${file.path}`, { path: `thought:${file.path}`, label: title, openPath: file.path, x: 0, y: 0, degree: 0, thoughts: [file.path], placeholder: true });
  }
  for (const edge of edges.values()) {
    nodes.get(edge.from).degree++;
    nodes.get(edge.to).degree++;
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], thoughts };
}
function targetFolder(folder) {
  return (0, import_obsidian.normalizePath)(folder.trim().replace(/^\/+|\/+$/g, "")) || DEFAULT_NOTE_FOLDER;
}
async function ensureFolder(app, folder) {
  const normalized = targetFolder(folder);
  let current = "";
  for (const part of normalized.split("/")) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}
async function uniquePath(app, title, folder, suffix) {
  const normalized = targetFolder(folder);
  await ensureFolder(app, normalized);
  const safe = title.replace(/[\\/:*?"<>|\r\n]/g, "-").trim().replace(/[. ]+$/g, "") || "\u672A\u547D\u540D";
  const base = (0, import_obsidian.normalizePath)(`${normalized}/${safe}${suffix}`);
  if (!app.vault.getAbstractFileByPath(base)) return base;
  for (let i = 2; ; i++) {
    const path = (0, import_obsidian.normalizePath)(`${normalized}/${safe} ${i}${suffix}`);
    if (!app.vault.getAbstractFileByPath(path)) return path;
  }
}
async function createThought(app, title, folder, source = "") {
  const path = await uniquePath(app, title, folder, ".thought.md");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const state = { paths: [], draft: "", viewport: { x: 0, y: 0, zoom: 1 } };
  return app.vault.create(path, `---
brainos_type: thought-file
version: 1
id: ${crypto.randomUUID()}
title: ${JSON.stringify(title)}
created_at: ${now}
updated_at: ${now}
status: active
${source.trim() ? `source: ${JSON.stringify(source.trim())}
` : ""}---

# ${title}

## \u601D\u8DEF

\u5C1A\u672A\u5F62\u6210\u601D\u8DEF\u3002

<!-- brainos-state
${JSON.stringify(state, null, 2)}
-->
`);
}
async function createAtom(app, title, body, folder) {
  const path = await uniquePath(app, title, folder, ".md");
  return app.vault.create(path, `# ${title}

${body.trim()}
`);
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
    this.search = toolbar.createEl("input", { type: "search", placeholder: "\u641C\u7D22\u539F\u5B50\u2026", attr: { "aria-label": "\u641C\u7D22\u539F\u5B50" } });
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
    const snapshot = await buildSnapshot(this.app);
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
  focusCurrent() {
    var _a;
    const file = (_a = this.app.workspace.getActiveViewOfType(import_obsidian2.MarkdownView)) == null ? void 0 : _a.file;
    if (!file) {
      new import_obsidian2.Notice("\u5F53\u524D\u6CA1\u6709\u6253\u5F00\u7684 Markdown \u7B14\u8BB0");
      return;
    }
    const node = this.nodes.find((item) => item.openPath === file.path);
    if (!node) {
      new import_obsidian2.Notice("\u5F53\u524D\u6587\u4EF6\u672A\u51FA\u73B0\u5728\u6240\u9009\u601D\u8003\u56FE\u8C31\u4E2D");
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
      ctx.fillStyle = accent;
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
  editingThought(node) {
    if (this.thoughtPath) return this.thoughtPath;
    if ((node == null ? void 0 : node.thoughts.length) === 1) return node.thoughts[0];
    if (this.snapshot.thoughts.length === 1) return this.snapshot.thoughts[0].path;
    if (node) new import_obsidian2.Notice("\u8282\u70B9\u5C5E\u4E8E\u591A\u4E2A\u601D\u8003\uFF0C\u8BF7\u5148\u5728\u5DE5\u5177\u680F\u9009\u62E9\u8981\u4FEE\u6539\u7684\u601D\u8003");
  }
  async createRelative(child) {
    var _a;
    const node = this.nodes.find((item) => item.path === this.selected);
    if (!node) {
      await this.beginCreate(this.screenToWorld(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2));
      return;
    }
    const thought = this.editingThought(node);
    if (!thought) return;
    if (node.placeholder) {
      await this.beginCreate({ x: node.x, y: node.y }, void 0, thought);
      return;
    }
    const parent = child ? node.path : (_a = this.edges.find((edge) => edge.to === node.path && edge.thoughts.includes(thought))) == null ? void 0 : _a.from;
    await this.beginCreate({ x: node.x + (child ? 150 : 0), y: node.y + (child ? 0 : 100) }, parent, thought);
  }
  async beginCreate(point, parent, target = this.editingThought()) {
    var _a, _b;
    if (this.busy) return;
    this.closeEditor();
    const form = this.openEditor(point, parent ? "\u5EF6\u4F38\u8282\u70B9" : "\u65B0\u5EFA\u8282\u70B9");
    form.createDiv({ cls: "brainos-node-editor-target", text: target ? `\u4FDD\u5B58\u5230\uFF1A${(_b = (_a = this.snapshot.thoughts.find((thought) => thought.path === target)) == null ? void 0 : _a.title) != null ? _b : target}` : "\u4FDD\u5B58\u65F6\u81EA\u52A8\u521B\u5EFA\u4E00\u4E2A\u65B0\u7684\u601D\u8003\u6587\u4EF6" });
    const title = form.createEl("input", { placeholder: "\u8282\u70B9\u6807\u9898", attr: { "aria-label": "\u8282\u70B9\u6807\u9898", required: "" } });
    const body = form.createEl("textarea", { placeholder: "\u7B14\u8BB0\u5185\u5BB9\uFF08Markdown\uFF0C\u53EF\u9009\uFF09", attr: { "aria-label": "\u8282\u70B9\u5185\u5BB9" } });
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
          const file = this.app.vault.getAbstractFileByPath(thought);
          if (!(file instanceof import_obsidian2.TFile) || !parseThoughtState(await this.app.vault.read(file))) throw new Error("\u601D\u8003\u72B6\u6001\u7F3A\u5931\u6216\u635F\u574F\uFF0C\u8BF7\u5148\u4FEE\u590D brainos-state");
        } else thought = (await createThought(this.app, label, this.plugin.layout.settings.noteFolder)).path;
        const atom = await createAtom(this.app, label, body.value, this.plugin.layout.settings.noteFolder);
        try {
          await editThought(this.app, thought, (state) => addRoute(state, parent ? [parent, atom.path] : [atom.path], label));
        } catch (error) {
          new import_obsidian2.Notice(`\u65B0\u7B14\u8BB0\u5DF2\u4FDD\u7559\u5728 ${atom.path}\uFF0C\u4F46\u672A\u52A0\u5165\u601D\u8003`);
          throw error;
        }
        this.plugin.layout.positions[atom.path] = point;
        await this.plugin.saveLayout();
        this.thoughtPath = thought;
        this.selected = atom.path;
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
    const file = this.app.vault.getAbstractFileByPath(node.openPath);
    if (!(file instanceof import_obsidian2.TFile)) {
      new import_obsidian2.Notice("\u8282\u70B9\u6CA1\u6709\u5BF9\u5E94\u7684 Markdown \u7B14\u8BB0");
      return;
    }
    await this.runEdit(async () => {
      const original = await this.app.vault.read(file);
      if (this.closed) return;
      this.closeEditor();
      const form = this.openEditor(node, `\u7F16\u8F91\uFF1A${node.label}`);
      const body = form.createEl("textarea", { cls: "brainos-node-editor-document", attr: { "aria-label": "\u7B14\u8BB0 Markdown" } });
      body.value = original;
      const controls = form.createDiv({ cls: "brainos-node-editor-actions" });
      const cancel = controls.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
      cancel.onclick = () => this.closeEditor();
      const save = controls.createEl("button", { text: "\u4FDD\u5B58", cls: "mod-cta", attr: { type: "submit" } });
      form.onsubmit = (event) => {
        event.preventDefault();
        if (this.busy) return;
        save.disabled = true;
        void this.runEdit(async () => {
          await this.app.vault.process(file, (current) => {
            if (current !== original) throw new Error("\u7B14\u8BB0\u5DF2\u5728\u5176\u4ED6\u4F4D\u7F6E\u4FEE\u6539\u3002\u8BF7\u53D6\u6D88\u5E76\u91CD\u65B0\u6253\u5F00\u7F16\u8F91\uFF0C\u907F\u514D\u8986\u76D6\u5185\u5BB9");
            return body.value;
          });
          this.closeEditor();
          await this.refresh();
          this.plugin.refreshViews();
        }).finally(() => {
          save.disabled = false;
        });
      };
      body.focus();
    });
  }
  openEditor(point, heading) {
    const form = this.contentEl.createEl("form", { cls: "brainos-node-editor" });
    this.editor = form;
    form.createEl("strong", { text: heading });
    const screen = this.worldToScreen(point);
    form.style.left = `${Math.max(8, Math.min(this.contentEl.clientWidth - 348, screen.x - 160))}px`;
    form.style.top = `${Math.max(60, Math.min(this.contentEl.clientHeight - 340, screen.y + 65))}px`;
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
  async connect(from, to) {
    const thought = this.editingThought(from);
    if (!thought) return;
    if (this.edges.some((edge) => edge.from === from.path && edge.to === to.path && edge.thoughts.includes(thought))) return;
    await this.runEdit(async () => {
      await editThought(this.app, thought, (state) => addRoute(state, [from.path, to.path], `${from.label} \u2192 ${to.label}`));
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
      await editThought(this.app, thought, (state) => splitRoutes(state, node.path));
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
      menu.addItem((item) => item.setTitle("\u7F16\u8F91\u7B14\u8BB0").setIcon("pencil").onClick(() => void this.beginEdit(node)));
      menu.addItem((item) => item.setTitle("\u6253\u5F00\u7B14\u8BB0").setIcon("file-text").onClick(() => void this.app.workspace.openLinkText(node.openPath, "", false)));
      menu.addItem((item) => item.setTitle("\u5EF6\u4F38\u8282\u70B9\uFF08Tab\uFF09").setIcon("git-branch").onClick(() => void this.createRelative(true)));
      menu.addItem((item) => item.setTitle("\u4ECE\u5F53\u524D\u601D\u8003\u79FB\u9664\u2026").setIcon("unlink").onClick(() => this.removeNode(node)));
    } else {
      menu.addItem((item) => item.setTitle("\u5728\u8FD9\u91CC\u65B0\u5EFA\u8282\u70B9").setIcon("plus").onClick(() => void this.beginCreate(this.screenToWorld(x, y))));
      const byPath = new Map(this.nodes.map((item) => [item.path, item]));
      const edge = this.edges.find((item) => {
        const a = byPath.get(item.from), b = byPath.get(item.to);
        if (!a || !b) return false;
        const p = this.worldToScreen(a), q = this.worldToScreen(b), dx = q.x - p.x, dy = q.y - p.y;
        const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(x - p.x - t * dx, y - p.y - t * dy) < 7;
      });
      if (edge) menu.addItem((item) => item.setTitle("\u65AD\u5F00\u6B64\u8FDE\u7EBF").setIcon("unlink").onClick(() => {
        const thought = this.thoughtPath || (edge.thoughts.length === 1 ? edge.thoughts[0] : void 0);
        if (!thought) {
          new import_obsidian2.Notice("\u8FDE\u7EBF\u5C5E\u4E8E\u591A\u4E2A\u601D\u8003\uFF0C\u8BF7\u5148\u9009\u62E9\u8981\u4FEE\u6539\u7684\u601D\u8003");
          return;
        }
        void this.runEdit(async () => {
          await editThought(this.app, thought, (state) => splitRoutes(state, void 0, edge));
          await this.refresh();
          this.plugin.refreshViews();
        });
      }));
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
    this.titleEl.setText(`\u79FB\u9664\u300C${this.label}\u300D\uFF1F`);
    this.contentEl.createEl("p", { text: "\u4EC5\u79FB\u9664\u5F53\u524D\u601D\u8003\u4E2D\u7684\u8282\u70B9\u5F15\u7528\u53CA\u76F8\u90BB\u8FDE\u7EBF\u3002\u539F Markdown \u7B14\u8BB0\u53CA\u5176\u4ED6\u601D\u8003\u4E0D\u53D8\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u8FDE\u63A5\u524D\u540E\u8282\u70B9\u3002" });
    new import_obsidian2.Setting(this.contentEl).addButton((button) => button.setButtonText("\u53D6\u6D88").onClick(() => this.close())).addButton((button) => button.setButtonText("\u79FB\u9664\u5F15\u7528").setWarning().onClick(() => {
      this.close();
      void this.remove();
    }));
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/main.ts
var DATA_VERSION = 1;
var DEFAULT_SETTINGS = { noteFolder: DEFAULT_NOTE_FOLDER };
var BrainOSPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "layout", { version: DATA_VERSION, positions: {}, settings: { ...DEFAULT_SETTINGS } });
    __publicField(this, "refreshTimer");
  }
  async onload() {
    var _a, _b;
    const saved = await this.loadData();
    this.layout = {
      version: DATA_VERSION,
      positions: (_a = saved == null ? void 0 : saved.positions) != null ? _a : {},
      settings: { ...DEFAULT_SETTINGS, ...(_b = saved == null ? void 0 : saved.settings) != null ? _b : {} }
    };
    this.registerView(VIEW_TYPE, (leaf) => new BrainOSGraphView(leaf, this));
    this.addRibbonIcon("git-branch", "\u6253\u5F00 BrainOS \u56FE\u8C31", () => this.activateView());
    this.addRibbonIcon("lightbulb", "\u521B\u5EFA\u65B0\u601D\u8003", () => new ThoughtModal(this.app, this).open());
    this.addCommand({ id: "open-graph", name: "\u6253\u5F00 BrainOS \u56FE\u8C31", callback: () => this.activateView() });
    this.addCommand({ id: "refresh-graph", name: "\u5237\u65B0 BrainOS \u56FE\u8C31", callback: () => this.refreshViews() });
    this.addCommand({ id: "focus-current-note", name: "\u5C06\u56FE\u8C31\u805A\u7126\u5230\u5F53\u524D\u7B14\u8BB0", checkCallback: (checking) => {
      var _a2;
      const view = (_a2 = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]) == null ? void 0 : _a2.view;
      if (!view || !(view instanceof BrainOSGraphView)) return false;
      if (!checking) view.focusCurrent();
      return true;
    } });
    this.addCommand({ id: "create-thought", name: "\u521B\u5EFA\u65B0\u601D\u8003", callback: () => new ThoughtModal(this.app, this).open() });
    this.addCommand({ id: "append-current-note", name: "\u5C06\u5F53\u524D\u7B14\u8BB0\u52A0\u5165\u5F53\u524D\u601D\u8003", callback: () => void this.appendCurrentNote() });
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
  async appendCurrentNote() {
    var _a;
    const note = (_a = this.app.workspace.getActiveViewOfType(import_obsidian3.MarkdownView)) == null ? void 0 : _a.file;
    const thoughtLeaf = this.app.workspace.getLeavesOfType("markdown").find((leaf) => {
      var _a2, _b;
      const file = leaf.view.file;
      return file && ((_b = (_a2 = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a2.frontmatter) == null ? void 0 : _b.brainos_type) === "thought-file";
    });
    const thought = thoughtLeaf ? thoughtLeaf.view.file : void 0;
    if (!note || !thought || note.path === thought.path) {
      new import_obsidian3.Notice("\u8BF7\u540C\u65F6\u6253\u5F00\u4E00\u4E2A\u666E\u901A\u7B14\u8BB0\u548C\u4E00\u4E2A BrainOS \u601D\u8003\u6587\u4EF6");
      return;
    }
    await editThought(this.app, thought.path, (state) => {
      var _a2, _b;
      (_a2 = state.paths) != null ? _a2 : state.paths = [];
      if (!state.paths.length) state.paths.push({ id: "path-main", title: "\u4E3B\u601D\u8DEF", steps: [] });
      const path = state.paths[0];
      (_b = path.steps) != null ? _b : path.steps = [];
      const previous = path.steps[path.steps.length - 1];
      if (previous && stepKey(previous) === note.path) throw new Error("\u5F53\u524D\u7B14\u8BB0\u5DF2\u7ECF\u662F\u601D\u8DEF\u7684\u6700\u540E\u4E00\u6B65");
      path.steps.push({ id: crypto.randomUUID(), atom: note.path });
    }).then(() => {
      new import_obsidian3.Notice(`\u5DF2\u52A0\u5165\u601D\u8003\uFF1A${thought.basename}`);
      this.refreshViews();
    }).catch((error) => new import_obsidian3.Notice(error instanceof Error ? error.message : String(error)));
  }
};
var ThoughtModal = class extends import_obsidian3.Modal {
  constructor(app, plugin) {
    super(app);
    __publicField(this, "plugin");
    __publicField(this, "title", "");
    __publicField(this, "source", "");
    this.plugin = plugin;
  }
  onOpen() {
    this.titleEl.setText("\u521B\u5EFA BrainOS \u601D\u8003");
    new import_obsidian3.Setting(this.contentEl).setName("\u6807\u9898").addText((text) => text.setPlaceholder("\u4E00\u4E2A\u6E05\u6670\u7684\u60F3\u6CD5").onChange((value) => this.title = value));
    new import_obsidian3.Setting(this.contentEl).setName("\u6765\u6E90\uFF08\u53EF\u9009\uFF09").addText((text) => text.onChange((value) => this.source = value));
    new import_obsidian3.Setting(this.contentEl).addButton((button) => button.setButtonText("\u521B\u5EFA").setCta().onClick(() => void this.create()));
  }
  async create() {
    const title = this.title.trim();
    if (!title) {
      new import_obsidian3.Notice("\u8BF7\u8F93\u5165\u6807\u9898");
      return;
    }
    try {
      const file = await createThought(this.app, title, this.plugin.layout.settings.noteFolder, this.source);
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
    new import_obsidian3.Setting(this.containerEl).setName("\u65B0\u5EFA\u7B14\u8BB0\u5B58\u653E\u4F4D\u7F6E").setDesc("\u521B\u5EFA\u65B0\u7B14\u8BB0\u65F6\u4F7F\u7528\u7684 vault \u5185\u6587\u4EF6\u5939\u8DEF\u5F84\uFF0C\u7559\u7A7A\u5219\u56DE\u9000\u5230 BrainOS/Thoughts\u3002").addText((text) => text.setPlaceholder(DEFAULT_SETTINGS.noteFolder).setValue(this.plugin.layout.settings.noteFolder).onChange(async (value) => {
      this.plugin.layout.settings.noteFolder = value.trim() || DEFAULT_SETTINGS.noteFolder;
      await this.plugin.saveLayout();
    }));
    new import_obsidian3.Setting(this.containerEl).setName("\u91CD\u65B0\u751F\u6210\u5E03\u5C40").setDesc("\u5220\u9664\u4FDD\u5B58\u7684\u5750\u6807\uFF0C\u4E0B\u4E00\u6B21\u6253\u5F00\u56FE\u8C31\u65F6\u81EA\u52A8\u6392\u5217\u8282\u70B9\u3002").addButton((button) => button.setButtonText("\u91CD\u7F6E").onClick(async () => {
      this.plugin.layout.positions = {};
      await this.plugin.saveLayout();
      this.plugin.refreshViews();
      new import_obsidian3.Notice("\u56FE\u8C31\u5E03\u5C40\u5DF2\u91CD\u7F6E");
    }));
  }
};
