---
description: "dsh Web 客户端的共享 Workspace 浏览器与选择器插件：分组、平铺和归档 Session 视图，以及选择、放置、目录、删除和 Workspace 流程。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workspace

[English](README.md) | 中文

## 概述

本包让用户浏览分组或扁平的 Session 列表、为新 Session 选择 Workspace，并通过添加、重命名、重排序、搜索、fork、归档和删除 Workspace 来管理 Workspace 与 Session。待处理交互显示为警告点，活动定时任务显示为闹钟标识，subagent 来源的 Session 则保持隐藏。规范化后仍有差异的文件夹路径会保留为独立 Workspace。添加 Workspace 需要组合目录选择器；没有目录选择器时，添加操作不可用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

用侧边栏浏览 Workspace 及其 Session、重排它们并新建会话；Workspace 标题行上的 ＋ 在该 Workspace 内新建 Session，“未分组”标题行上的 ＋ 复用或创建一条不属于任何 Workspace 的空白 Session。在 Session Intent 主视觉区选择 Workspace，或不选文件夹直接开始。折叠的 Workspace 默认显示五条非空白 Session，并在首条提示词落地前把当前选中的空白**新会话**作为一条临时额外行。视图菜单与通用设置可以把数量设为 5 到 20，或使用自适应尺寸。**展开其余**会显示隐藏条目；关闭再打开 Workspace 会恢复折叠投影。

手机端**工作区**打开全宽 Workspace 列表，并在存在未分组会话时显示未分组条目。选择 Workspace 后显示其 Session 列表；**返回**回到 Workspace 列表，选择 Session 则打开对话。逐层浏览使用共享的 Session 投影与排序，而不是另一份 Workspace 记账。顶部的纯图标**搜索与管理**控件打开共享管理浏览器；无障碍名称说明操作，不占用单独的文字行。

### 重排序与视图选项

视图选项把分组、平铺和归档视图与每个记账各自的一份浏览器持久化 Session 顺序放在一起。**手动排序**和**最近更新**适用于分组与平铺视图。进入最近更新时会执行一次完整的时间排序，后续 user prompt 或 steer 会将对应 Session 置顶一次；进入手动排序则保留所有当前位置并停用后续置顶。两种模式下的拖拽都会编辑当前顺序；真实 Workspace 在手动模式下的拖拽还会更新 Host Session 记账，而 Ungrouped 和单列表的顺序始终只保存在浏览器本地。嵌套位置遵循同样的划分：真实 Workspace 把它记录在 Host 记录上，而对 Ungrouped 来源的嵌套 fork 则记在浏览器持久化的视图状态里，使子 Session 在 Ungrouped 分组内显示在其来源之下。折叠分组的拖拽边界按渲染行确定，并把来源行放在中间隐藏行之前，因此拖拽不会隐藏来源行。无论采用哪种 Session 顺序，Workspace 拖拽顺序都由 Host 持久化。

### 搜索

折叠搜索是视图和添加操作旁的一枚区头按钮：激活后输入框会扩展并占据区头。非空白查询会以单一扁平结果列表替代任一浏览模式——不区分大小写的标题和 Workspace 子串匹配项会立即显示，经 250 ms 防抖的 Host 请求则会加入经过排序的当前对话内容匹配项及其摘要片段。每次新查询都会中止前一个请求；内容搜索失败时，元数据匹配项仍会显示，同时给出警告。列表最多显示 20 条结果。选择结果会清空并收起搜索、打开 Session，并在当前浏览模式中将其行滚动到可见区域；分组浏览还会按需展开所属 Workspace 和完整 Session 列表，且仅在本次访问内有效。

### 管理会话

Session 行内的 Rename 操作打开一个以显示标题预填的对话框。Fork 可以新建平级 Session，也可以把子级放到来源 Session 下；两者都在最后一个已完成 Turn 处分叉、递增继承标题并打开子级。**管理会话目录**保持主 cwd 不变，并替换供后续命令使用的规范化附加可写根目录列表。Archive 会在 Workspace 回声到达后隐藏 Session；归档视图可以恢复它，也可以在确认后永久删除其 lineage。多选支持切换与可见范围手势、键盘移动、全选、批量归档、批量删除、Workspace 成员关系变更和可选的待办创建。Workspace Delete 会移除注册记录，其 Session 留在 Ungrouped 下。

### 置顶会话

