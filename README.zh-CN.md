# BrainOS Graph for Obsidian

Record thought paths in plain Markdown and explore them as an editable graph.

一份普通 MD 文件对应一次思考。用列表记录一段段思考路径：同名条目复用同一个节点，但每次经过时补充的正文分别保留。图谱由文件重建，节点内容和连接不依赖另一份 JSON 数据。

## Installation

Requires Obsidian 1.7.2 or later.

1. Download `main.js`, `manifest.json`, and `styles.css` from [the latest release](https://github.com/Radical7VII/brainos-obsidian/releases/latest).
2. Create `.obsidian/plugins/brainos-graph/` inside your vault and place the three files there.
3. Reload Obsidian and enable **BrainOS Graph** in Settings → Community plugins.

The community directory listing is subject to Obsidian review. Manual installation is available in the meantime.

## Basic usage

Set a thought folder in the plugin settings to limit which Markdown files appear in the shared graph. Run **New thought / 新建思考** from the command palette or the new-tab page. Each thought is an ordinary Markdown file: top-level list items become nodes, consecutive items form directed edges, and a horizontal rule starts a separate path. Repeated titles reuse a node within that file.

Double-click empty canvas space to create a node. Select a node and press Space to edit its title, Tab to extend its path, or Command/Ctrl+Enter to insert a parent. Drag nodes to move them, drag empty space to select several, and use Backspace/Delete to remove the selection. Hover over an edge to highlight it and click to disconnect it. Command/Ctrl+Z undoes graph edits. Edit node body text in the Markdown view.

All note processing stays local. No account, telemetry, or network service is required.

## 文件格式

```md
- 一次思考对应一个 MD 文件
- 用列表记录节点
  大多数节点只有名称，需要时才补充正文。
- 同名条目复用已有节点

---

- 语音也可以形成思考记录
  先记下一个独立想法。

---

- 用列表记录节点
  回到这里，继续考虑它与 AI 对话的关系。
- AI 对话可以生成思考文件
- 语音也可以形成思考记录
  两条原本独立的思路在这里汇合。
```

- 顶格的 `- 名称` 是一次节点记录。名称在同一文件内精确匹配（忽略首尾空白），不同文件中的同名节点互相独立。
- 同一段内相邻条目依次连接；再次写出已有名称，就连接到已有节点，并从那里继续。图谱合并节点，文件保留每一次出现。
- 顶格的 `---` 开启新路径，跨段不自动连线。新段落可以从新节点或已有节点开始。普通空行只负责排版。
- 正文可省略；需要时缩进两个空格写在名称下面。正文中的列表、标题、分隔线和代码都要保持在节点内部。代码围栏和注释中的列表不会被识别为节点。
- 每次出现的正文只属于当次记录。后续补充、回访和修正可以继续追加，保留先后顺序；这里没有强制时间戳。
- 文件不要求 YAML 元数据、标题层级、粗体、块编号或固定的“节点／关系”区域。新文件为空白普通 MD；文件名就是思考名称。

阅读约定：按顺序阅读；同名条目表示同一节点再次出现；分隔线开启新路径；段内相邻节点依次连接；正文属于当次记录。把文件提供给其他 AI 时，可以附上这段说明。连线表达思路经过，不自动推断因果或支持关系。

## 使用

- Obsidian 新标签页的原生操作列表中增加“新建思考”，点击后在当前空白标签页打开新的思考。

- 在原生命令面板运行 **BrainOS Graph：新建思考**，创建 `未命名思考.md` 并在新 tab 打开思维视图。通过 Obsidian 原生 `fileManager.createNewMarkdownFile()` 创建，由 Obsidian 处理文件名与重名，不弹出插件的同名提示。此方法是 Obsidian 内部 API，未列入公开类型声明。
- 在插件设置的“思考目录”中填写笔记库内的文件夹路径，例如 `BrainOS/思考`，点击输入框会显示原生目录候选，输入文字实时筛选，也可以直接填写尚未创建的目录。新思考保存到这里，节点候选、引用选择和图谱仅读取该目录及子目录中的 Markdown；目录外的文件及引用不参与节点扫描。留空则包含整个笔记库。升级沿用原“新思考存放位置”，不移动已有文件。
- 笔记标题栏的分支图标切换到思维视图，铅笔图标切回 Markdown，并恢复先前的编辑模式、光标和滚动位置。插件不接管 MD 的默认打开方式。
- 双击画布空白创建独立想法。选中节点后按 `Tab` 继续延伸；`Enter` 从该节点最近一次记录的起点另开分支。节点右键菜单也可以“从这里另开一路”。不再从任意一条入边猜测唯一父节点。
- 选中节点后按 `Command + Enter`（Windows/Linux 为 `Ctrl + Enter`），在它和最近一次记录的父节点之间插入新节点。输入新名称后 Enter 确认，Esc 取消；原有正文和其他路径保留，没有父节点时不插入。
- 创建节点时输入文字，下方显示 Obsidian 原生候选列表。每次输入或删除文字都会实时刷新候选，中文输入法组合期间也会检索，选词结束立即刷新；选词期间不会确认候选或保存节点。候选只包含已有节点，仅按节点标题检索，文件名和路径不参与匹配。上下键选择、Enter 或鼠标确认，可复用当前文件节点或引用其他思考中的节点；来源路径仅用于区分同名节点。没有匹配候选时按 Enter 直接创建新名称；中间插入只接受新名称。
- 在圆点下输入名称：Enter 确认，Tab 确认后继续延伸，Esc 取消。中文输入法合成期和空草稿不落盘。输入已有名称复用原节点，并保留它的位置。
- 选中节点按空格、双击节点或右键选择“编辑节点”，直接在节点文字处修改标题，原名称自动全选；Enter 保存，Esc 取消，点击其他位置确认。名称同步修改本文件中的所有出现，原有正文保持不变；正文可在 Markdown 编辑视图中修改。编辑标题时也显示当前思考中的节点候选，按名称和来源路径排列；选择已有节点会合并为该节点，各次记录和正文保留。直接输入同名标题仍会提示冲突。
- 从早先节点继续，会在文件末尾另开路径并写出起点；延伸当前末尾则直接追加。`Alt` 从节点拖到另一个节点，保存相应路径。正文含代码或注释未闭合时，拒绝在其中悄悄写入新节点。
- 思维视图中按 `Command + Z` 撤销节点和连线操作，`Command + Shift + Z` 重做（Windows/Linux 使用 Ctrl）；编辑标题时保留输入框的文字撤销。一次操作涉及的节点正文与引用会一起恢复；若笔记已被外部修改则拒绝覆盖。撤销历史保留最近 50 次操作，重载插件后清空。
- 左键拖动节点移动其位置；在空白处左键拖动框选节点，按退格键或 Delete 批量删除，Command＋Z 一次恢复整批；右键拖动平移画布，右键单击仍打开菜单。框选只改变选择，不会断开经过的线。
- Mac 触控板双指滑动平移画布，双指捏合以光标位置为中心缩放；鼠标滚轮缩放、右键拖动平移保持原有操作。
- 连线使用持续流动的虚线表示起点到终点的方向，双向连接使用两条反向流动的虚线。
- 鼠标悬停在两个节点之间的连线上时，线条高亮；单击直接断开，保留两端节点及正文。拖动画布不会触发断线。
- 选中节点按退格键（Backspace）直接删除，不弹出确认窗口；编辑标题时退格键只删除文字。删除节点会删除这个名称的全部出现；断开关系会在相关位置切分路径。都不会把删除位置的前后节点自动接起来。编辑正文的并发冲突会拒绝覆盖。
- Session 保存经过顺序，包括重复节点。坐标、视野、设置和 Session 的辅助记录保存在插件数据中；文件本身仍保留完整路径。

普通 Markdown 可以直接打开思维视图。包含顶格列表的文件即可按本规则解析，无需先添加思考标记。画布汇总设置中思考目录及子目录内的全部思考节点和连线；打开某份思考会设置编辑归属，保留自由分布，不隐藏其他思考。

在 Obsidian 原生文件侧栏悬停思考文件，会临时突出它的全部节点和实际连线，其他思考淡化；移开后恢复当前思考的高亮。悬停不会改变节点写入的文件。画布打开时，普通单击侧栏文件在原画布切换当前思考；修饰键点击仍保留原生行为。新建思考复用已有画布，不生成默认节点，原有图谱保持可见。切换文件保持画布位置和缩放；思考目录内共用一份视野。

当前激活思考的节点和连线使用普通前景色（深色主题下为白色系），其他思考淡化；选中节点、悬停节点或连线、搜索匹配及侧栏悬停预览才使用主题强调色，随当前主题变化。

画布默认自由分布。选中或编辑当前思考的节点，或点击右上角阅读布局按钮时，路径柔和展开为从左往右的阅读布局，分支上下错开，汇合保留方向；回到旧节点仍显示回路，不复制节点。点击空白、按 Esc 或再次点击布局按钮可恢复自由布局，缩小到全局视野也会逐渐松开。阅读坐标独立于保存的自由坐标，切换不会覆盖自由位置。

拖动节点会退出阅读布局，让附近节点通过连接力和排斥力响应，松手后继续运动并逐渐稳定，远处尽量保持原位。新增节点只唤醒附近的力学，并优先保留阅读布局中已有分支的位置。两种图谱模式都可在设置面板调整力学。标题按实际文字范围避让圆点和其他标题，优先保留当前思考及选中节点；缩小或拥挤时让背景标题先隐藏。侧栏悬停只改变高亮，不触发布局切换或重排。

## 可选的跨文件引用

同名复用仅限当前文件。需要引用其他思考中的节点时，使用原生更多菜单、节点右键菜单或命令面板的“引用已有节点”。插件生成一个普通文件链接条目，例如：

```md
- 当前想法
- [[其他思考.md|来源节点名称]]
```

BrainOS 将链接别名解释为来源文件内的节点名称，普通 Obsidian 则打开来源文件。这个写法不会复制正文，也不要求给来源添加块编号。编辑引用节点会修改来源文件；移除引用只改变当前文件。来源失效时显示未解析节点，不生成占位文件。

插件改名会同步显式命名引用；手动修改文件中的名称时，需要自行同步其他出现和跨文件引用。正文中的普通文件链接继续作为文件引用处理。旧块引用转换后可由 BrainOS 解析，但迁移后的列表节点不再提供 Obsidian 原生块编号跳转。

## 旧格式迁移

兼容此前的 `.thought.md`、`brainos-state` 路径，以及“粗体名称 + 块编号 + 关系区域”格式。查看时只在内存转换，首次编辑时写入列表路径格式。

旧路径保留重复经过和独立起点；旧显式关系转换为独立路径，不根据旧节点的排列顺序猜测连接。旧版同名但不同身份的节点会使用 `名称（2）` 等可读名称区分，避免意外合并。原正文、说明、草稿和自定义属性保留；旧插件生成的属性和区域标记移除，原来的独立节点文件不自动删除。已有块引用会更新为命名引用。旧状态损坏或迁移期间内容变化时拒绝覆盖。

## 构建和安装

```sh
npm ci
npm run build
npm test
```

从 [GitHub Releases](https://github.com/Radical7VII/brainos-obsidian/releases) 下载 `manifest.json`、`main.js`、`styles.css` 三个附件，放入笔记库的 `.obsidian/plugins/brainos-graph/`，保留已有 `data.json` 和启用配置，重载插件。构建输出在项目根目录。

可选的笔记双链模式继续通过 Obsidian metadataCache 构图；默认共享思考画布读取目录内的列表路径。布局使用原创 Worker、Barnes–Hut 排斥及预测碰撞，详见 [图谱优化记录](docs/GRAPH_RECONSTRUCTION.md)。

当前实现包含列表存储、图谱编辑和节点标题原位编辑；正文在 Markdown 编辑视图中修改。泳道视图、过程回放、AI 对话自动生成尚未实现；`src/ai.ts` 仍是 provider 接口，不会发送内容。共享画布及原生侧栏切换、预览已在 macOS Obsidian 1.14.4 中验证。自动化测试包含真实解析／存储逻辑和 Obsidian API／DOM 模拟交互，不代表已经覆盖所有 Obsidian 版本、移动设备和第三方主题。部分原生界面集成使用内部 API，可能受 Obsidian 更新影响。

## 隐私

插件在本地处理笔记，不发送笔记内容、不收集遥测，不需要账号或联网服务。图谱布局在本地 Worker 中计算。插件会根据你的编辑操作修改笔记，建议保留笔记库备份。

## 许可与贡献

本项目采用 [Apache License 2.0](LICENSE)，允许商业使用、修改和分发，使用时需遵守许可证中的声明保留等要求。贡献者保留自己的版权；提交贡献时按相同许可证授权，详见 [贡献指南](CONTRIBUTING.md)。

插件用于验证 BrainOS 的产品想法。未来独立产品可以采用不同的发布方式；已经按 Apache-2.0 发布的代码仍按该许可证提供。

第三方部分保留各自许可，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。发行包中的 esbuild 辅助代码附有 MIT 许可声明。
