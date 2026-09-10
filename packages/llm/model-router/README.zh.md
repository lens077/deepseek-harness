---
description: "按提示词驱动的模型路由共享约定：路由器可以从一条人类提示词决定什么、消费方如何执行约束并记录结果，以及如何编写路由提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-model-router

[English](README.md) | 中文

## 概述

`dsh-model-router` 让部署按每条人类提示词调整模型路由——简短问题以低 thinking 运行，粘贴的代码块以高强度运行——用户无需触碰模型座位。像 `dsh-model-router-rules` 这样的提供方读取提示词与其所有者选定的路由，然后为下一次请求提出路由；Web 提示词路径应用该答案、持久记录它，并且绝不把它保存为默认值。当你编写路由提供方或应用它的消费方时使用本包；想让路由生效时挂载一个提供方。

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

挂载一个提供方，路由就会对每条 Web 提示词生效；只挂载本包不会路由任何东西。

### 何时选择它

当提示词上的确定性条件——字节长度、正则、图片——足以决定推理强度时，选择 `dsh-model-router-rules`。当你实现另一种决策过程（例如模型分类器），或构建一条应当咨询已挂载路由器的提示词路径时，选择本包。不要单独挂载它。

### 路由是什么样子

在人类提示词入队之前，消费方读取**基线**——用户或调用方拥有的路由，独立于路由器此前应用过的任何强度——并调用 `ctx.modelRouter.route()`。答案通过 Session 本地选择应用到下一次提示词组装，因此请求 header 记录被路由到的强度；同时一条 `model/route` 事件记录基线、实际应用的路由、提供方的理由与决定性的规则。没有规则适用时会再次应用基线，从而在早先被路由的请求之后恢复用户自己的强度。

消费方在应用答案前执行自己的约束：只允许改变推理强度，强度必须是确切模型声明的，提供方失败则保留基线。每个被拒绝的答案仍会连同拒绝原因一起记录。路由绝不拒绝提示词，也绝不调用 `agentDefaultModel.saveSelection()`，因此新 Session 从用户的默认值开始。

### 实现提供方

继承 `ModelRouter` 并实现 `route(input)`；把子类挂载为 `ctx.modelRouter`。`input.baseline` 是所有者的路由，`input.prompt` 携带拼接后的提示词文本以及是否附带图片。没有规则适用时原样返回基线。提供方是纯决策函数：从不针对实时 LLM 注册表做校验，也从不写入 Session。执行 I/O 的提供方运行在提示词准入路径上，必须自行限制延迟。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该接缝有三个角色。本包是 Service Definition：抽象的 `ModelRouter` 服务、`ModelRouteInput` 与 `ModelRouteDecision` 类型，以及 `model/route` Session 事件。提供方包供给决策。消费方——`dsh-api-session-controller` 中的 `SessionCommandController.prompt`——拥有基线推导、约束执行、经 `routeForNextRequest()` 的应用以及持久记录。把执行放在消费方意味着每条约束只测试一次，提供方也无法绕过它。

基线从 `modelSelection` 投影推导：当前路由上最新的用户 `model/selection`；否则，在路由器从未触碰过的 Session 上，取记录 header 自己的强度；否则，当保存的默认值指向同一路由时取其强度；否则不带强度，让模型自己的默认值生效。投影跟踪最新的路由选择，因此被路由到的 header 绝不会被误当作用户选择。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `ModelRouter` 抽象服务与 `ctx.modelRouter` 声明 |
| [`src/types.ts`](src/types.ts) | 不依赖 Cordis 的路由、输入、决策与 `model/route` 记录类型 |
| — | 不发布运行时 invariant 伴随插件：接缝不拥有独立观察之间的任何关系；消费方的投影与 Session 日志各自校验自己的记录。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [规则列表路由器](../model-router-rules/README.zh.md)——随产品发布的确定性提供方及其规则条件。
- [Session Controller](../../api/session-controller/README.zh.md)——应用并记录决策的 Web 提示词路径。
- [按提示词驱动的路由 Agent Note](../../../.agents/notes/proposed/feature/2026-09-10-prompt-driven-model-routing.zh.md)——超出仅路由强度范围的完整设计、约束与交付顺序。
- [模型可见的路由变更通知](../../../.agents/notes/implemented/feature/2026-09-07-model-switch-notice.zh.md)——为什么 provider/model 变化会追加一条历史通知，而仅改强度不会。
- [持久化目录](../../../docs/persistence-catalog.zh.md#modelroute--log-only)——持久的 `model/route` 负载。

-----

<a id="model-experience"></a>
## 模型体验

通过消费方应用到下一次请求的推理强度间接影响；模型可见请求由请求 header 与提供方适配器负责。

#### KV Cache 影响

改变强度不触碰已组装的前缀，因此路由会保留已可复用的前缀；`model/route` 事件仅记录日志，从不进入派生历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义了当前的路由范围；它们是当前包的约束，不是任务积压。

- **仅限强度**——消费方拒绝改变 provider 或 model 的答案。路由变化等待 Agent Note 中的容量与切换成本约束。
- **仅限 Web 提示词**——headless、ACP、SDK 与 webhook 会话保留其显式路由，从不咨询路由器。
- **没有按 Session 的退出开关**——挂载提供方后，每条人类 Web 提示词都会被路由；用户的强度选择是路由器按提示词覆盖的基线，会话级 Auto 开关推迟。
- **没有取消输入**——`route()` 不接收 signal，因为没有已发布的消费方拥有它；执行 I/O 的提供方自行限制延迟。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

None.

</details>
