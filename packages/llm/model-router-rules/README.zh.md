---
description: "面向希望简短问题用已配置的快速模型、代码密集提示词用最强模型作答的部署的规则列表模型路由：编写规则条件与结果、排序，以及排查某条提示词为何被路由。"
kind: "package-reference"
---

# @deepseek-ai/dsh-model-router-rules

[English](README.md) | 中文

## 概述

`dsh-model-router-rules` 根据你在 `cordis.yml` 中编写的有序条件列表为每条 Web 提示词挑选模型、推理强度或两者：提示词字节长度、正则，或是否附带图片。规则指名你已配置的一条 provider/model 路由、一个强度或两者；第一条全部条件成立的规则胜出，没有匹配则保留用户自己的路由。决策不花费模型调用且重放结果一致。路由与强度 id 按每条提示词针对实时注册表检查而不是在加载时，因此规则指名了你后来移除的模型时会被拒绝而不是致命。

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

把本包挂载在 Web 组合的宿主平面，并按从最容易判定到最具体的顺序编写规则。

### 何时选择它

当少数几个提示词特征足以决定模型与强度时选择本包。当决策需要语义分类时选择另一个 `dsh-model-router` 提供方。随产品发布的 base 组合携带该行但保持禁用；在 overlay 中用你自己的规则列表启用它。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-model-router-rules'
  config:
    rules:
      - id: short-question
        maxBytes: 240
        pattern: '[?？]\s*$'
        provider: deepseek-official
        model: deepseek-v4-flash
        reasoningEffort: low
      - id: code-block
        pattern: '```'
        provider: deepseek-official
        model: deepseek-v4-pro
      - id: long-prompt
        minBytes: 1200
        reasoningEffort: high
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `rules` | 必填，非空 | 有序规则；第一条完整匹配的规则决定 |
| `rules[].id` | 必填 | 唯一标识，记录为 `model/route` 事件的 `rule` |
| `rules[].pattern` | — | 以 `u` 与 `s` 标志针对提示词文本测试的 JavaScript 正则源 |
| `rules[].maxBytes` | — | 仅当提示词的 UTF-8 字节长度不超过该值时匹配 |
| `rules[].minBytes` | — | 仅当提示词的 UTF-8 字节长度不少于该值时匹配 |
| `rules[].hasImage` | — | 仅当图片存在与否等于该值时匹配 |
| `rules[].provider` | — | 要提出的路由的已注册 provider；需要 `model`，且该路由必须是注册表公布的 |
| `rules[].model` | — | 要提出的路由的 provider 自有模型 id；需要 `provider` |
| `rules[].reasoningEffort` | — | 提出路由上的适配器自有强度 id；未指名模型时应用在用户的路由上 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-model-router-rules)是每个可接受字段的详尽来源。一条规则至少需要一个条件和一个结果（路由、强度或两者）。当列表为空、id 重复、规则没有条件或没有结果、指名 `provider` 却没有 `model`、`minBytes` 超过 `maxBytes` 或正则无法编译时，加载失败并指名规则。

### 读懂一条决策

每条 Web 提示词追加一条 `model/route` 事件。`rule` 指名胜出的规则，`reason` 为 `rule "<id>" matched`；`no rule matched` 表示再次应用了基线。`reason` 含 `effort only:` 表示消费方拒绝了规则的路由——已配置路由少于两条、注册表未公布该路由、带图片的提示词遇到纯文本路由，或上下文窗口低于 Session 已测得的 token——而只在用户的模型上应用了强度。`reason` 以 `refused:` 开头表示连该强度也被拒绝并应用了基线；把规则改成注册表公布的路由与强度。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`RulesModelRouter` 在构造函数中一次性编译规则列表，对任何它永远无法应用的规则大声失败。`route()` 以 UTF-8 字节测量提示词文本，按顺序测试规则，并返回第一条匹配规则的路由——规则未指名时为基线路由——以及规则的强度（若有）。该类是纯决策函数：由消费方针对已配置候选检查路由、针对确切模型校验强度并写入持久记录。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `RulesModelRouter`、`Config`、`RuleConfig` 与加载时规则编译 |
| — | 不发布运行时 invariant 伴随插件：路由器除已编译规则外不保持状态，也不观察任何可能分歧的事物。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [模型路由接缝](../model-router/README.zh.md)——本提供方实现的约定，以及应用于其答案的消费方约束。
- [Session Controller](../../api/session-controller/README.zh.md)——Web 提示词咨询路由器的位置。
- [DeepSeek 适配器](../llm-deepseek/README.zh.md)——官方路由声明的 `off`、`low`、`high` 与 `max` 强度 id。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-model-router-rules)——每个可接受的配置字段。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-model-router` 消费方应用到下一次请求的推理强度间接影响；模型可见请求由请求 header 与提供方适配器负责。

#### KV Cache 影响

只指名强度的规则不触碰已组装的前缀；指名另一条路由的规则会放弃历史在新路由上的提供方侧复用，这是部署编写规则时要权衡的。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义了规则列表能表达什么；它们是当前包的约束，不是任务积压。

- **仅限提示词特征**——规则只看到提示词的文本与图片存在，看不到会话、工作区或 token 压力。
- **路由与强度 id 不在加载时校验**——规则的路由只在提示词匹配它时才针对注册表检查、强度才针对确切模型检查，因为目录由用户编辑，基线模型也按 Session 选择。
- **没有成本或层级元数据**——规则指名确切路由；除规则作者编码的之外，路由器不知道哪个模型更便宜或更强。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

None.

</details>
