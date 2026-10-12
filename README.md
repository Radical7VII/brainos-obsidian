# BrainOS Graph for Obsidian

把 BrainOS 的思考文件工作流带进 Obsidian vault。每个思考都是一份 `.thought.md` Markdown 文件，图谱关系来自文件内的 `brainos-state`，不是从普通笔记双链猜测。图谱坐标和筛选状态保存在 Obsidian 插件数据目录，不修改 `.obsidian/`，也不使用 `.brainos/forge.sqlite`。

## 功能

- 通过 Obsidian `metadataCache` 找到 BrainOS 思考文件
- 从 `ThoughtPath` / `ThoughtStep` 生成可拖动图谱
- 双击节点打开笔记，拖动节点保存布局，滚轮缩放
- 工具栏可搜索节点、刷新图谱和聚焦当前笔记
- 快速创建 `.thought.md` 思考文件，并保留可读的 frontmatter 和状态块
- 在同时打开普通笔记和思考文件时，可把当前笔记追加为思路的一步
- 文件变化后自动刷新图谱

## 构建

```sh
npm install
npm run build
```

将 `manifest.json`、`main.js`、`styles.css` 复制到 vault 的 `.obsidian/plugins/brainos-graph/`，在 Obsidian 设置中启用插件。
