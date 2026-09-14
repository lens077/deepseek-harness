---
description: "持久会话统计与本会话请求用量估算，支持显式定价和提醒式成本治理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-stats

[English](README.md) | 中文

## 概述

无需导出提示词或连接计费服务，即可检查模型用量、估算成本、工具失败、重试延迟和请求前缀变化。数据不受分页、压缩或重新加载影响。分叉会话的成本只包含自身发起的请求。配置精确路由价格与可选软预算后，用量不完整时不会显示完整总价。现有客户端仍可读取独立的 `sessionStats` 生命周期数据。

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

在 Session 存储与投影注册表旁挂载此插件。Web bundle 已挂载；其他装配通过配置启用。插件提供两个值：`sessionStats` 表示全日志生命周期数据，`usageLedger` 表示本会话请求账本与诊断数据。

### 配置价格与可选预算

以下配置已经测试，使用每百万 token 的示例价格和以 USD 表示的示例累计预算。应按部署所用路由的价格与预算决策替换这些值。省略价格表时不估价，省略预算时不显示预算提醒。插件会在注册任何值之前拒绝无效数字、重叠的 UTC 价格窗口、未知字段和缺少价格表的预算配置。

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-projection'
- name: '@deepseek-ai/dsh-session-stats'
  config:
    pricing:
      currency: USD
      routes:
        test/m: { input: 1, cacheRead: 0.1, cacheWrite: 2, output: 3 }
    governance:
      budgets: { session: 5, tree: 20, all: 100, warningRatio: 0.8 }
```

路由键精确匹配 `provider/model`。每条路由声明未缓存输入、缓存读取、缓存写入和输出价格。可选 `tiers` 在互不重叠的 UTC 星期／小时窗口内对四项价格应用倍率，其余时间使用基础价格。Web bundle 包含当前 Claude、GPT 和 DeepSeek 路由的一组显式 USD 初始价格，但不设置金额预算。未知路由保持未定价，不会被猜测。初始价格参考 [TokenTracker 的 curated pricing 方案](https://github.com/xiufengsun/TokenTracker/tree/main/src/lib/pricing)：显式匹配优先，无法解析的模型保持未定价。可通过 profile patch 替换或扩展价格表。[配置目录](../../../docs/config-catalog.zh.md)说明各字段。

### 理解数据

计费输入等于未缓存输入、缓存读取与缓存写入之和。推理 token 是已观察到的输出子集，不会重复累加或单独计费。每条持久 Assistant 结算事件只贡献该请求的最终样本，不会把嵌入样本再加到组装样本上。失败尝试和已上报用量的压缩摘要请求分别贡献流量。压缩摘要增加请求数，但不增加逻辑 agent 步数。

`usageLedger` 排除精确的 fork 继承事件前缀。模型行分别统计上报用量的请求数和不同逻辑步骤数，因此切换到另一模型的重试可以有请求数而步数为零。分配不完整时账本保留已观察到的分桶，但隐藏路由估价和完整总额。缺失用量、计数矛盾或没有结算事件的已关闭模型步骤也会隐藏总额。提供方的精确总量可证明省略的缓存分桶为零；仅凭省略不能得出这个结论。

账本只对记录了步骤进入或重试开始的已结算 agent 尝试计时，不包含计划退避时间。没有记录开始时间的直接恢复重试仍计入用量，但不会虚构计时区间。首 token 与解码耗时使用紧凑流中的记录时间戳。工具行按调用 id 配对已分发调用与结果；孤立或重复结果不会增加开销与耗时。前缀诊断比较已观察到的 agent 请求之间的有效系统内容、已组装工具 schema 和路由。这些变化仅供排查，不代表实际缓存未命中或可避免的成本。

Web 用量抽屉可聚合本会话、本会话及其子代理后代，或当前可用列表中的所有非空会话。普通 fork 不计入子代理会话树。缺失账本、用量不完整、路由未定价或币种混合时，完整总额与预算均隐藏。预算提醒与浪费检测不会中止、降级或改路由；阈值使用当前选中会话的策略。

### 生命周期兼容口径

`sessionStats` 保留原有的全日志轮次／步骤计数与 LLM、工具、首 token、解码耗时。它包含继承历史，不能作为跨会话支出来源。缺少 `usageLedger` 的客户端可以展示 `tokenUsage` 和生命周期数据用于诊断，但不能据此推断金额成本或本会话独有用量。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

两个值都是由 Session 投影注册表驱动的同步投影单元。卸载插件会移除两项注册。[账本折叠](src/usage-ledger.ts)在初始化时读取不可变的继承前缀长度，保留继承请求的上下文以便归属，只累计 Session 自身工作。请求头和系统消息变化在账本数字变化前不会发布新的客户端值。

账本保存按路由划分的 UTC 周内小时 token 分桶、工具聚合和有限的生命周期状态，不保存逐步骤时间线。它保留活动系统节点与工具 schema 的哈希，不保留原始内容。价格在生成视图时计算，因此恢复的 token 检查点使用当前配置的价格表。循环小时分桶不保留历史价格生效日期。[配置校验与定价](src/usage-config.ts)独立于[既有生命周期折叠](src/projection.ts)。

注册表校验持久状态和 wire 输出。wire 校验拒绝没有币种的成本、分桶不完整的路由成本，以及遗漏未知或未定价尝试的总额。[投影测试](tests/usage-ledger.spec.ts)与[真实 Loader 装配](tests/loader-composition.spec.ts)固定用量归属、定价、缺失报告、重放和配置行为。不发布运行时不变式伴生入口，因为该纯折叠没有独立可变的第二份观测可供比较。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Session 投影](../../../docs/subsystems/session-projection.zh.md)——投递、持久检查点和冷快照。
- [Web 聊天](../../client/ui-chat/README.zh.md)——用量控件与范围选择。
- [用量治理决策](../../../.agents/notes/implemented/feature/2026-09-12-own-request-usage-governance.zh.md)——计费归属与明确限制。

-----

<a id="model-experience"></a>
## 模型体验

无，两个投影单元只读取既有日志并提供客户端诊断，不增加模型可见内容或调用提供方。

#### KV Cache 影响

无；诊断不会组装、修改或发送请求。前缀变化次数仅描述已观察到的请求，不改变其缓存行为。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **不是提供方账单：** 估价覆盖持久 Assistant 结算和已记录的压缩摘要用量，不包括未记日志的标题调用、没有摘要事件的失败摘要请求、外部工具的提供方账单，或结算前的进程丢失。
- **保守处理缺失用量：** 即使步骤在发送请求前取消，也可能隐藏总额，因为日志无法证明流量为零。已知 token 行仍可用于诊断。
- **最新可用持久快照：** 冷会话列表行可能滞后于检查点或缺少投影；带继承前缀的冷会话需加载后才提供自身请求数据。跨会话视图会提示缺失数据，不按零处理。
- **当前配置价格：** UTC 分层表示循环时间窗口，不表示历史生效价、量价折扣、税费或提供方余额。计费约定变化时应更新部署价格。
- **提醒式启发检测：** 大输入、低缓存命中、首 token 占比、重试率、工具错误和前缀变化可能都有合理原因。样本门槛可以减少噪声，但不能证明浪费或节省金额。

<a id="dev-note"></a>
### 开发备注

无。
