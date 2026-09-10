# Agent Note: Prompt-driven model and reasoning-effort routing

Status: proposed

[English](2026-09-10-prompt-driven-model-routing.md) | 中文

## Problem

每个会话请求都使用人类或调用方选定的 provider、model 与推理强度。没有任何组件会读取传入的提示词，然后决定一个简短的事实性问题应该关闭 thinking 跑在快速、经济的模型上，或者一次多文件重构应该用最强模型以高强度运行。目前唯一存在的模型侧选择是按委派进行的：`dsh-tool-subagent` 允许模型从记录的 `subagent/model-selection-policy` 中挑选子路由（[模型自选子代理路由](../../implemented/feature/2026-08-18-model-selected-subagent-routes.zh.md)）。顶层会话本身从不在没有人类操作的情况下改变路由。

加入自动路由器并不只是在一个监听器里覆盖 `provider` 和 `model`，因为现有的选择机制有一些天真的路由器会破坏的行为：

- **Web 里的一次选择同时也是新会话的默认值。** `dsh-api-session-controller` 的 `session.selectModel` 先向 Session 追加 `model/selection`，再调用 `ctx.agentDefaultModel.saveSelection()`，于是选中的路由成为此后每个新顶层 Session 的 `currentSelection()`。复用该命令的路由器会在每一轮悄悄改写用户的默认值。
- **生效路由是粘性的。** `ApiSessionAgentController.selectionFor().current` 返回待生效的 `model/selection`，否则返回最新记录的 `request/header` 路由，否则返回默认值。一次路由请求之后，记录的 header 就是被路由到的模型，因此一轮降级会持续到后续每一轮，且没有任何记录表明用户选的是别的模型。
- **压缩按上一条路由定价，而不是下一条。** `dsh-compaction-basic` 在 `agent/pre-step` 运行，从最新的 `request/header` 解析目标，并把 `ctx.tokenMeter.measure(session)` 与该模型的 `contextWindow` 比较。不存在由切换触发的压缩：切换到窗口更小的模型只会在提供方返回 `CONTEXT_WINDOW_EXCEEDED` 时才被发现，随后 `agent/request-error` 恢复逻辑在每次重试执行一次最大化的平衡缩减，直到 `maxOverflowRetries`。这种恢复是有损且未经规划的。
- **路由变化会使提供方前缀缓存失效。** 每次 provider/model 切换都放弃整段历史的 KV cache 复用，切换到不带 `systemPromptUpdate: in-history` 的路由还会把保留在历史中的 system 节点合并到头部。在长会话上，重新计算的成本可能超过便宜模型省下的部分。
- **能力按确切模型定义。** 图片输入、`contextWindow` 与推理强度 id 都是确切模型的元数据。Web 提示词准入会拒绝对纯文本选择提交图片（`MODEL_DOES_NOT_SUPPORT_IMAGES`），`read_image` 在文本路由上拒绝执行，模型未声明的强度 id 会在网络 I/O 前以 `UNSUPPORTED_REASONING_EFFORT` 失败。
- **路由会被继承。** 没有静态路由默认值的子代理采用父代理最新记录的请求路由，压缩摘要器与会话标题生成器使用记录的路由，并且每次 provider/model 变化都会追加一条 `[model changed: …]` 用户角色通知（[路由变更通知](../../implemented/feature/2026-09-07-model-switch-notice.zh.md)）。这些都会观察到路由降级。
- **五个入口各自拥有一份选择。** Web（`session-controller`）、headless bundle、ACP（`session/set_config_option`，按提示词固定）、SDK 服务端（`InitializeParams`）与 webhook 会话各自构造一个 `ModelSelectionRef`。ACP 与 SDK 客户端是受信控制器，其显式路由不得被覆盖。

## Proposal

### 术语

