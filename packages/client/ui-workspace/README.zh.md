---
description: "dsh Web 客户端的共享 Workspace 浏览器与选择器插件：分组、平铺和归档 Session 视图，以及选择、放置、目录、删除和 Workspace 流程。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workspace

[English](README.md) | 中文

## 概述

`dsh-client-ui-workspace` 是 dsh Web 客户端的共享 Workspace 浏览器与选择器。用户可以浏览分组、平铺或已归档的 Session 行；启动由 Workspace 支持的 Session 或未分组 scratch Session；并管理 Session 放置、选择、目录、归档状态与永久删除。待处理的用户交互以琥珀色警告点呈现；运行中、已完成和运行出错的 Session 可以显示弱化的状态边框；活动 Schedule projection 以不可交互的闹钟呈现；嵌套 fork 显示在所选父 Session 下；共享侧边栏投影还会隐藏 subagent 来源的 Session。不同的规范化路径仍作为由 id 区分的独立 Workspace；目录选择经组合的选择器 package 填充的子 slot 完成。

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

折叠搜索是视图和添加操作旁的一枚区头按钮：激活后输入框会扩展并占据区头。非空白查询会以单一扁平结果列表替代任一浏览模式——不区分大小写的标题和 Workspace 子串匹配项会立即显示，经 250 ms 防抖的 Host 请求则会加入经过排序的当前对话内容匹配项及其摘要片段。每次新查询都会中止前一个请求；内容搜索失败时，元数据匹配项仍会显示，同时给出警告。列表最多显示 20 条结果。选择结果会清空并收起搜索、打开 Session，并在当前浏览模式中将其行滚动到可见区域；分组浏览还会按需展开所属 Workspace 和完整 Session 列表。

### 管理会话

Session 行内的 Rename 操作打开一个以显示标题预填的对话框。Fork 可以新建平级 Session，也可以把子级放到来源 Session 下；两者都在最后一个已完成 Turn 处分叉、递增继承标题并打开子级。**管理会话目录**保持主 cwd 不变，并替换供后续命令使用的规范化附加可写根目录列表。Archive 会在 Workspace 回声到达后隐藏 Session；归档视图可以恢复它，也可以在确认后永久删除其 lineage。多选支持切换与可见范围手势、键盘移动、全选、批量归档、批量删除、Workspace 成员关系变更和可选的待办创建。Workspace Delete 会移除注册记录，其 Session 留在 Ungrouped 下。

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

本包填充侧边栏浏览器与 Session Intent 选择器 slot，并向通用设置贡献 Session 数量、多选与状态呈现三行。`apply` 对每个声明生命周期使用 `slots.inject()`，在目标 slot 恢复后重新注册。持久化 viewing store 拥有分组、顺序、展开状态、行数与状态边框偏好；独立的非持久化 store 拥有当前多选。

### 目录流子 slot

每个注册各自声明一个**目录流子 slot**（`single` kind：`conversation.hero.workspace.directoryFlow`／`sidebar.workspaces.directoryFlow`），由组合的选择器包 client half 填入其选取交互——`-native` 后端的无渲染 OS 选择器驱动，`-browse` 组合下则是应用内浏览对话框。平铺显示的**添加工作区…** 操作仅在当前界面的 slot 被占用时渲染；slot 为空意味着该组合没有目录选择能力。本包持有触发与接纳：占用方通过 slot 的属主交互约定（`open`/`busy`/`onPicked`/`onCancel`/`onError`）每次打开上报一个所选路径，owner 通过对象层接纳它，并等待 Workspace 列表投影刷新后才选中已提交的 Workspace。

### 视图状态

Workspace 列表基线就绪后，浏览器持久化的展开状态与 Session 顺序记录只保留当前 Workspace id、Ungrouped 与单列表记账。真实 Workspace 从 `WorkspaceView.sessionIds` 初始化，Ungrouped 与跨 Workspace 单列表从最近更新时间顺序初始化。共享侧边栏投影会隐藏持久化 Session 摘要中带有 `origin: 'subagent'` 的行；经不间断的 subagent 谱系可达的任一后代运行时，每个可见普通行都会保留蓝色活动状态点；只有后代在运行时不会显示属主的运行边框。同一份纯派生还会为分组、平铺、归档与搜索节点读取列表 projection value 中的 Schedule 和 `sessionDigest`；本包只使用纯类型依赖 `@deepseek-ai/dsh-schedule/client` 与 `@deepseek-ai/dsh-session-digest/types`，不会导入任一功能的运行时。

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
- **原生文件夹选择依赖本地 Host 载体**：在 `-native` 组合下，进程内部署或远程浏览器部署无法打开本地操作系统对话框；可远程的选取是 `-browse` 组合的应用内流程。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。Controller 约定拥有 Host mutation 失败；浏览器 viewing 与 selection store 保持 Client-local，每个 slot 注册都归 effect 所有。
