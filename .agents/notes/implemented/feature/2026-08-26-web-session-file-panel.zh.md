# Agent Note：Web 会话文件面板与内联左右对照 diff

Status: implemented

[English](2026-08-26-web-session-file-panel.md) | 中文

## 问题

Web 客户端只在文件改动发生的地方展示它：`edit`/`write` 工具行各自一张 diff 卡片，外加收尾回合由 [ui-deliverables](../../../../packages/client/ui-deliverables) 渲染的产出文件 chips。于是要审查一个会话对工作区做了什么，就得滚完整条转录并在脑子里按文件重建过程，而长会话会把答案埋在几百步之下。当前没有任何地方显示 agent 此刻正在动哪些文件，也没有任何地方把同一个文件的多次修改收拢到一处。既有的 diff 呈现——[`DiffBlock`](../../../../packages/client/ui-primitives/src/DiffBlock.tsx)——把删除块摞在新增块之上，这对消息流里的单个小 hunk 好读，但不适合比较一个文件的前后。

## 决策

一个**会话文件面板**：会话区内部的左侧栏，列出本会话读过和改过的文件；再加上转录区里的内联左右对照 diff，由该侧栏导航过去。侧栏负责导航与状态，diff 长在转录区里——那里才有完整的列宽。

### 两个座位

这个surface需要两个渲染位，因此 [ui-conversation](../../../../packages/client/ui-conversation) 声明两个座位而非一个。单个座位服务不了两处：控件属于标签行，而面板必须参与会话的布局，从标签行 portal 出去做不到这一点。

`conversation.session.tabs.leading` 是渲染在 tablist 之前的 list 座位；标签行的 `tabs.length > 1` 渲染门放宽为「或该座位有占位」——没有占位时该行行为不变，由测试钉住。

`conversation.session.rail` 是由 `ConversationRoot` 渲染的 single 座位，位置在**会话表头与滚动容器之间**，而不是由滚动容器内部的会话体渲染。滚动容器内的面板是一个与整条转录等高的盒子的 flex item：它会被拉伸到那个高度，并随对话一起滚走。分栏包装器只在座位有占位时渲染，因此无占位的侧栏让滚动容器仍是会话列的直接子节点，转录所依赖的 `min-height: 0` 链条原封不动。

### 入口

`文件` 按钮紧贴 `对话` 标签左侧，带一个计数徽标显示本会话改了几个文件；agent 运行时徽标换成 spinner。blank 会话不显示按钮，也不显示侧栏。

### 侧栏

侧栏是会话列内部的分栏，而不是 frame 级的一列：[AppFrame](../../../../packages/client/ui-layout/src/client/AppFrame.tsx) 已经拥有一条三栏让步链，而这个面板必须从它自己的按钮正下方展开，而不是出现在窗口最右侧。宽度可拖，范围 240px 到 560px，默认 300px；关闭时整栏移除，按钮保留。开关状态存 `localStorage`：首次使用为打开，之后沿用读者最后一次的选择。

行标签截断的是**头部**而不是尾部。一个会话里的文件在末尾不同的概率远高于开头——一份文档和它的译文是 `notes.md` 与 `notes.zh.md`，一个按日期编号的系列共享整个前缀——所以尾部省略号会把不同的文件渲染成同一个字符串。截断位置由按侧栏当前宽度换算的字符预算算出，CSS 省略号保留作为兜底。

两个区域：

**已修改** 每个文件一行，最早的在上，于是最新的改动落在最下方。正在写入的那个文件带 loading icon。空闲时默认选中最后修改的文件。点击一行会把转录区滚到该文件的 diff——调用进行中滚到运行中的工具行，回合结束后滚到展开的 chip。何为「修改」沿用 [ui-deliverables](../../../../packages/client/ui-deliverables) 现有规则，不作改动：`card: 'diff'` 视图，或 `kind` 为 `edit` 的 `card: 'generic'` 视图。失败调用与删除不计入。

**已读取** 位于「已修改」下方，默认折叠为 `已读取 N 个文件` 的计数。它只接纳 `read` 工具的 `card: 'generic'` / `kind: 'read'` 位置。保留最近二十条，并在 agent 完全空闲时清空，而不是每个 `turn/end` 清空：否则一个跨多回合的任务会在读者正盯着它看 agent 在干什么的时候，把列表反复清白。

