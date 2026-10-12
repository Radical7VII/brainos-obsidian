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
var import_obsidian = require("obsidian");
var VIEW_TYPE = "brainos-graph-view";
var DATA_VERSION = 1;
var DEFAULT_SETTINGS = { noteFolder: "BrainOS/Thoughts" };
var BrainOSPlugin = class extends import_obsidian.Plugin {
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
    this.addCommand({ id: "open-graph", name: "\u6253\u5F00 BrainOS \u56FE\u8C31", callback: () => this.activateView() });
    this.addCommand({ id: "refresh-graph", name: "\u5237\u65B0 BrainOS \u56FE\u8C31", callback: () => this.refreshViews() });
    this.addCommand({ id: "focus-current-note", name: "\u5C06\u56FE\u8C31\u805A\u7126\u5230\u5F53\u524D\u7B14\u8BB0", checkCallback: (checking) => {
      var _a2;
      const view = (_a2 = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]) == null ? void 0 : _a2.view;
      if (!view || !(view instanceof BrainOSGraphView)) return false;
      if (!checking) view.focusCurrent();
      return true;
    } });
    this.addCommand({ id: "create-thought", name: "\u521B\u5EFA BrainOS \u601D\u8003", callback: () => new ThoughtModal(this.app, this).open() });
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
    var _a;
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = (_a = this.app.workspace.getRightLeaf(false)) != null ? _a : this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
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
    var _a, _b, _c, _d, _e;
    const note = (_a = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView)) == null ? void 0 : _a.file;
    const thoughtLeaf = this.app.workspace.getLeavesOfType("markdown").find((leaf) => {
      var _a2, _b2;
      const file = leaf.view.file;
      return file && ((_b2 = (_a2 = this.app.metadataCache.getFileCache(file)) == null ? void 0 : _a2.frontmatter) == null ? void 0 : _b2.brainos_type) === "thought-file";
    });
    const thought = thoughtLeaf ? thoughtLeaf.view.file : void 0;
    if (!note || !thought || note.path === thought.path) {
      new import_obsidian.Notice("\u8BF7\u540C\u65F6\u6253\u5F00\u4E00\u4E2A\u666E\u901A\u7B14\u8BB0\u548C\u4E00\u4E2A BrainOS \u601D\u8003\u6587\u4EF6");
      return;
    }
    const source = await this.app.vault.read(thought);
    const state = (_b = parseThoughtState(source)) != null ? _b : { paths: [], draft: "", viewport: { x: 0, y: 0, zoom: 1 } };
    (_c = state.paths) != null ? _c : state.paths = [];
    if (!state.paths.length) state.paths.push({ id: "path-main", title: "\u4E3B\u601D\u8DEF", steps: [] });
    const path = state.paths[0];
    (_d = path.steps) != null ? _d : path.steps = [];
    const previous = path.steps[path.steps.length - 1];
    if (String((_e = previous == null ? void 0 : previous.atom) != null ? _e : "") === note.path) {
      new import_obsidian.Notice("\u5F53\u524D\u7B14\u8BB0\u5DF2\u7ECF\u662F\u601D\u8DEF\u7684\u6700\u540E\u4E00\u6B65");
      return;
    }
    path.steps.push({ id: crypto.randomUUID(), atom: note.path });
    await this.app.vault.modify(thought, updateThoughtState(source, state));
    new import_obsidian.Notice(`\u5DF2\u52A0\u5165\u601D\u8003\uFF1A${thought.basename}`);
    this.refreshViews();
  }
};
var BrainOSGraphView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    __publicField(this, "plugin");
    __publicField(this, "canvas");
    __publicField(this, "search");
    __publicField(this, "snapshot", { nodes: [], edges: [] });
    __publicField(this, "zoom", 1);
    __publicField(this, "pan", { x: 0, y: 0 });
    __publicField(this, "selected");
    __publicField(this, "drag");
    __publicField(this, "moving", false);
    this.plugin = plugin;
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
    this.contentEl.empty();
    this.contentEl.addClass("brainos-graph-view");
    const toolbar = this.contentEl.createDiv({ cls: "brainos-graph-toolbar" });
    const refresh = toolbar.createEl("button", { attr: { "aria-label": "\u5237\u65B0\u56FE\u8C31" } });
    (0, import_obsidian.setIcon)(refresh, "refresh-cw");
    refresh.onclick = () => void this.refresh();
    const focus = toolbar.createEl("button", { text: "\u805A\u7126\u5F53\u524D" });
    focus.onclick = () => this.focusCurrent();
    this.search = toolbar.createEl("input", { type: "search", placeholder: "\u641C\u7D22\u539F\u5B50\u2026", attr: { "aria-label": "\u641C\u7D22\u539F\u5B50" } });
    this.search.addEventListener("input", () => this.draw());
    this.canvas = this.contentEl.createEl("canvas", { cls: "brainos-graph-canvas" });
    this.canvas.tabIndex = 0;
    this.registerDomEvent(this.canvas, "pointerdown", (event) => this.onPointerDown(event));
    this.registerDomEvent(this.canvas, "pointermove", (event) => this.onPointerMove(event));
    this.registerDomEvent(this.canvas, "pointerup", (event) => this.onPointerUp(event));
    this.registerDomEvent(this.canvas, "pointerleave", (event) => this.onPointerUp(event));
    this.registerDomEvent(this.canvas, "wheel", (event) => this.onWheel(event));
    this.registerDomEvent(this.canvas, "dblclick", (event) => this.onDoubleClick(event));
    this.registerDomEvent(window, "resize", () => this.resize());
    this.resize();
    await this.refresh();
  }
  async refresh() {
    this.snapshot = await buildSnapshot(this.app);
    this.ensurePositions();
    this.resize();
  }
  focusCurrent() {
    var _a;
    const file = (_a = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView)) == null ? void 0 : _a.file;
    if (!file) {
      new import_obsidian.Notice("\u5F53\u524D\u6CA1\u6709\u6253\u5F00\u7684 Markdown \u7B14\u8BB0");
      return;
    }
    const node = this.snapshot.nodes.find((item) => item.openPath === file.path);
    if (!node) {
      new import_obsidian.Notice("\u5F53\u524D\u6587\u4EF6\u5C1A\u672A\u51FA\u73B0\u5728 BrainOS \u601D\u8003\u56FE\u8C31\u4E2D");
      return;
    }
    this.selected = node.path;
    this.pan = { x: -node.x, y: -node.y };
    this.draw();
  }
  ensurePositions() {
    const nodes = this.snapshot.nodes;
    const radius = Math.max(180, Math.sqrt(nodes.length) * 85);
    nodes.forEach((node, index) => {
      const saved = this.plugin.layout.positions[node.path];
      if (saved) {
        node.x = saved.x;
        node.y = saved.y;
        return;
      }
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const r = radius * Math.sqrt((index + 1) / Math.max(1, nodes.length));
      node.x = Math.cos(angle) * r;
      node.y = Math.sin(angle) * r;
      this.plugin.layout.positions[node.path] = { x: node.x, y: node.y };
    });
  }
  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.draw();
  }
  worldToScreen(node) {
    return { x: this.canvas.clientWidth / 2 + (node.x + this.pan.x) * this.zoom, y: this.canvas.clientHeight / 2 + (node.y + this.pan.y) * this.zoom };
  }
  screenToWorld(x, y) {
    return { x: (x - this.canvas.clientWidth / 2) / this.zoom - this.pan.x, y: (y - this.canvas.clientHeight / 2) / this.zoom - this.pan.y };
  }
  nodeAt(x, y) {
    return [...this.snapshot.nodes].reverse().find((node) => {
      const p = this.worldToScreen(node);
      return Math.hypot(p.x - x, p.y - y) <= Math.max(10, 13 * this.zoom);
    });
  }
  draw() {
    var _a, _b;
    if (!this.canvas) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
    const colors = getComputedStyle(this.canvas);
    const edge = colors.getPropertyValue("--text-muted") || "#888";
    const accent = colors.getPropertyValue("--interactive-accent") || "#7c3aed";
    const text = colors.getPropertyValue("--text-normal") || "#222";
    const query = (_b = (_a = this.search) == null ? void 0 : _a.value.trim().toLocaleLowerCase()) != null ? _b : "";
    const matches = new Set(this.snapshot.nodes.filter((node) => node.label.toLocaleLowerCase().includes(query) || node.path.toLocaleLowerCase().includes(query)).map((node) => node.path));
    ctx.lineWidth = 1;
    ctx.strokeStyle = edge;
    for (const link of this.snapshot.edges) {
      const a = this.snapshot.nodes.find((n) => n.path === link.from);
      const b = this.snapshot.nodes.find((n) => n.path === link.to);
      if (!a || !b) continue;
      const p = this.worldToScreen(a), q = this.worldToScreen(b);
      ctx.globalAlpha = query && (!matches.has(a.path) || !matches.has(b.path)) ? 0.18 : 0.55;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    for (const node of this.snapshot.nodes) {
      const p = this.worldToScreen(node);
      const active = node.path === this.selected || matches.has(node.path);
      const radius = Math.max(5, Math.min(12, 5 + node.degree * 0.7));
      ctx.globalAlpha = query && !matches.has(node.path) ? 0.18 : 1;
      ctx.fillStyle = node.path === this.selected ? accent : active ? accent : text;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      if (active || !query) {
        ctx.font = "12px var(--font-text)";
        ctx.textAlign = "center";
        ctx.fillStyle = text;
        ctx.fillText(node.label.slice(0, 32), p.x, p.y + radius + 15);
      }
    }
    ctx.globalAlpha = 1;
    const empty = this.contentEl.querySelector(".brainos-graph-empty");
    if (!this.snapshot.nodes.length && !empty) this.contentEl.createDiv({ cls: "brainos-graph-empty", text: "\u8FD8\u6CA1\u6709\u601D\u8003\u6587\u4EF6\u3002\u4F7F\u7528\u547D\u4EE4\u521B\u5EFA\u4E00\u4E2A\u601D\u8003\u3002" });
    if (this.snapshot.nodes.length) empty == null ? void 0 : empty.remove();
  }
  onPointerDown(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const node = this.nodeAt(x, y);
    this.canvas.setPointerCapture(event.pointerId);
    if (node) {
      const world = this.screenToWorld(x, y);
      this.drag = { path: node.path, offsetX: node.x - world.x, offsetY: node.y - world.y };
      this.selected = node.path;
    } else {
      this.moving = true;
      this.drag = void 0;
    }
    this.draw();
  }
  onPointerMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (this.drag) {
      const node = this.snapshot.nodes.find((item) => {
        var _a;
        return item.path === ((_a = this.drag) == null ? void 0 : _a.path);
      });
      if (!node) return;
      const world = this.screenToWorld(x, y);
      node.x = world.x + this.drag.offsetX;
      node.y = world.y + this.drag.offsetY;
      this.plugin.layout.positions[node.path] = { x: node.x, y: node.y };
      this.draw();
    } else if (this.moving) {
      this.pan.x += event.movementX / this.zoom;
      this.pan.y += event.movementY / this.zoom;
      this.draw();
    }
  }
  onPointerUp(event) {
    var _a, _b;
    if (this.drag || this.moving) void this.plugin.saveLayout();
    this.drag = void 0;
    this.moving = false;
    (_b = (_a = this.canvas).releasePointerCapture) == null ? void 0 : _b.call(_a, event.pointerId);
  }
  onWheel(event) {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const before = this.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    this.zoom = Math.max(0.2, Math.min(3, this.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
    const after = this.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    this.pan.x += after.x - before.x;
    this.pan.y += after.y - before.y;
    this.draw();
  }
  onDoubleClick(event) {
    const rect = this.canvas.getBoundingClientRect();
    const node = this.nodeAt(event.clientX - rect.left, event.clientY - rect.top);
    if (node) void this.app.workspace.openLinkText(node.openPath, "", false);
  }
};
async function buildSnapshot(app) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
  const files = app.vault.getMarkdownFiles().filter((file) => {
    var _a2, _b2;
    return ((_b2 = (_a2 = app.metadataCache.getFileCache(file)) == null ? void 0 : _a2.frontmatter) == null ? void 0 : _b2.brainos_type) === "thought-file";
  });
  const nodesByPath = /* @__PURE__ */ new Map();
  const edges = /* @__PURE__ */ new Map();
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const title = String((_b = (_a = cache == null ? void 0 : cache.frontmatter) == null ? void 0 : _a.title) != null ? _b : file.basename.replace(/\.thought$/, ""));
    const text = await app.vault.cachedRead(file);
    const state = parseThoughtState(text);
    const paths = (_c = state == null ? void 0 : state.paths) != null ? _c : [];
    let stepCount = 0;
    for (const thoughtPath of paths) {
      const steps = Array.isArray(thoughtPath == null ? void 0 : thoughtPath.steps) ? thoughtPath.steps : [];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const key = String((_f = (_e = (_d = step.atom) != null ? _d : step.nodeID) != null ? _e : step.node) != null ? _f : "").trim();
        if (!key) continue;
        const resolved = resolveAtom(app, key);
        const node = (_h = nodesByPath.get(key)) != null ? _h : { path: key, label: resolved.label, openPath: (_g = resolved.openPath) != null ? _g : file.path, x: 0, y: 0, degree: 0 };
        node.openPath = (_i = resolved.openPath) != null ? _i : file.path;
        node.label = resolved.label;
        nodesByPath.set(key, node);
        stepCount++;
        if (i > 0) {
          const prev = steps[i - 1];
          const previous = String((_l = (_k = (_j = prev.atom) != null ? _j : prev.nodeID) != null ? _k : prev.node) != null ? _l : "").trim();
          if (previous && previous !== key) edges.set(`${previous}\u2192${key}`, { from: previous, to: key });
        }
      }
    }
    if (!stepCount) nodesByPath.set(`thought:${file.path}`, { path: `thought:${file.path}`, label: title, openPath: file.path, x: 0, y: 0, degree: 0 });
  }
  const nodes = [...nodesByPath.values()];
  for (const edge of edges.values()) {
    const a = nodes.find((node) => node.path === edge.from);
    const b = nodes.find((node) => node.path === edge.to);
    if (a) a.degree++;
    if (b) b.degree++;
  }
  return { nodes, edges: [...edges.values()] };
}
function parseThoughtState(markdown) {
  const match = markdown.match(/<!--\s*brainos-state\s*\n([\s\S]*?)\n-->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return null;
  }
}
function updateThoughtState(markdown, state) {
  const json = JSON.stringify(state, null, 2);
  const block = `<!-- brainos-state
${json}
-->`;
  return markdown.replace(/<!--\s*brainos-state\s*\n[\s\S]*?\n-->/, block);
}
function resolveAtom(app, key) {
  const abstract = app.vault.getAbstractFileByPath(key);
  if (abstract instanceof import_obsidian.TFile) return { label: abstract.basename, openPath: abstract.path };
  const resolved = app.metadataCache.getFirstLinkpathDest(key, "");
  if (resolved) return { label: resolved.basename, openPath: resolved.path };
  return { label: key };
}
var ThoughtModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    __publicField(this, "plugin");
    __publicField(this, "title", "");
    __publicField(this, "source", "");
    this.plugin = plugin;
  }
  onOpen() {
    this.titleEl.setText("\u521B\u5EFA BrainOS \u601D\u8003");
    new import_obsidian.Setting(this.contentEl).setName("\u6807\u9898").addText((text) => text.setPlaceholder("\u4E00\u4E2A\u6E05\u6670\u7684\u60F3\u6CD5").onChange((value) => this.title = value));
    new import_obsidian.Setting(this.contentEl).setName("\u6765\u6E90\uFF08\u53EF\u9009\uFF09").addText((text) => text.onChange((value) => this.source = value));
    new import_obsidian.Setting(this.contentEl).addButton((button) => button.setButtonText("\u521B\u5EFA").setCta().onClick(() => void this.create()));
  }
  async create() {
    const title = this.title.trim();
    if (!title) {
      new import_obsidian.Notice("\u8BF7\u8F93\u5165\u6807\u9898");
      return;
    }
    const path = await uniqueThoughtPath(this.plugin.app, title, this.plugin.layout.settings.noteFolder);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const source = this.source.trim() ? `source: ${JSON.stringify(this.source.trim())}
` : "";
    const state = JSON.stringify({ paths: [], draft: "", viewport: { x: 0, y: 0, zoom: 1 } }, null, 2);
    const body = `---
brainos_type: thought-file
version: 1
id: ${crypto.randomUUID()}
title: ${JSON.stringify(title)}
created_at: ${now}
updated_at: ${now}
status: active
${source}---

# ${title}

## \u601D\u8DEF

\u5C1A\u672A\u5F62\u6210\u601D\u8DEF\u3002

<!-- brainos-state
${state}
-->
`;
    await ensureFolder(this.plugin.app, this.plugin.layout.settings.noteFolder);
    await this.plugin.app.vault.create(path, body);
    this.close();
    await this.plugin.app.workspace.openLinkText(path, "", true);
  }
  onClose() {
    this.contentEl.empty();
  }
};
async function ensureFolder(app, folder) {
  if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
}
async function uniqueThoughtPath(app, title, folder) {
  const targetFolder = (0, import_obsidian.normalizePath)(folder.trim().replace(/^\/+|\/+$/g, "")) || DEFAULT_SETTINGS.noteFolder;
  await ensureFolder(app, targetFolder);
  const safe = title.replace(/[\\/:*?"<>|]/g, "-");
  const base = (0, import_obsidian.normalizePath)(`${targetFolder}/${safe}.thought.md`);
  if (!app.vault.getAbstractFileByPath(base)) return base;
  for (let i = 2; ; i++) {
    const path = (0, import_obsidian.normalizePath)(`${targetFolder}/${safe} ${i}.thought.md`);
    if (!app.vault.getAbstractFileByPath(path)) return path;
  }
}
var BrainOSSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "BrainOS Graph" });
    new import_obsidian.Setting(this.containerEl).setName("\u7B14\u8BB0\u5B58\u653E\u4F4D\u7F6E").setDesc("\u521B\u5EFA BrainOS \u601D\u8003\u65F6\u4F7F\u7528\u7684 vault \u5185\u6587\u4EF6\u5939\u8DEF\u5F84\u3002").addText((text) => text.setPlaceholder(DEFAULT_SETTINGS.noteFolder).setValue(this.plugin.layout.settings.noteFolder).onChange(async (value) => {
      this.plugin.layout.settings.noteFolder = value.trim() || DEFAULT_SETTINGS.noteFolder;
      await this.plugin.saveLayout();
    }));
    new import_obsidian.Setting(this.containerEl).setName("\u91CD\u65B0\u751F\u6210\u5E03\u5C40").setDesc("\u5220\u9664\u4FDD\u5B58\u7684\u5750\u6807\uFF0C\u4E0B\u4E00\u6B21\u6253\u5F00\u56FE\u8C31\u65F6\u81EA\u52A8\u6392\u5217\u8282\u70B9\u3002").addButton((button) => button.setButtonText("\u91CD\u7F6E").onClick(async () => {
      this.plugin.layout.positions = {};
      await this.plugin.saveLayout();
      this.plugin.refreshViews();
      new import_obsidian.Notice("\u56FE\u8C31\u5E03\u5C40\u5DF2\u91CD\u7F6E");
    }));
  }
};
