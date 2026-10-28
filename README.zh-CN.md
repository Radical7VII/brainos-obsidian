# BrainOS Graph for Obsidian

Record thought paths in plain Markdown and explore them as an editable graph.

一份普通 MD 文件对应一次思考。用列表记录节点、用 `→` 显式记录连接：同名条目复用同一个节点，但每次经过时补充的正文分别保留。图谱由文件重建，节点内容和连接不依赖另一份 JSON 数据。

## 实机截图与操作演示

以下内容实拍于 macOS 的 Obsidian 1.14.4，插件版本为 BrainOS Graph 0.2.6，使用默认浅色主题和独立演示库。

![Obsidian 中的 BrainOS 图谱：两条思考路径从同一个问题出发，汇合到用户反馈](docs/assets/brainos-graph.png)

### 原位改名与节点复用

选中节点后按 **空格**，直接修改标题；按 **Tab** 延伸思路，输入文字后从候选中选择已有节点。演示结束时仍为四个节点，没有生成重复的“收集用户反馈”。

![实机操作：空格编辑节点标题、Tab 延伸、输入时出现候选并复用已有节点](docs/assets/brainos-workflow.gif)

GIF 来自约 30 帧/秒的演示窗口连续实机录制，裁切后按原速播放。

### 输入时显示节点候选

候选只检索设置的思考目录中的节点，来源文件用于区分同名内容。

![真实插件中的节点候选列表](docs/assets/brainos-node-suggestions.png)

## Installation

Requires Obsidian 1.7.2 or later.