### diff 呈现

两个触发点把 diff 放进转录区，二者渲染同一个组件：

- 助手正文里的文件路径提及就地展开，沿用 [ui-deliverables](../../../../packages/client/ui-deliverables/src/client/turn-deliverables.ts) 现有的保守匹配：精确路径，或恰好只有一个产出路径拥有的 basename。`.../foo.yml` 这类缩写路径保持惰性；该规则不放宽，因为一个会打开错误文件的提及比什么都不做的提及更糟。
- 收尾回合的产出文件 chips 变为可展开，于是正文从未点名的文件也只需一次点击就能看到 diff。chips 行保留现有的「装得下就显示、装不下就计数」的六枚行为。

一个回合改动的每个文件都默认展开——写入文件的 diff 正是读者要看的东西——而「通用」设置里的*文件改动的对比*一行为想要更少的读者提供**仅单个文件时展开**与**全部收起**。该偏好经 `settingsScope` 持久化，且是响应式的，因此改动会抵达已经在屏幕上的转录；在单个文件上它被读者自己的开合覆盖。读取不在这个词汇表里：一个只被读过的文件没有可展开的对比。

diff 本身横跨转录区全宽，分两栏，左为修改前、右为修改后，高度随内容。每个 hunk 的两侧逐行配对并以空行补齐，使对应行齐平——这是摞放式 `DiffBlock` 既不需要也不做的事。行不换行；两栏横向同步滚动，因为各自独立滚动会立刻破坏配对本身要建立的对齐关系。

### diff 口径

面板展示的是**本会话对该文件的累积改动**，由 session log 里已有的上下文 hunks 按发生顺序拼成。每一段标注其轮次与工具（`第 3 轮 · Edit`），因为没有来源标注的累积视图分不清「一次调用改了两处」与「两次调用各改一处」。

两个宿主侧事实锁定了这个口径。整文件 `before`/`after` 只存在于宿主进程内部：[`createSuccessResult`](../../../../packages/core/tools/src/index.ts) 把结构化值喂给 `render` 与 `presentationMeta` 之后即丢弃，而 [`ToolResult`](../../../../packages/core/tools/src/index.ts) 只携带 `content`、`isError` 和 `meta`——浏览器侧的 [`ToolResultBlock`](../../../../packages/llm/llm/src/types.ts) 更窄。同时 [`computeHunkDiffs`](../../../../packages/fs/tool-fs/src/diff.ts) 丢弃了 `structuredPatch` 的行号，于是 hunks 不带任何可用来按文件位置排序、或在重叠处合并的锚点。带来源标注的时序排列，才是已记录数据支持得起的东西。

### 已上线的内容，分两刀

第一刀是两个座位、侧栏、推导、`SideBySideDiff` 与转录区的内联 diff，只覆盖当前会话。

推导以 `chatFileDiffs` 抵达转录区：一个由 ui-conversation 声明、由本包提供、由 ui-deliverables 经 `ctx.get` 消费的可选 service——它是同样这三个包之间已经反向存在的 `chatFileMentions` face 的镜像。当该 service 报告某个产出文件 chip 有已记录的改动时，点击它展开 diff；没有时它保持原有的打开行为，于是这个surface退化为今天的行为，而不是产生一次落空的点击。

侧栏选中时的行为是第一刀唯一未达设计之处：它滚动到最后一个以 `data-file` 携带该路径的工具行，而不是那个展开的 chip。从回合外部驱动 turn-tail 的展开需要一条两个包都没有的通道，而工具行本来就渲染着该文件的这次改动。

第二刀把面板扩展到**会话族改动**——本会话与其全部后代子代理会话改动的并集。子代理的工作对本地推导按设计不可见：子会话在自己的会话里工作，父会话日志只记录委派工具的调用与结果（[tool-subagent](../../../../packages/subagent/tool-subagent/README.zh.md)）。该扩展读取 [`subagent.list`](../../../../packages/host/apiproxy/src/api/subagents.ts) 与 `subagent.history`（两者对活跃与冷子会话同样可用，且携带 render intents），沿 `hasChildren` 递归至整棵树，且同一文件仍只占一行，每段按来源标注（`reviewer · 第 3 轮 · edit`）。

