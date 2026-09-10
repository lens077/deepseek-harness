---
description: "面向希望由会话自己的模型先读每条提示词、再决定由哪个已配置模型与推理强度作答的部署的模型分类路由：编写选项描述、限制分类请求，以及排查一次裁决。"
kind: "package-reference"
---

# @deepseek-ai/dsh-model-router-llm

[English](README.md) | 中文

## 概述

`dsh-model-router-llm` 让用户已经选定的模型先读每条 Web 提示词，再决定应由哪个已配置的模型与推理强度作答。你用自然语言描述每个选项——"简短事实性问题"、"多文件重构"——并指名它代表的路由或强度；分类器回答一个选项 id，或回答 `baseline` 保留用户的路由。每条提示词多花一次小请求（适配器支持时关闭 thinking），并在该请求返回后才入队。任何失败、超时或无法识别的裁决都保留基线。

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

当长度或正则这类提示词特征不足以判定、而应由模型阅读提示词来判定时，用本包替代 `dsh-model-router-rules`。

### 何时选择它

当选项更容易用文字描述而非编码成条件、且每条提示词多一次请求——其延迟位于提示词准入路径上——可以接受时，选择本包。零延迟的确定性决策选 `dsh-model-router-rules`。只挂载一个 `dsh-model-router` 提供方。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-model-router-llm'
  config:
    choices:
      - id: fast
        description: Short factual questions, greetings, and quick lookups.
        provider: deepseek-official
        model: deepseek-v4-flash
        reasoningEffort: low
      - id: strong
        description: Design, debugging, or changes across several files.
        provider: deepseek-official
        model: deepseek-v4-pro
      - id: deep
        description: Long or ambiguous requests that need careful reasoning on the current model.
        reasoningEffort: high
    maxInputBytes: 8192
    maxOutputTokens: 16
    timeoutMs: 20000
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `choices` | 必填，非空 | 提供给分类器的选项；`baseline` 为保留字 |
| `choices[].id` | 必填 | 不含空白的裁决 token；不区分大小写匹配 |
| `choices[].description` | 必填 | 分类器何时应选此项，写给模型看 |
| `choices[].provider` | — | 要提出的路由的已注册 provider；需要 `model`，且该路由必须是注册表公布的 |
| `choices[].model` | — | 要提出的路由的 provider 自有模型 id；需要 `provider` |
| `choices[].reasoningEffort` | — | 提出路由上的适配器自有强度 id；未指名模型时应用在用户的路由上 |
| `maxInputBytes` | 必填 | 框定后提示词的最大 UTF-8 字节数；更长的提示词不发请求直接保留基线 |
| `maxOutputTokens` | 必填 | 分类器输出上限；一次裁决只有几个 token |
| `timeoutMs` | 必填 | 分类器端到端截止时间 |
| `classifierReasoningEffort` | — | 在基线模型上执行分类调用的强度；缺省取该模型公布的第一个强度，未公布时取其默认值 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-model-router-llm)是每个可接受字段的详尽来源。一个选项需要路由、强度或两者。当列表为空、id 重复或为 `baseline`、描述为空、只有 `provider` 没有 `model`，或某个限制超出 schema 范围时，加载失败并指名选项。

### 分类请求

请求发往基线路由——用户选定的模型——携带 `purpose: 'model-routing'`（DeepSeek 适配器映射为关闭 thinking）与上述分类强度。系统提示词列出每个选项 id 及其描述外加保留的 `baseline` 行，并要求恰好回答一个 id；用户消息把提示词文本与图片标志作为 JSON 携带，以免提示词文本破坏框架。裁决先在去除引号与标点后精确匹配，否则按整词提及的唯一选项 id 匹配；其他一切都算失败。

### 读懂一条决策

每条 Web 提示词追加一条 `model/route` 事件，`rule` 是选中的 id，`reason` 为 `classifier chose "<id>"` 或 `classifier chose baseline`。`reason` 以 `router failed:` 开头表示分类器失败——超时、提供方错误、框定后提示词超过 `maxInputBytes`，或裁决未指名唯一选项——并应用了基线。消费方自身的拒绝（`effort only:` 与 `refused:`）见[接缝 README](../model-router/README.zh.md)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`LlmModelRouter` 在构造函数中一次性编译选项列表并渲染系统提示词。`route()` 框定提示词、检查 `maxInputBytes`、解析分类强度、在 `dsh-timeout` 截止时间下流式发起一次 `ctx.llm` 请求、只组装文本块，并把裁决翻译成接缝的决策：选项的路由及其强度、仅强度选项对应的基线路由加强度，或保留裁决对应的基线。该请求可由本配置与消费方记录为 `user/message` 的提示词重建，因此路由器不写自己的 Session 事件。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `LlmModelRouter`、`Config`、`ChoiceConfig`、选项编译、分类请求与裁决解析 |
| — | 不发布运行时 invariant 伴随插件：路由器除已编译选项外不保持状态，也不观察任何可能分歧的事物。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [模型路由接缝](../model-router/README.zh.md)——本提供方实现的约定，以及应用于其答案的消费方约束。
- [规则列表路由器](../model-router-rules/README.zh.md)——零延迟的替代方案。
- [会话标题生成器](../../session/session-title-llm/README.zh.md)——同一种有界辅助请求模式在标题上的应用。
- [DeepSeek 适配器](../llm-deepseek/README.zh.md)——为分类器关闭 thinking 的 `purpose` 处理。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-model-router-llm)——每个可接受的配置字段。

-----

<a id="model-experience"></a>
## 模型体验

### 分类请求，每条 Web 提示词一次

#### 模型看到的内容

基线模型收到一段系统提示词：把每个已配置选项列为 `- <id>: <description>`，一行保留的 `- baseline: keep the model the person selected; answer this when no other choice clearly fits.`，以及"恰好回答一个选项 id"的指令；随后是一条把提示词文本与图片标志框定为 JSON 的用户消息。会话模型永远看不到该请求或其裁决。

##### 系统提示词框架原文

```markdown
You route one user prompt sent to an AI coding assistant to the choice that fits it best.
Choices:
- <id>: <description>
- baseline: keep the model the person selected; answer this when no other choice clearly fits.
Reply with exactly one choice id and nothing else.
```

#### Token 影响

每条人类 Web 提示词一次辅助请求：固定的系统提示词、至多 `maxInputBytes` 的框定提示词，以及至多 `maxOutputTokens` 的输出。路由器本身不改变会话请求；消费方应用的路由决定其强度与模型。

#### KV Cache 影响

与会话请求缓存无关。系统提示词在同一路由上的多条提示词之间是稳定前缀，而每条框定提示词从首字节起就不同。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义了分类器能决定与不能决定的事；它们是当前包的约束，不是任务积压。

- **准入路径上的延迟**——提示词只有在裁决返回或截止后才入队；慢的基线模型会让每条提示词延迟相应时间。
- **只看提示词文本**——分类器看到提示词与图片标志，看不到会话或工作区。
- **没有持久请求记录**——与会话标题生成器不同，分类请求不记录日志；它可由配置与已记录的提示词重建。
- **没有重放 fixture**——无密钥录制会话无法固定其裁决；覆盖依赖脚本化适配器的单测与真实 API 运行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

None.

</details>
