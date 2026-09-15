---
description: "按请求把选中的已完成回合从会话的模型可见历史中移除，同时日志与 transcript 仍保留它们。"
kind: "package-reference"
---

# @deepseek-ai/dsh-context-remove

[English](README.md) | 中文

## 摘要

`dsh-context-remove` 提供 `ctx.contextRemoval`：一个空闲会话操作，把已经回答完的完整回合从模型接下来看到的内容中移除。人类挑选要丢弃的提问；每一组在 surface 上连续的选中回合都被一条空内容的检查点 user 消息替换，该消息投影为无线上消息。追加式会话日志保留每个被移除事件，人类 transcript 继续显示它们，重放能精确复现移除前后的模型可见历史。该操作不调用模型。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发者注记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当客户端需要按回合移除上下文时，在 host 平面挂载本包。Web GUI 的会话控制器把它暴露为 `session.removeTurns`，Chat 的提问面板用它做单选和多选移除。

### 最小可用组合

```yaml
- name: '@deepseek-ai/dsh-token-meter'
- name: '@deepseek-ai/dsh-context-remove'
```

本服务没有配置。它需要 `ctx.tokenMeter` 为影子价格协议给每个被移除区间定价，需要 `ctx.sessions` 在替换落地后做持久化检查点。

### 一次请求做什么

`removeTurns(agent, turns, signal)` 在 agent 的空闲维护阶段内运行，因此只在没有回合驱动时开始，后续提示词等待它结束。它把每个请求的回合解析为当前 surface 区间，全部校验后再不让出控制地追加替换：要么每组都落地，要么什么都不变。surface 上相邻的回合共用一条替换。追加之后会话被 flush。

以下情况整个请求被拒绝，并带 `ContextRemovalError` 代码：

| 代码 | 条件 |
|---|---|
| `busy` | agent 正在驱动回合或运行维护任务、compaction 括号未闭合，或日志末尾停在未结束的回合内。 |
| `unavailable` | 某个回合不在会话中、没有 `turn/end`、已被移除、与其他历史共用一个 compaction 摘要，或不是工具配对平衡的区间。 |
| `cancelled` | agent 在替换落地前取消了维护任务。 |
| `persistence` | 替换已落地，但持久化检查点失败。 |

### 移除的是什么

一个回合的区间是事件位于该回合 `turn/start` 与 `turn/end` 之间的所有当前 surface 节点，加上其引用的 surface 事件全部位于其中的替换副本（被裁剪的工具结果）。第一个系统提示词节点永远不属于区间。被移除回合内的后续系统节点随之被遮蔽；循环的规范化会在下一次请求时恢复提示词。进入该回合的转向消息和记录在其中的注入上下文一并离开。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 持久化协议

每个落地的组是两条相邻事件：一条 `compaction/prune` 影子价格事件，命名精确区间及其启发式 token 价格；然后一条 `content` 为空的 `user/message`，带覆盖该区间的 `replace` surface 操作、引用 prune 事件与每个被遮蔽节点的 `sourceEventSeqs`，以及来自 `@deepseek-ai/dsh-compaction/checkpoint` 的 `contextRemovalSource` 来源（`removalId`、`turns`、`promptSeqs`）。`Session.deriveEventMessage` 把空 user 节点投影为无消息，因此 surface 在该位置保留一个节点，而请求历史失去该区间。token meter 的投影消费相邻的声明，上下文压力按定价区间下降。

### 区间解析

一次正向日志扫描收集所请求回合的边界和持久锁状态（未结束回合、未闭合的 compaction 括号，在 `session/end-seed` 处重置）。每个 surface 节点相对回合范围被归类为内部、外部或共享；共享节点是引用的 surface 事件跨越该范围的 compaction 摘要，这使该回合无法单独移除。先前的移除检查点算作外部，因此已移除的回合读作不存在。区间两端必须通过 `toolPairingBalancedBefore` / `toolPairingBalancedAfter`。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `ContextRemovalExecutor`（`ctx.contextRemoval`）、`ContextRemovalError`、区间解析与两事件提交 |
| [`src/types.ts`](src/types.ts) | `ContextRemovalAgentContext`、错误代码、`ContextRemovalGroup`、`ContextRemovalResult` |
| — | 不发布运行时不变量伴随；compaction 伴随校验 `compaction/prune` 区间，Session 校验每条替换。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Compaction 接缝](../compaction/README.zh.md)——拥有本包复用的检查点来源、工具配对平衡和影子价格协议。
- [工具结果裁剪器](../compaction-tool-result-pruner/README.zh.md)——同一协议上的另一个无模型替换生产者。
- [会话控制器](../../api/session-controller/README.zh.md)——基于本服务的 Web `session.removeTurns` 命令。
- [Token meter](../../llm/token-meter/README.zh.md)——为被移除区间定价并折叠影子价格。

-----

<a id="model-experience"></a>
## 模型体验

### 被移除的回合

#### 模型看到什么

移除后，后续请求不再包含被移除回合的 `user/message`、`assistant/message` 和 `tool/result` 投影；替换用的检查点 `content` 为空，投影为无线上消息，因此没有任何标记提示这一缺口。移除前构建的请求在日志中保持不变。

#### Token 影响

每次请求减少被移除区间的 token。该操作不调用模型。

#### KV Cache 影响

替换较早的历史会使从第一条被移除消息起的复用失效；最早被移除区间之前的前缀在路由、信封和前置历史保持一致时仍可复用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **只按整回合移除**——回合内的单条消息无法移除；单位是回合，因为工具调用与结果必须保持配对。
- **已压缩的回合不可选**——一旦 compaction 摘要把某回合与相邻回合一起压缩，摘要就是唯一可移除的单位，而本服务不提供它。
- **无撤销**——替换与 compaction 一样是已记录的 surface 操作；恢复被移除的回合需要新的替换生产者。

<a id="dev-note"></a>
### 开发者注记

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