历史深度只有一个开关。打开面板时加载当前会话最近一页，以及第一层各个已完成子会话的最近一页。`加载全部` 控件加载当前会话的完整历史并递归整棵子代理树。

实时状态不是逐子会话的订阅：`events.mux` 是 runtime 独占的单条聚合流、拒绝第二个消费者，而值得响应的信号是子代理的**最后**一步而非每一步——因此当目录镜像里运行中的子代理数下降时，侧栏重读整棵树。

## 影响范围

| 变更 | 位置 |
|---|---|
| 新客户端插件：侧栏、按钮、推导、词典、invariant companion | `packages/client/ui-session-files/` |
| 两个 slot、放宽的标签行渲染门、滚动容器之上的侧栏分栏 | [ui-conversation](../../../../packages/client/ui-conversation) |
| 逐行配对、横向同步滚动的双栏 diff | [ui-primitives](../../../../packages/client/ui-primitives) |
| 工具行上的 `data-file`，即侧栏的滚动目标 | [ToolRow](../../../../packages/client/ui-tool/src/client/tool/components/ToolRow.tsx) |
| `chatFileDiffs` 可选 service | [conversation slot 契约](../../../../packages/client/ui-conversation/src/client/contract/slots.ts) |
| 产出文件 chips 展开其 diff | [ProducedFiles](../../../../packages/client/ui-deliverables/src/client/ProducedFiles.tsx) |
| 浏览器插件清单条目 | [web-app bundle patch](../../../../packages/bundle/web-app/cordis.patch.yml) |
| 重新生成的 slot catalog 与 config catalog | [cordis-client-runner](../../../../packages/extensions/cordis-client-runner/src/client/slot-catalog.ts)、[config catalog](../../../../docs/config-catalog.zh.md) |

## 验证

按钮渲染在「对话」标签左侧，且在 `tabs.leading` 无占位时，标签行行为与该座位存在之前逐字一致。侧栏首次使用默认打开，尊重已持久化的关闭选择，并可在边界内拖动。「已修改」按最早在上列出每个被改文件，运行中的文件带 spinner，写明每个文件新增与删除的行数，并在点击某行时把转录区滚到该文件的 diff。「已读取」保持折叠在计数之后，只接纳 `read` 位置，上限二十条，跨回合边界存活并在完全空闲时清空。单文件回合的 diff 默认展开，多文件回合全部收起。双栏 diff 逐行齐平并两栏同步滚动，每段标注其轮次与工具。历史分页的会话会声明更早的改动尚未加载，并提供 `加载全部`。

## 暂缓

委派行就地展开尚未落地：仅后代改过的文件会出现在侧栏、其段也在合并模型里，但在转录区无处可画——内联呈现挂在某个回合的产出文件 chips 上，而这样的文件从不出现在其中。

本 Note 最初记录的那处阻塞已经消失。把子会话的 diff 放在生成它的那次调用之下，需要一条「委派调用 → 子会话」的映射；`SessionSummary` 与 `SubagentListEntry` 仍然只带 `parentSessionId`，不带生成它的调用或轮次——但委派工具现在声明了携带 `childSessionId` 的 `presentationMeta`，因此对该改动之后录制的每个会话，父会话日志都能标识出子会话。目前还没有客户端读取它：侧栏仍经 `subagent.list` 触达后代。该改动之前录制的会话则不带这条信息，这在预期之中。

## 考虑过的替代方案

**用会话首次 `before` 到末次 `after` 的整文件 diff。** 表面上是更好的口径，因证据被否：整文件文本从不离开宿主进程，客户端算不出来，且没有任何既有会话包含这份数据。要携带它就得放宽 `presentationMeta`，在每次改动时持久化两份完整文件正文——一个 200KB 的文件改三十次会往日志里写进十二兆，而这份日志要被重放、被 ZIP 导出、被分页 RPC 拉取——并且对变更之前录制的会话仍然什么都显示不出来。