1. Download `main.js`, `manifest.json`, and `styles.css` from [the latest release](https://github.com/Radical7VII/brainos-obsidian/releases/latest).
2. Create `.obsidian/plugins/brainos-graph/` inside your vault and place the three files there.
3. Reload Obsidian and enable **BrainOS Graph** in Settings → Community plugins.

插件已发布到 [Obsidian 社区目录](https://community.obsidian.md/plugins/brainos-graph)。如果客户端的插件列表尚未同步，可以先按上述步骤手动安装。

## Basic usage

Set a thought folder in the plugin settings to limit which Markdown files appear in the shared graph. Run **New thought / 新建思考** from the command palette or the new-tab page. Each thought is an ordinary Markdown file: top-level list items become nodes, and indented arrows explicitly connect them. Adjacent entries do not connect automatically. Repeated titles reuse a node within that file.

Double-click empty canvas space to create a node. Select a node and press Space to edit its title, Tab to extend its path, or Command/Ctrl+Enter to insert a parent. Drag nodes to move them, drag empty space to select several, and use Backspace/Delete to remove the selection. Hover over an edge to highlight it and click to disconnect it. Command/Ctrl+Z undoes graph edits. Edit node body text in the Markdown view.

All note processing stays local. No account, telemetry, or network service is required.

## 思路视图与快捷键

打开一份思考默认进入 Git 式轨道视图。左侧固定轨道表达分支和汇合，右侧标题对齐；点击节点原位展开正文，节点上下留白为 17px。每个节点在图中只显示一行，多次记录的连接合并为连续分支；展开后保留各次非空正文。回路使用返回链接，不画跨页长线。

顶部可切换「思路 / 全局图 / Raw」。全局图保留自由画布；Raw 使用 Obsidian 原生源码编辑器，并定位到所选记录。返回思路视图时恢复选中的记录和滚动位置。

焦点在节点标题上时：

- `Tab` 延伸当前节点，直接在轨道中输入新名称。
- `Enter` 从当前记录的来路另开同级分支；没有来路时新建独立节点。
- `Space` / `F2` 原位修改标题，保留正文。正文通过 Raw 编辑；继续、分支、删除等操作也可通过节点右键菜单使用。
- `↑/↓` 按屏幕中的记录顺序选择上一条、下一条，到首尾停止。分支线仅表达关系，没有左右导航；移动选择不会进入标题编辑。
- `⌘/Ctrl Z` 撤销，`⌘/Ctrl Shift Z` 重做。

名称输入期间，`Enter` 确认，`Tab` 确认并继续延伸，`Esc` 取消；草稿不落盘，中文输入法选词不会提前提交。不弹出新建或编辑 Modal。

## 文件格式

```md
- 参考 Git 历史图
  把连接收在左侧轨道，让右侧文字对齐。
  → 保留自由画布
  → 按行展示思路

- 保留自由画布
  适合探索整体关联。
  → 合并两种方案

- 按行展示思路
  适合连续阅读，也方便展开正文。
  → 合并两种方案

- 合并两种方案
  日常用思路视图，探索关联时切换全局图。
```

- 顶格 `- 名称` 是一次节点记录，同一文件内同名条目复用节点，每次的正文分别保留。
- 缩进两个空格的 `→ 名称` 明确指定去向，多个去向写多行。也接受 `  - to: 名称`。
- 相邻条目不再自动连线。空行只负责排版，不再使用顶格 `---` 切断路径。
- 没有箭头表示这条记录没有指定后续节点。去向尚未定义时，在图中保留未解析节点，不生成文件。
- 正文缩进两个空格；代码围栏、注释和更深层列表中的箭头不视为关系。以 `\→` 开头可写出普通箭头正文。
- 跨文件连接写为 `  → [[其他思考.md|来源节点名称]]`，不复制来源正文。
- 再次写出同名条目，可以补充新的正文并继续连接。连接表达思路经过，不自动推断因果或支持关系。

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
- 鼠标滚轮默认以光标位置为中心缩放，右键拖动平移画布。Mac 触控板默认双指捏合缩放、双指滑动平移，无需设置。
- 连线使用持续流动的虚线表示起点到终点的方向，双向连接使用两条反向流动的虚线。
- 鼠标悬停在两个节点之间的连线上时，线条高亮；单击直接断开，保留两端节点及正文。拖动画布不会触发断线。
- 选中节点按退格键（Backspace）直接删除，不弹出确认窗口；编辑标题时退格键只删除文字。删除节点会删除这个名称的全部出现；断开关系会在相关位置切分路径。都不会把删除位置的前后节点自动接起来。编辑正文的并发冲突会拒绝覆盖。
- Session 保存经过顺序，包括重复节点。坐标、视野、设置和 Session 的辅助记录保存在插件数据中；文件本身仍保留完整路径。

普通 Markdown 可以直接打开思维视图。包含顶格列表的文件即可按本规则解析，无需先添加思考标记。画布汇总设置中思考目录及子目录内的全部思考节点和连线；打开某份思考会设置编辑归属，保留自由分布，不隐藏其他思考。

在 Obsidian 原生文件侧栏悬停思考文件，会临时突出它的全部节点和实际连线，其他思考淡化；移开后恢复当前思考的高亮。悬停不会改变节点写入的文件。画布打开时，普通单击侧栏文件在原画布切换当前思考；修饰键点击仍保留原生行为。新建思考复用已有画布，不生成默认节点，原有图谱保持可见。切换文件保持画布位置和缩放；思考目录内共用一份视野。

当前激活思考的节点和连线使用普通前景色（深色主题下为白色系），其他思考淡化；选中节点、悬停节点或连线、搜索匹配及侧栏悬停预览才使用主题强调色，随当前主题变化。

全局图默认自由分布。选中或编辑当前思考的节点，或点击右上角阅读布局按钮时，路径柔和展开为从左往右的阅读布局，分支上下错开，汇合保留方向；回到旧节点仍显示回路，不复制节点。点击空白、按 Esc 或再次点击布局按钮可恢复自由布局，缩小到全局视野也会逐渐松开。阅读坐标独立于保存的自由坐标，切换不会覆盖自由位置。

拖动节点会退出阅读布局，让附近节点通过连接力和排斥力响应，松手后继续运动并逐渐稳定，远处尽量保持原位。新增节点只唤醒附近的力学，并优先保留阅读布局中已有分支的位置。两种图谱模式都可在设置面板调整力学。标题按实际文字范围避让圆点和其他标题，优先保留当前思考及选中节点；缩小或拥挤时让背景标题先隐藏。侧栏悬停只改变高亮，不触发布局切换或重排。

## 可选的跨文件引用

同名复用仅限当前文件。需要引用其他思考中的节点时，使用原生更多菜单、节点右键菜单或命令面板的“引用已有节点”。插件生成一个普通文件链接条目，例如：

```md
- 当前想法
- [[其他思考.md|来源节点名称]]
```

BrainOS 将链接别名解释为来源文件内的节点名称，普通 Obsidian 则打开来源文件。这个写法不会复制正文，也不要求给来源添加块编号。编辑引用节点会修改来源文件；移除引用只改变当前文件。来源失效时显示未解析节点，不生成占位文件。

插件改名会同步显式命名引用；手动修改文件中的名称时，需要自行同步其他出现和跨文件引用。正文中的普通文件链接继续作为文件引用处理。旧块引用转换后可由 BrainOS 解析，但迁移后的列表节点不再提供 Obsidian 原生块编号跳转。

## 一次性转换旧列表路径

插件启动、进入笔记库和刷新都不会扫描或转换旧格式。旧的相邻连接与 `---` 路径必须在切换版本前一次性转换。转换工具只处理显式传入的文件，先校验节点记录、正文和连接一致，再备份并写入。

```sh
# 只检查，不写入
node scripts/convert-thought-paths.mjs /absolute/path/思考.md

# 保留原文件备份后执行一次性转换
node scripts/convert-thought-paths.mjs --write --backup-dir /absolute/path/backup /absolute/path/思考.md
```

转换只移除顶格的路径分隔线，保留 YAML、正文分隔线、代码、重复记录和独立起点。已经有箭头关系的文件会拒绝重复转换。无需在每次打开仓库时运行。更早的段落／状态块格式仍沿用既有迁移工具，与本次列表路径转换分开处理。

## 构建和安装

```sh
npm ci
npm run lint
npm run build
npm test
```

从 [GitHub Releases](https://github.com/Radical7VII/brainos-obsidian/releases) 下载 `manifest.json`、`main.js`、`styles.css` 三个附件，放入笔记库的 `.obsidian/plugins/brainos-graph/`，保留已有 `data.json` 和启用配置，重载插件。构建输出在项目根目录。

可选的笔记双链模式继续通过 Obsidian metadataCache 构图；默认共享思考画布读取目录内的列表路径。布局使用原创 Worker、Barnes–Hut 排斥及预测碰撞，详见 [图谱优化记录](docs/GRAPH_RECONSTRUCTION.md)。

当前实现包含列表存储、图谱编辑和节点标题原位编辑；正文在 Markdown 编辑视图中修改。Git 式思路轨道视图已实现；过程回放、AI 对话自动生成尚未实现；`src/ai.ts` 仍是 provider 接口，不会发送内容。共享画布及原生侧栏切换、预览已在 macOS Obsidian 1.14.4 中验证。自动化测试包含真实解析／存储逻辑和 Obsidian API／DOM 模拟交互，不代表已经覆盖所有 Obsidian 版本、移动设备和第三方主题。部分原生界面集成使用内部 API，可能受 Obsidian 更新影响。

## 隐私

插件在本地处理笔记，不发送笔记内容、不收集遥测，不需要账号或联网服务。图谱布局在本地 Worker 中计算。插件会根据你的编辑操作修改笔记，建议保留笔记库备份。

## 许可与贡献

本项目采用 [Apache License 2.0](LICENSE)，允许商业使用、修改和分发，使用时需遵守许可证中的声明保留等要求。贡献者保留自己的版权；提交贡献时按相同许可证授权，详见 [贡献指南](CONTRIBUTING.md)。

插件用于验证 BrainOS 的产品想法。未来独立产品可以采用不同的发布方式；已经按 Apache-2.0 发布的代码仍按该许可证提供。

第三方部分保留各自许可，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。发行包中的 esbuild 辅助代码附有 MIT 许可声明。