- **基线选择** —— 人类或调用方拥有的路由：Session 中最新的 `source: 'user'` 的 `model/selection`，否则为 `agentDefaultModel.currentSelection()`。路由器从不改变它，也从不保存它。
- **路由选择** —— 路由器根据基线和提示词为一轮选出的 provider、model 与强度。它通过 Session 本地的 `ModelSelectionRef` 应用，因此 `installModelSelection` 仍在提示词组装时快照它、在 `agent/request` 中应用它，并发出路由变更通知。
- **层级（tier）** —— 部署配置的标签（`fast`、`balanced`、`strong`），绑定到一个有序的确切 `{ provider, model, reasoningEffort? }` 候选列表。路由器选择一个层级；第一个通过下述约束的候选胜出。

### 能力接缝

`dsh-model-router`（Service Definition，`ctx.modelRouter`）提供一个方法：

```text
route(input: RouteInput, signal: AbortSignal): Promise<RouteDecision>
RouteInput  = { baseline, candidates: readonly TierCandidate[], prompt: PromptSummary, session: SessionFacts }
PromptSummary = { text: string, hasImage: boolean, byteLength: number, source: 'user' }
SessionFacts  = { measuredTokens: number, requestCount: number, lastReplaceGeneration: number, sinceCompaction: boolean }
RouteDecision = { tier: string, selection: ModelSelection, reason: string, rule?: string } | { tier: 'baseline', selection: baseline, reason }
```

提供方：

- `dsh-model-router-rules` —— 确定性、由配置拥有：按提示词字节长度、代码围栏或文件引用的存在、列出的关键词或正则、图片存在与会话 token 数的有序规则。零延迟，可在无密钥快照中重放，是随产品发布的默认值。
- `dsh-model-router-llm` —— 可选分类器：在配置的快速路由上发出一次有界请求，携带新的 `purpose: 'model-routing'`，关闭 thinking，受 `maxInputBytes`、`timeoutMs` 约束，输出固定的 JSON `{ tier }`。以 `dsh-session-title-llm` 为模板，区别在于它运行在提示词的关键路径上；任何失败或超时都返回基线层级。

消费方：`dsh-api-session-controller` 的提示词准入（`SessionCommands.prompt`）与 headless bundle 的提示词路径。两者在入队前都已解析 `selectionFor(agent)`；消费方在此运行 `route()`，然后通过新的 `routeForNextRequest(agent, decision)` 安装路由选择——它追加带 `source: 'router'` 的 `model/selection` 和一条诊断用的 `model/route` 事件，并更新 `selection.current`，但不调用 `saveSelection()`。ACP、SDK 与 webhook 会话保留其显式路由；它们以后可以通过声明 `auto` 选项加入，这不在本提案范围内。

### 持久状态与投影

`model/selection` 增加必需的 `source: 'user' | 'router'` 字段；没有该字段的既有日志按相邻迁移规则读作 `'user'`。`model/route` 是一个新的 `ignorable: true` 事件，携带 `{ baseline, decision, measuredTokens }` 供 Trajectory 与 UI 使用；它对模型不可见，模型可见的效果仍是既有的 `request/header` 与路由变更通知。

`modelSelection` 投影（`stateVersion` 3）跟踪 `baseline`（最新用户选择或 `null`）、`routed`（最新路由器选择或 `null`）与 `lastUsed`。`selectionFor().current` 返回 `routed ?? baseline ?? loggedHeader ?? default`——记录 header 的回退保留给早于该字段的 Session，但被路由过的 Session 绝不会把路由到的 header 当作用户的选择回退。当 `routed` 与 `baseline` 不同时，composer 的模型座位显示 `Auto → <model>`；在座位里显式选择会写入一条用户 `model/selection`，从而固定该 Session（暂停路由），直到用户再次选择 **Auto**。

### 消费方在应用决策前强制执行的约束

违反下列任一约束的决策由消费方而非提供方拒绝，并以记录到 `model/route` 的原因回退到基线。提供方保持纯函数，使约束只需测试一次。