**与 git `HEAD` 对比。** 否决：它回答的是另一个问题。`HEAD` 包含其它会话以及读者自己手改的内容，而本面板的主语是**这个**会话做了什么。

**复用 `details` 右栏。** 该栏已经具备拖拽、让步链、关闭不卸载。否决原因：它是 `kind: 'single'` 槽且已被工具详情检查器占用，共享它意味着把那个占用者改写成多视图容器；而且左上角的按钮在最右侧弹出面板，读起来像 bug。

**给 AppFrame 加第四栏。** 正统做法，因成本被否：[`computeColumns`](../../../../packages/client/ui-layout/src/client/columns.ts) 是一个纯三栏让步求解器，加一条轨道意味着重新推导整条让步链及其测试，而这个面板并不需要 frame 级的宽度仲裁。

**在「对话」和「轨迹」旁做第三个视图标签。** 否决：`conversation.view` 一次只渲染一个视图，而本面板的价值在于**一边**读对话**一边**看文件变化。

**把 diff 渲染在侧栏内部。** 否决：240–560px 宽度下两栏代码无法阅读，侧栏因此需要同一内容的第二套摞放式渲染——一件事两个渲染点，必然长歪。

**把按钮放进 `conversation.session.header.actions` 或 `.utilities`。** 二者都能避免改动 ui-conversation 的骨架。否决：入口位置是这个特性唯一写死的视觉要求，而这两个槽都不在「对话」标签左侧。

**用 diff 块替换产出文件 chips 行，或在其下追加 diff 块。** 否决：chips 行本来就是带装配计数省略的完整逐回合文件清单，把它改成可展开即可加上 diff，既不需要第二份清单，也不会让回复末尾拖出几十屏。

**两栏不对齐，或保留摞放式 `DiffBlock`。** 两侧长度一旦不同（这是常态）不对齐就立刻难读；保留摞放则等于放弃本 Note 要加的左右对照。

**把侧栏渲染在会话体内部、活动视图旁边。** 最先尝试的位置，是错的：会话体位于滚动容器内部，于是侧栏成了一个高 11,509px 的盒子的 flex item，随转录一起滚出顶部。侧栏属于那个盒子之上，在表头与滚动容器之间。

**用 `direction: rtl` 截断行标签。** 把省略号移到前面的一行式 CSS 写法，因实测被否：rtl 段落会重排开头的数字段，于是 `2026-08-25-notes.md` 渲染成 `notes.md-2026-08-25`。加前置 LRM 也没能恢复顺序。按侧栏宽度换算的字符预算在 CSS 精确的地方只是近似，但它不会算错。

**把 `grep`/`glob` 命中纳入「已读取」。** 否决：搜索产出的是命中列表，不是 agent 打开过的文件，而一次 grep 能匹配上百条路径，会让 `已读取 N 个文件` 这个计数失去意义。

**在每个 `turn/end` 清空「已读取」。** 否决：跨多回合的任务会在这份清单正要展示的那段活动期间被反复清白。

**急切加载整棵子代理树，同时让父会话历史保持分页。** 作为一种静默失败的不对称被否决：子代理的旧改动会出现，而父会话自身更早的改动仍被隐藏，读者也没有任何信号知道缺了东西。完整性由同一个开关统一管辖。

## 后果

标签行渲染门与侧栏分栏是两处具备回归波及面的改动：二者都位于一个已发布包的骨架里，每个会话都要经它们渲染。两者都让无占位时的树与今天完全一致，并由测试钉住。

标签预算是估算字形宽度而非测量，因此一个异常宽的名字仍可能触到 CSS 省略号并丢掉尾部。该估算刻意取偏保守，以使这种情况罕见。

内联 diff 没有高度上限：按规定它的高度随改动而定，因此一次整文件创建会渲染每一行，而单文件回合在出现时就展开它。`DiffBlock` 把工具行封在十六行加一个展开控件之后；若实际使用中回复末尾被证明过长，那个上限就是可照搬的先例。

加载完整子代理树在树的宽度上是无界的：一个派出许多并发子代理的任务会打开许多条分页拉取链。`加载全部` 门限住了它们。

跨长会话聚合会在每次快照更新时重算，因此该推导必须对会话快照做记忆化，而不能每次渲染都跑一遍。
