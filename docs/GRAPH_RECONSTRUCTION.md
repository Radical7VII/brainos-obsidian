# 图谱优化记录

本次以用户提供的 Obsidian 1.14.4 静态分析为依据，改进 BrainOS Graph 插件；保留节点正文编辑、触摸操作和 Session 记录，节点持久化已改为单文件思考。

## 来源与边界

来源目录：`/Users/othnielsu/Documents/repo/obsidian-analysis`。

- `图谱系统核心剖析.md` §2–9；`搜索双链与文件读取性能剖析.md` §1–4。
- `graph/02-node-edge-rendering.js`（原格式化 `app.js:138094–138540`）、`graph/03-renderer.js`（`app.js:138541–139352`）、`graph/06-force-controls.js`（`app.js:159475–159559`）。
- `graph/layout.dcmp:18,60,151,391`：度数、中心力、预测碰撞与弹簧分配；`readable/obsidian/sim.js:400`：温度和冷却。
- REA 静态记录：`ev_aa7247efd7a6c56e92da629bc7c2b2c3a2d23d428d29c85cd23bb56e09254fe9`（完整原始 ID 以来源 `graph/rea-summary.json` 为准）。

原始 `app.js` SHA256：`958ce57fe22f87fdf121546e46dfccd9c8ee971ce3fd8f801d60d4ece39a2df9`。
`readable/obsidian/sim.js` SHA256：`a25e6c3a7a835c8f38f4886b7cdae544a37c53fe0b7dc3afca1255cb2ff57235`。
`graph/layout.dcmp` SHA256：`2a657a9017cd6019c049d389b7bab36048435237d6422415c8726b7a0c74278e`。

这些是发布包的静态观察，并非运行时测量。没有复制、执行或捆绑提取的 Obsidian 模块。

## 已实现

- 笔记双链模式从 Obsidian `resolvedLinks` / `unresolvedLinks` / 标签缓存构图；不扫描全部正文。引用次数折叠为一条有向边，双向引用仍保留两个方向。
- 原点中心力、预测位置弹簧及度数偏置、Barnes–Hut 排斥、空间桶预测碰撞、0.6 阻尼、300 步冷却；拖动固定并保持目标温度0.3。
- 非线性力学滑块：中心/连接力指数映射，排斥力立方，连接长度30–500。
- 自建 Worker 和可转移 Float32Array 坐标；版本号忽略过期拓扑和拖动消息；不可用时回退本线程，关闭视图终止 Worker。
- 旧坐标复用、新节点优先靠邻居初始化，普通索引刷新不升温。
- 节点半径按度数平方根且限制上下限，缩放按平方根补偿；标签按对数缩放淡出，悬停强制显示。
- 悬停和直接邻居高亮，其他对象渐变到0.2；双向连线只画一根线，箭头可选；视口裁剪和主题颜色。
- 搜索参与模拟拓扑，支持基础文字、`file:`、`path:`、`tag:`；有限轮局部邻域，标签不作为传播中间节点。
- 新建节点为画布内的临时圆点，直接编辑圆点下方标题；Enter确认，Tab确认并继续延伸，Esc取消。空标题不写文件；中文输入法合成期不提交。
- 一份思考文件存放多个节点标题、正文和关系，创建节点不产生独立 MD；跨思考组合通过普通块引用指向来源节点，源码见 `thought-document.ts` 和 `thought-store.ts`。
- 新思考使用普通 `<标题>.md`，默认 `未命名思考.md`；同路径冲突拒绝覆盖和自动编号。原 `.thought.md` 仍兼容读取。

## 笔记视图集成

- 使用 Obsidian 官方 `FileView` 绑定普通 `.md`，以 `ItemView.addAction` 在原生笔记标题栏加入切换图标；同一 `WorkspaceLeaf` 在 Markdown／思维视图之间切换。未注册接管 `.md` 扩展名。
- 每个 tab 暂存原生 Markdown 的模式及临时光标／滚动状态；切回同一文件恢复，切换文件时不复用旧光标。思维视图绑定文件由工作区正常序列化。
- 画布取消大工具栏，保留搜索与设置；次要操作由原生 pane 菜单承载。
- 原生命令面板中的「BrainOS Graph：新建思考」是插件注册的命令：创建默认普通 MD 后直接在新 tab 打开思维视图；重名要求命名，不覆盖已有文件。新思考无需等待 frontmatter 索引即可显示。

## 工程选择

当前仍用 Canvas2D，不是 Obsidian 的 PixiJS；布局使用原创四叉树近似，不是它的 WASM 网格金字塔。使用确定性扰动和数值保护；不保证像素或逐帧等价。

完整 Obsidian 搜索语法、颜色查询分组尚未复刻。新思考以 Markdown 段落和正常块链接为唯一内容来源，不再写 `brainos-state`。旧格式只读时做内存转换，首次写入或被引用时将原节点内容和路径保存进思考文件；原节点文件保留。块引用格式依据 [Obsidian 官方文档](https://obsidian.md/help/links)，不是反编译推断。

当前文件视图始终展示该文件内的节点及显式引用的外部节点；不会把整个外部思考递归展开。新增节点始终归属当前思考；引用来源的标题和正文保持唯一。标题相同的节点依靠块 ID 区分。引用后编辑正文会更新来源，移除外部引用只改变当前思考；删除本地节点会使其他思考中的对应引用显示失效。

## 验证

`npm run build`；`npm test`（力学、绘制公式、缓存构图、局部图、筛选和输入法快捷键）。

浏览器验证使用合成笔记和 Obsidian API 模拟层，运行插件的真实图谱视图与 Worker：观察了默认灰色节点、主题颜色、参数面板、标签开关、内联圆点标题、Tab连续延伸和Enter同级创建。另验证了原生 API 模拟层中的同 tab 切换、命令创建思考和后续节点延伸；连续创建节点后文件数保持不变，跨思考搜索复用节点后仍不新增文件；切到 Markdown 可直接看到所有节点及关系。`npm test` 共50项通过；仍未进行安装后 Obsidian 真机交互验证和大型笔记库性能基准。

构建产物输出位置：`/Users/othnielsu/Documents/OSLib/.obsidian/plugins/brainos-graph/`（`main.js`、`styles.css`、`manifest.json`）；已有 `data.json` 与插件启用配置保留。
