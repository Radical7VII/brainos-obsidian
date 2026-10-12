# BrainOS Graph for Obsidian

把 BrainOS 的思考文件工作流带进 Obsidian vault。每个思考都是一份 `.thought.md` Markdown 文件，图谱关系来自文件内的 `brainos-state`，不是从普通笔记双链猜测。图谱坐标和筛选状态保存在 Obsidian 插件数据目录，不修改 `.obsidian/`，也不使用 `.brainos/forge.sqlite`。

## 功能

- 通过 Obsidian `metadataCache` 找到 BrainOS 思考文件
- 从 `ThoughtPath` / `ThoughtStep` 生成可编辑图谱
- 双击空白或点击「新建节点」创建 Markdown 原子，并写入当前思考
- 选中节点后按 `Tab` 延伸子节点、按 `Enter` 创建同级节点、按空格编辑 Markdown
- `Alt` 从一个节点拖到另一个节点创建连线；右键节点或连线可编辑、打开、移除引用或断开
- `Delete` / `Backspace` 只移除当前思考中的节点引用，不删除原 Markdown 文件
- 双击节点打开笔记，拖动节点保存布局，拖动空白平移，滚轮缩放
- 工具栏可切换当前思考、搜索节点、刷新图谱和聚焦当前笔记
- 快速创建 `.thought.md` 思考文件，并保留可读的 frontmatter 和状态块
- 在同时打开普通笔记和思考文件时，可把当前笔记追加为思路的一步
- 文件变化后自动刷新图谱

图谱编辑会修改对应 `.thought.md` 的 `brainos-state`。如果同时存在多个思考，先在工具栏选择「当前思考」，再编辑共享节点或连线。

### 图谱操作

| 操作 | 结果 |
| --- | --- |
| 双击空白 / 新建节点 | 创建原子 Markdown；未选择思考时同时创建思考文件 |
| `Tab` | 从选中节点创建子节点并连线 |
| `Enter` | 创建同一路径中的下一节点 |
| `Alt` 拖动节点到节点 | 创建连线 |
| 空格 / 右键节点 | 编辑节点 Markdown |
| 右键连线 | 断开当前思考中的连线 |
| `Delete` / `Backspace` | 移除当前思考中的节点引用 |

## 构建

```sh
npm install
npm run build
```

将 `manifest.json`、`main.js`、`styles.css` 复制到 vault 的 `.obsidian/plugins/brainos-graph/`，在 Obsidian 设置中启用插件。
