# Agent Note: Web 任务执行流程图

Status: implemented

[English](2026-09-06-web-task-flow-graph.md) | 中文

## Problem

Web GUI 中的长任务只能以滚动的对话记录呈现。用户离开页面再回来时，必须翻页才能找到 agent 规划了什么、哪些委派子代理并行运行、中途插入的提问在哪里，以及运行是完成了还是被停止了。参考设计是一张从左到右的流程图：任务在左，规划步骤与并行角色在中间，带停止控件和放大动作。三个约束决定了设计：图必须不翻历史页即可找到；它必须是会话日志的纯投影，使回放与实时追加一致；手动停止必须在图上体现而不新增 hook 或会话事件。

## Decision

[`@deepseek-ai/dsh-client-ui-task-flow`](../../../../packages/client/ui-task-flow/README.zh.md) 用同一份快照绘制两处：注册到 `conversation.input.dock` 的常驻流程条（始终显示在输入框上方，可按 Session 折叠），以及注册到 `conversation.view`、带平移缩放画布的「流程」tab。三种绘制（`cards`、`rail`、`lanes`）可分别为流程条与画布独立选择；流程条默认 `rail`，画布默认 `cards`。选择持久化在 `ui-task-flow` 设置命名空间中，可在流程条头部、画布工具栏和两行通用设置中修改。

快照由 `task-flow` 对话视图目标从四个事件定义与引擎的轮次时间线组装：

| 持久化证据 | 贡献 |
|---|---|
| 用户来源的 `user/message` | 每轮开启一条路线；开放轮次内的第二条用户消息是转向，画成只有提问节点的插话。 |
| 含插入消息的 `agent/inbox/spliced` | 匹配位置记录准入时是否有轮次开放。在第 N 轮期间被准入的提问成为插话，锚定在第 N 轮当时开放的主干节点；轮次之间被准入的提问成为从根提问分叉的新问题。 |
| `todo/write` | 该轮最新一次写入构成主干；同轮更早的写入提供每项首次进行中与完成的时间。 |
| 配置的子代理工具名的 `tool/call`，由 `tool/result` 结算 | 每次调用一个子代理节点，从调用时处于进行中的 todo 扇出；错误结果把该 todo 标为有风险。 |
| `turn/end` | `completed` 关闭路线；`aborted`（带其 `AgentCancelCause`）、`error`、`blocked`、`max-tokens` 以及崩溃补齐的 `interrupted` 添加终结节点与路线状态。 |

既无 todo 也无子代理调用的轮次画成一个覆盖其步骤的「执行」节点。Web 层不向会话日志写入任何内容。

停止复用输入框的取消路径：流程条与画布调用作用域内的 `conversation.cancel()`，到达 `session-controller.cancel` 和 `agent.cancel({ kind: 'user' }, { keepInbox: true })`；由此产生的 `turn/end` 原因是图唯一消费的停止信号。Claude Code 的 `Stop` hook 桥接在用户取消时不触发，因为循环在派发 `agent/turn-stopping` 之前先检查中止信号，因此没有新增 hook 点。

`ui-conversation` 新增 `UiConversation.bindViewOpener` 与 `UiConversation.openView(sessionId, view, focus?)`：shell 在其 Session 主体挂载时安装打开器，并随 Session Controller binding 作用域释放，因此流程条这类 shell 之外的入口可以选中「流程」tab 或在「轨迹」中打开某次子代理调用。

## Alternatives considered

**对话记录内的内联卡片。** 与参考截图一致，但需要滚动才能找到；用户否决了任何需要翻页的位置。输入框上方的流程条在任何滚动位置都可达。

**放大画布用模态浮层。** 可避免视图打开器 API，但增加第二套浮层生命周期。视图环已承载「轨迹」；「流程」tab 复用其选择、持久化与 tab UI，而打开器 API 很小。

**只用 todo 或只用子代理的数据来源。** 只用 todo 会让短任务与委派角色不可见；只用子代理会让普通任务为空。混合方案以 todo 主干作为可读的计划，把子代理画成其服务项下的扇出，并按轮回退，使没有提问为空。

**专门的 `flow/abort` 会话事件或取消时的 Cordis hook。** 两者都重复了循环已在 `turn/end` 记录的事实，而纯展示事件会违反"仅用于绘制的内容不得进入日志"的规则。

**单一全局绘制变体。** 用户要求流程条与画布独立选择；紧凑的轨道适合流程条，卡片图适合大画布，因此两者分别持久化。

## Consequences

图可从任何已加载窗口重建：替换、向前翻页与实时追加产生相同快照，折叠规格通过真实组装器固定这一点。`turn/start` 位于已加载页之外的提问在该页加载前不会开启路线。子代理节点可导航到轨迹检视器；提问与 todo 节点不会滚动对话视图，因为 Chat 不暴露聚焦请求。不折叠 `tool-workflow/*` 阶段事件。每个构造完整 `SessionStandardProps` 的客户端规格现在都要桩出 `useTaskFlow`，这是新增一个 Session 作用域标准 hook 的代价。