1. **绝不保存。** 路由选择永远不会到达 `agentDefaultModel.saveSelection()`。新 Session 从用户基线开始。
2. **容量。** `resolveModelInfo(candidate).context.contextWindow × (1 − headroomRatio)` 必须超过 `ctx.tokenMeter.measure(session).totalTokens`；否则跳过该候选。这是当前压缩插件无法提供的守卫，因为它按上一条 header 的路由定价。
3. **切换成本。** 仅当切换便宜时才允许 provider/model 变化：Session 尚无 `request/header`、`surface.replaceGeneration` 自上次请求后已推进（压缩或其他替换已经打断了前缀），或 `measuredTokens < stickyTokens`。否则只允许改变推理强度，因为仅改强度会保留前缀且不发通知。该规则同时限制了通知的来回抖动。
4. **能力。** 带图片的提示词，或历史中含图片块的 Session，只路由到 `inputModalities` 包含 `image` 的候选。强度通过 `ctx.llm.resolveCallConfig()` 针对确切候选校验；不支持的强度跳过该候选而不是被截断。
5. **可用性。** `routeServed(provider)` 必须成立，与提示词命令既有的拒绝一致。
6. **仅限人类提示词。** 路由只对来自人类的 `source.kind === 'user'` 提示词运行。Goal 继续轮、Ralph 轮、子代理投递的消息与 `inject()` 上下文继承当前路由选择。
7. **已固定的 Session。** 在启用路由后于本 Session 中显式设置过基线的 Session 不再被路由，直到用户重新启用 Auto。

### 保持不变、只记录而不解决的交互

- 路由轮中派生的子代理通过父代理最新记录的请求继承路由后的路由；`list_subagent_models` 与显式子路由仍是覆盖手段。`childRoute: 'baseline' | 'routed'` 选项推迟。
- 压缩摘要器与会话标题生成器在记录的路由上运行。两者接受任何支持文本的路由。
- 工具调用之间的轮内（步级）路由不在范围内：每次步级切换都会打断前缀。
- Fork 复制父代理的历史并继承其路由；fork 工具不暴露路由选择（[fork 限制](../../implemented/feature/2026-08-18-model-selected-subagent-routes.zh.md)）。

### 配置与设置

宿主拥有的 `model-routing` 设置，默认关闭，包含 `enabled`、`tiers`（每个是确切路由列表）与 `provider: rules | llm`。`dsh-model-router-rules` 的配置拥有有序规则列表、`headroomRatio` 与 `stickyTokens`；`dsh-model-router-llm` 的配置拥有分类器路由与限制。没有任何可调参数是源码常量。Plugins 设置页像 `subagent-model-selection` 一样原子地存储该设置，校验在保存时拒绝 provider 未注册的层级候选，但仍允许未列出的模型 id，因为适配器目录只是建议性的。

### 交付顺序

1. 接缝、规则提供方与消费方——已作为 `dsh-model-router`、`dsh-model-router-rules` 与 `SessionCommandController.prompt` 路径交付。规则指名已配置的路由、强度或两者；只有当实时注册表公布至少两条路由、提案指名其中之一、带图片的提示词落在支持图片的路由上、已测得的 Session 在窗口已知时放得下、且强度可解析时，消费方才应用路由变化，否则降级为基线上的仅改强度。本阶段由配置驱动（base 中一条禁用的行，由 overlay 启用），写入 `model/route` 而不给 `model/selection` 加 `source` 字段，在每条 `model/route` 上向前携带基线以便 `modelSelection` 投影（`stateVersion` 3）恢复它，且没有按 Session 的固定、也没有切换成本守卫：挂载提供方且部署级 `model-routing.enabled` 设置（「模型」设置页上的开关）开启期间，每条人类 Web 提示词都会被路由，无论 Session 多长。被路由模型的请求在 `dsh-llm-retry` 之后仍失败时，同一步骤回退到基线重试一次。
2. 切换成本约束、`source` 字段、Auto 座位状态与 Session 固定。
3. 可选的 LLM 分类器提供方及录制的 e2e fixture。