可选的 `sessionPins` seat 启用置顶后，Session 行菜单会提供**置顶**或**取消置顶**，多选右键菜单会将同一操作应用于所有选中的 Session。宽侧边栏会在工作区区块上方显示按最近更新时间排序的**置顶**区域；归档、空白、未知和 subagent-origin Session 不会显示在其中。区域标题可折叠列表（折叠状态保存在 viewing store 中，折叠时显示隐藏的行数），并带有 ⋯ 菜单，写入的是与「置顶」设置页相同的 `session-pins` 设置：**显示会话数**（**自适应**按实际行数伸缩，或 5–20 行固定高度并在区内滚动；默认 5）以及**自动置顶**开关——**进行中**、**已完成**、**出错**的 Session 会在无置顶标记的情况下与置顶会话一同列出（默认包含进行中和已完成；全部不选则只显示置顶标记）。**已完成**指已结束且尚未处理：来自列表行的提醒位，或置顶提供方持久化的已完成 id，后者在 Host 重启后仍在。提供方保留所有未读结果，以及汇总**自上次查看**窗口内的已读未处理结果（尚无查看记录时使用最近 24 小时）。确认已查看只清除未读提醒，不改变已处理状态或置顶标记；已读未处理的行仍可能满足此区域的显示条件。**标记已处理**将结果移出这组已完成会话，汇总面板的**标记已查看**则推进查看时间窗；[会话标题栏操作](../ui-digest/README.zh.md#reading-and-acknowledgement)只确认一条回复。区域列出的行在任何位置都视为已置顶：其菜单提供**取消置顶**——对有置顶标记的 Session 清除标记，对仅按状态列出的 Session 则把它从区域移除，直到其匹配的状态发生变化（进行中时移除的 Session 在完成后会回来）；**置顶**则撤销移除并写入标记。

区域的前十行各自带有打开它的按键组合的键帽：在本浏览器标签页中按下该组合，效果与点击该行完全相同，不会移除运行中、已完成或出错的自动置顶行，也不改变手动置顶标记；它只在本标签页生效，不是操作系统或浏览器全局热键。默认是数字键行，`1` 到 `9` 再到 `0`，每位一个。⋯ 菜单的**快捷键**组包含**启用快捷键**（关闭时保留绑定并隐藏键帽）和**编辑快捷键…**，后者在行上方打开内联编辑器：点击某个位置后直接按下按键或组合即可绑定（已绑定在别处的组合会移到所点位置），Backspace 清除，Esc 取消，**数字键 1–0** 与**全部清除**改写整个列表。浏览器会响应的组合（⌘1 或 Ctrl+1 切换标签页、⌘T、Ctrl+Shift+T、Alt+←、F5 等）或操作系统会消耗的组合（⌘Q、⌘Space、Win+…、Alt+F4、⌘⇧4）不会立即绑定：编辑器会说明另一方是谁，并提供**仍然绑定**或**重新录制**。编辑键（Tab、Enter、Esc、Space、Backspace、Delete）以及字母、数字、方向键、Home/End/PageUp/PageDown 和 F1–F12 以外的按键会被拒绝。不带 Ctrl、⌘ 或 Alt 的组合就是打字本身，因此在输入框、文本域或输入区聚焦时保持静默；带命令修饰键的组合在任何位置都会触发。绑定保存在本浏览器持久化的视图状态中，而不是 Host 设置里。

### 待处理交互

Session 行渲染运行时的实时 `pendingInteraction` 分类：审批显示**等待审批**，计划审阅显示**计划待审**，普通问题显示**等待回答**。每个待处理交互都使用一枚琥珀色警告点，优先级高于运行指示器。

### Session 状态呈现

拥有运行中 Turn 的 Session 会显示低透明度边框，其中一段长高光每八秒环绕一次。已完成提醒和持久化的 `sessionDigest.outcome === 'error'` 分别使用静态成功或错误边框；`aborted`、`blocked`、`max-tokens` 和 `interrupted` 不会被标记为错误。待处理交互会抑制边框；只有后代在运行时，空闲的属主 Session 仍只显示原有状态点和标签，不会显示运行边框。

通用设置提供**打开（默认）**、**关闭动画**和**完全关闭**三档。关闭动画后，按状态着色的静态边框仍然显示；完全关闭只移除边框，状态点和读屏标签仍然保留。浏览器的 `prefers-reduced-motion: reduce` 媒体查询也会停止旋转并保留静态边框。

### 活动 Schedule 标识

分组与平铺 Session 行以及搜索结果会在 `SessionSummary.projectionValues.schedule` 为非空数组时显示一枚轮廓闹钟。标识位于标题之后；普通行的更新时间仍位于标识之后，搜索结果则没有更新时间。它不是按钮，没有独立 pointer 行为或 Tab stop，点击所在区域仍会打开整行。本地化 tooltip 与同义读屏标签均为**有活动定时任务**。

对于 cold Session，该值有意采用尽力而为语义。身份匹配且可用的 projection-cache 行可以在不打开 Session 的情况下预热闹钟；cache 缺失或陈旧可能造成短暂漏显或残留。标识只表示当前列表值包含尚未 dispatch 或 delete 的 Schedule 记录，不表示 Schedule runtime 当前 live 或能够唤醒该 Session。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包填充侧边栏浏览器与 Session Intent 选择器 slot，并向通用设置贡献 Session 数量、多选与状态呈现三行。`apply` 对每个声明生命周期使用 `slots.inject()`，在目标 slot 恢复后重新注册。持久化 viewing store 拥有分组、顺序、展开状态、行数、状态边框、置顶区折叠、自动置顶移除与置顶区快捷键偏好（每位的按键组合及其开关）；独立的非持久化 store 拥有当前多选。可选的 `sessionPins` seat 提供实时置顶视图（置顶 id、持久化的已完成未处理 id、区域高度、自动置顶状态）以及置顶、高度和状态的写入回调；`apply` 将该视图镜像到浏览器 hooks，并在 provider 移除时重置，`derivePinned` 则把置顶标记与处于自动置顶状态的 Session 合并。

### 目录流子 slot

每个注册各自声明一个**目录流子 slot**（`single` kind：`conversation.hero.workspace.directoryFlow`／`sidebar.workspaces.directoryFlow`），由组合的选择器包 client half 填入其选取交互——`-native` 后端的无渲染 OS 选择器驱动，`-browse` 组合下则是应用内浏览对话框。平铺显示的**添加工作区…** 操作仅在当前界面的 slot 被占用时渲染；slot 为空意味着该组合没有目录选择能力。本包持有触发与接纳：占用方通过 slot 的属主交互约定（`open`/`busy`/`onPicked`/`onCancel`/`onError`）每次打开上报一个所选路径，owner 通过对象层接纳它，并等待 Workspace 列表投影刷新后才选中已提交的 Workspace。

### 视图状态

Workspace 列表基线就绪后，浏览器持久化的展开状态与 Session 顺序记录只保留当前 Workspace id、Ungrouped 与单列表记账。只有点击区头切换或从 Workspace 的 ＋ 新建 Session 才会写入该展开记录；没有记录的 Workspace 在持有当前 Session 时显示为展开，从置顶区、摘要或搜索打开的 Session 只在下次页面加载前展开其 Workspace，因此折叠的 Workspace 在多次加载间保持折叠。真实 Workspace 从 `WorkspaceView.sessionIds` 初始化，Ungrouped 与跨 Workspace 单列表从最近更新时间顺序初始化。共享侧边栏投影会隐藏持久化 Session 摘要中带有 `origin: 'subagent'` 的行；经不间断的 subagent 谱系可达的任一后代运行时，每个可见普通行都会保留蓝色活动状态点；只有后代在运行时不会显示属主的运行边框。同一份纯派生还会为分组、平铺、归档与搜索节点读取列表 projection value 中的 Schedule 和 `sessionDigest`；本包只使用纯类型依赖 `@deepseek-ai/dsh-schedule/client` 与 `@deepseek-ai/dsh-session-digest/types`，不会导入任一功能的运行时。

### 悬浮卡片

Workspace 与 Session 悬浮卡片会复制对应行被截断的值：激活 Workspace 卡片会写入其完整目录路径，激活非空白 Session 卡片则会写入其完整显示标题。临时的空白「新会话」卡片保持只读，因为其本地化标签是占位文案，并非会话内容。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖侧边栏宿主、主视觉区界面与选取后端。

- [ui-sidebar](../ui-sidebar/README.zh.md)——承载 `sidebar.workspaces` 子 slot 的侧边栏外壳。
- [ui-conversation](../ui-conversation/README.zh.md)——承载 Session Intent 主视觉区选择器子 slot 的聊天界面。
- [directory-picker-native](../../host/directory-picker-native/README.zh.md)——填充目录流子 slot 的 OS 选择器后端。
- [Workspace Controller](../../api/workspace-controller/README.zh.md)——负责 Workspace 与排序的 Host 变更和框架无关 Client 投影。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义搜索深度、归档行为与选取载体；它们是当前包约束。

- **没有模糊内容搜索或事件深链接**：内容后端采用字面 token/短语匹配，选择结果会打开 Session，而不是匹配的事件。
- **永久删除会覆盖整个 lineage 且不可撤销**：确认框列出 Host 将删除的每个 Session；运行中的 Agent 可以拒绝删除，直到它能够被释放。
- **待处理的用户交互不会聚合到折叠的分组上**：折叠分组内正在等待的行不会点亮分组头指示，只有展开该分组后才可见。
- **置顶快捷键绑定的是位置而非 Session**：按下组合时打开的是当时位于该位置的行；位置随最近时间排序，新进入置顶区的 Session 会把其下方的每一行下移一位。显式取消置顶或状态变化可能移除一行，使后续位置改变；仅导航不会改变置顶区成员。冲突提示覆盖所检测平台上常见的浏览器与桌面绑定，而不是机器上可能存在的每一个扩展、终端或窗口管理器绑定。
- **原生文件夹选择依赖本地 Host 载体**：在 `-native` 组合下，进程内部署或远程浏览器部署无法打开本地操作系统对话框；可远程的选取是 `-browse` 组合的应用内流程。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。Controller 约定拥有 Host mutation 失败；浏览器 viewing 与 selection store 保持 Client-local，每个 slot 注册都归 effect 所有。
