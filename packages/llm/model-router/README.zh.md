---
description: "按提示词驱动的模型路由共享约定：路由器可以从一条人类提示词决定什么、消费方如何执行约束并记录结果，以及如何编写路由提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-model-router

[English](README.md) | 中文

## 概述

`dsh-model-router` 让部署按每条人类提示词挑选模型与推理强度——简短问题跑在已配置的快速模型上，粘贴的代码块跑在最强模型上，长提示词提高 thinking——用户无需触碰模型座位。像 `dsh-model-router-rules` 这样的提供方读取提示词、所有者的路由与已配置的路由，然后为下一次请求提出路由；Web 提示词路径应用该答案、持久记录它，并且绝不把它保存为默认值。当你编写路由提供方或应用它的消费方时使用本包；想让路由生效时挂载一个提供方。

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

当提示词上的确定性条件——字节长度、正则、图片——足以决定模型或推理强度时，选择 `dsh-model-router-rules`。当应由用户自己的模型阅读提示词并在已描述的选项中挑选时，选择 `dsh-model-router-llm`。当你实现另一种决策过程，或构建一条应当咨询已挂载路由器的提示词路径时，选择本包。不要单独挂载它。

### 路由是什么样子

在人类提示词入队之前，消费方读取**基线**——用户或调用方拥有的路由，独立于路由器此前应用过的任何东西——收集**候选**——实时注册表公布的每一条 provider/model 路由——并调用 `ctx.modelRouter.route()`。答案通过 Session 本地选择应用到下一次提示词组装，因此请求 header 记录被路由到的路由与强度，provider/model 变化会追加常规的 `[model changed: …]` 通知；同时一条 `model/route` 事件记录基线、实际应用的路由、提供方的理由与决定性的规则。没有规则适用时会再次应用基线，从而在早先被路由的请求之后恢复用户自己的模型与强度。

消费方在应用答案前执行自己的约束。只有当至少配置了两条路由、提案指名其中之一、带图片的提示词落在声明图片输入的路由上、Session 已测得的 token 在两者都已知时不超过该路由的上下文窗口、且提出的强度能在该模型上解析时，才会应用路由变化；否则提案降级为在基线路由上应用其强度——只配置了一个模型时，路由就是仅改强度。基线模型拒绝的强度或提供方失败则保留基线。每个被拒绝的约束都记录在事件的 `reason` 中。路由绝不拒绝提示词，也绝不调用 `agentDefaultModel.saveSelection()`，因此新 Session 从用户的默认值开始。

### 关闭路由

挂载任一提供方都会提供 `model-routing` 设置分区，只有一个字段 `enabled`（默认开启），`dsh-client-ui-model-routing` 把它渲染为「模型」设置页提供方行下方的开关和 composer 工具行里的 chip。关闭期间提示词不再咨询路由器，仍停留在路由选择上的 Session 会在下一条提示词时回到基线，`model/route` 的原因为 `routing switched off: baseline restored`。该开关不改变已挂载的提供方或其规则。

### 被路由到的模型失败时

如果被路由路由上的请求以 `dsh-llm-retry` 未能恢复的终态失败结束——提供方宕机、持续超时或拒绝该模型——Web 提示词路径会把同一步骤挪回基线路由并在那里重试一次，`model/route` 记录 `fallback: <code> on <provider>/<model>: <message>`。基线本身的失败照旧结束该轮。

### 实现提供方

继承 `ModelRouter` 并实现 `route(input)`；把子类挂载为 `ctx.modelRouter`。`input.baseline` 是所有者的路由，`input.candidates` 列出提案可以指名的已配置路由，`input.prompt` 携带拼接后的提示词文本以及是否附带图片。强度属于提出的模型：改变模型却不带强度的提案表示要该模型的默认值。没有规则适用时原样返回基线。提供方是纯决策函数：从不针对实时 LLM 注册表做校验，也从不写入 Session。执行 I/O 的提供方运行在提示词准入路径上，必须自行限制延迟。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该接缝有三个角色。本包是 Service Definition：抽象的 `ModelRouter` 服务、`ModelRouteInput` 与 `ModelRouteDecision` 类型，以及 `model/route` Session 事件。提供方包供给决策。消费方——`dsh-api-session-controller` 中的 `SessionCommandController.prompt`——拥有基线推导、约束执行、经 `routeForNextRequest()` 的应用以及持久记录。把执行放在消费方意味着每条约束只测试一次，提供方也无法绕过它。

基线就是 `modelSelection` 投影的 `baseline`：最新的用户 `model/selection`，否则是最新 `model/route` 向前携带的基线；两者都未触碰过的 Session 使用其当前选择。由于每条路由记录都重述它出发时的基线，一串被路由的请求绝不会丢失用户的路由，投影的 `routed` 字段则防止把被路由到的 header 误当作用户选择。

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
- [模型分类路由器](../model-router-llm/README.zh.md)——向基线模型索取裁决的提供方。
- [Session Controller](../../api/session-controller/README.zh.md)——应用并记录决策的 Web 提示词路径。
- [按提示词驱动的路由 Agent Note](../../../.agents/notes/proposed/feature/2026-09-10-prompt-driven-model-routing.zh.md)——超出仅路由强度范围的完整设计、约束与交付顺序。
- [模型可见的路由变更通知](../../../.agents/notes/implemented/feature/2026-09-07-model-switch-notice.zh.md)——为什么 provider/model 变化会追加一条历史通知，而仅改强度不会。
- [持久化目录](../../../docs/persistence-catalog.zh.md#modelroute--log-only)——持久的 `model/route` 负载。

-----

<a id="model-experience"></a>
## 模型体验

通过消费方应用到下一次请求的推理强度间接影响；模型可见请求由请求 header 与提供方适配器负责。

#### KV Cache 影响

仅改强度的决策不触碰已组装的前缀。provider/model 变化会放弃整段历史在新路由上的提供方侧复用，并把路由变更通知追加为保留历史；`model/route` 事件本身仅记录日志，从不进入派生历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义了当前的路由范围；它们是当前包的约束，不是任务积压。

- **没有切换成本守卫**——只要上述约束成立，无论 Session 多长都接受路由变化；前缀重算与保留的通知是部署编写规则时要权衡的成本。
- **图片检查只看提示词，不看历史**——早先轮次含图片块时，切离支持图片的模型不会被拒绝。
- **仅限 Web 提示词**——headless、ACP、SDK 与 webhook 会话保留其显式路由，从不咨询路由器。
- **一个部署级开关**——`model-routing.enabled` 对所有 Session 停止路由；按 Session 的 Auto/固定状态推迟。
- **回退只有一跳**——失败的被路由模型只回退到基线重试；绝不尝试第三条路由。
- **没有取消输入**——`route()` 不接收 signal，因为没有已发布的消费方拥有它；执行 I/O 的提供方自行限制延迟。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

None.

</details>