## Alternatives considered

**在 Agent 作用域挂一个覆盖 provider 与 model 的 `agent/request` 监听器。** 拒绝。该监听器在提示词组装之后运行，决策所需的提示词文本在那里不可得；在那里设置的路由绕过 `ModelSelectionRef`，导致路由变更通知、图片准入检查与 composer 座位描述的都是错误的模型。与 `installModelSelection` 的次序——其自身的 `agent/request` 监听器在 `next()` 之后覆盖已解析路由——将依赖 `prepend`，而它不是用于优先级的文档化扩展点。

**通过既有的 `session.selectModel` 命令路由。** 拒绝，因为该命令会把选择保存为部署默认值；路由器不得拥有用户的默认值。

**提供方侧的虚拟模型（`deepseek-auto`）在网关内部路由。** 拒绝。Harness 将不知道生效的 `contextWindow`、图片能力或强度 id，于是压缩压力、图片准入与强度校验都会针对未知元数据运行，请求 header 也无法记录到底是哪个模型作答。

**让模型通过工具自选路由。** 作为默认方案拒绝。它要花最强模型的一步来决定便宜模型就够用，而且决策在需要它的那次请求之后才到达。它可以作为委派场景的补充，而 `dsh-tool-subagent` 已经提供了这一点。

**复用 `subagent-model-selection` 允许列表作为层级列表。** 拒绝。该设置授权的是模型可请求的子路由；层级是路由器应用于顶层 Session 的排序。共用一份列表会让启用一个功能扩大另一个功能。

**每次路由切换都压缩以便任何窗口都放得下。** 拒绝。摘要有损且要花一次请求；容量约束改为拒绝切换，切换成本约束则优先选择压缩已经打断前缀的时机。

## Acceptance criteria

- 设置关闭时，不写任何 `model/route` 事件，每个入口行为与今天一致；既有无密钥快照逐字节相同。
- 启用规则路由后，在全新 Session 上的一个简短问题会记录 `model/route`、`model/selection { source: 'router' }` 与 `fast` 层级上的 `request/header`；`agentDefaultModel.currentSelection()` 不变；下一个新 Session 从基线开始。
- 一次路由降级后，在座位里显式选择会写入 `model/selection { source: 'user' }`，随后的提示词不再被路由，选择 Auto 后恢复路由。
- `contextWindow` 低于测得历史的候选被跳过并记录原因，该轮在基线上完成且不出现 `CONTEXT_WINDOW_EXCEEDED`。
- 在超过 `stickyTokens` 且自上次请求后无 surface 替换的 Session 上，只改变强度且不追加路由变更通知。
- 图片提示词永远不会被路由到纯文本候选。
- 一个无密钥录制会话快照覆盖规则提供方在全新 Session、粘性 Session 与已固定 Session 上的表现；一个真实 API e2e 覆盖 LLM 分类器并在无密钥时自跳过。
- `modelSelection` 投影把无该字段的日志读作 `source: 'user'`，并在 resume 与 fork 时重建 `baseline`、`routed` 与固定状态。

## Risks

- 路由器运行在提示词的关键路径上。规则提供方不增加延迟；LLM 提供方为每条人类提示词增加一次有界请求，并且必须在超时内回退到基线。
- 每条路由变更通知都是保留的历史；约束 3 限制其数量，但把 `stickyTokens` 设得很高的部署仍会在每次路由切换时看到一条通知。
- 被路由到的便宜模型会成为该轮派生的所有子代理的父代理，以及该轮压缩摘要与标题的作者。需要用强模型做委派的部署应配置静态子路由默认值。
- `model/selection` 增加必需字段，这是相邻迁移规则下的已发布 Session 数据变更，需要更新读取方并审视 `SESSION_FORMAT_VERSION`。
- ACP、SDK 与 webhook 客户端在声明 `auto` 选项之前得不到路由；期望处处都有路由的用户只会在 Web 与 headless 中看到它。
