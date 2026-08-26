# Agent Note: 从 session.history 页面中过滤已被取代的 assistant 分片

Status: rejected — 传输层已经压缩，过滤已被取代的分片对历史页面只带来 1.73x 收益（在 2.8 Mbit/s 链路上约 280 ms），却要打破已写入文档的连续区间性质，并牵动宿主、客户端、端到端与快照的大范围改写。

[English](2026-08-25-history-page-chunk-filtering.md) | 中文

## 问题

经隧道式反向代理读取会话，瓶颈在带宽而非延迟：某个此类部署实测代理到浏览器约 2.8 Mbit/s，而其后的隧道有 40 Mbit/s，因此线上字节直接换算成等待时间。

重会话的 `session.history` 尾页为 7513 个事件、2.4 MB，其中 7283 个是 `assistant/chunk`，占 1,986,989 字节——原始页面的 77.7%。这 7283 个分片全部被同一页某条已完结 `assistant/message` 的 `sourceEventSeqs` 引用，客户端折叠之后随即丢弃。`paginate`（`packages/host/apiproxy/src/api-proxy.ts:228`）在 `:252` 以 `window.filter(event => event.seq >= cut)` 产出页面：一段连续的原始区间，不按类型过滤。

## 提案

当某个 `assistant/chunk` 的 `seq` 出现在同一页某条已完结 `assistant/message` 的 `sourceEventSeqs` 中时，将其从历史页面中丢弃。持久日志保留全部分片，收窄的只是 RPC 投影。

## 历史页面实际被用来读什么

对已完结的消息，客户端折叠采取覆盖而非合并：收到 `assistant/message` 时 `update` 整体替换 `blocks` 与 `usage`（`packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts:265-272`），`projectAssistant` 随后优先取已定型节点的 blocks、seq 与 time。完结后唯一存活的分片派生值是 `firstTokenTime`，它只在 `:128-130` 被记录、在 `:163` 被读取，并支撑 `packages/client/ui-conversation/src/client/chat/turn-metrics.ts:42-47` 中的首字延迟与解码墙钟时间。`turn-tail.ts` 看似依赖分片，其实不然：`:86` 在消息落地时把 `streamedText` 重置为 false，而 `:96` 只在未完结的 step 上读取它。

再无其他消费者从历史页面读取分片。搜索将其排除（`packages/session-query/session-query/src/extraction.ts:34` 返回空串），日志导出经 `readRaw` 直接输出持久产物（`packages/host/apiproxy/src/session-export.ts:243`），`llm-replay` 直接从会话文件推导脚本（`packages/test-support/llm-replay/src/index.ts:280`），`sessionStats` 中的首字延迟聚合值折叠的是实时日志（`packages/session/session-stats/src/projection.ts:195`），两个 SDK 投影的都是实时事件流而非历史。没有被任何消息引用的分片——即真正被中断的流——不属于已被取代，会留在页面上，这正是中断记录仍可渲染的原因。

## 实测收益

对一个真实尾页重新序列化（7513 个事件、42 条已完结消息、42 个 usage 分片）：

| 页面 | 原始 | gzip | gzip 相对现状 |
|---|---|---|---|
| 现状 | 2,553,490 | 233,105 | 1.00x |
| 丢弃全部已被取代的分片 | 559,218 | 134,467 | 1.73x |
| 每条消息保留首个 token delta | 568,469 | 135,261 | 1.72x |
| 保留首个 token delta 与 usage 分片 | 576,771 | 135,936 | 1.71x |

原始字节下降 4.6x，压缩字节只下降 1.73x：分片事件高度重复，deflate 窗口早已捕获了该过滤器本可移除的大部分冗余。在 2.8 Mbit/s 链路上即 666 ms 对 384 ms——每次打开会话约 280 ms。对压缩传输而言，原始字节占比是错误的估算量，催生本提案的那个 77.7% 把它的价值高估了约四倍。

## 考虑过的替代方案

- **每条已完结消息保留其首个 token delta**（上表第三行）——对唯一真实依赖最省的完整解法：`firstTokenTime` 仅为首个 token delta 记录（`assistant.ts:128`），因此恰好保留该事件即可逐字节保住它，也包括 `resetForRetry` 跨 `llm/retry` 携带重试前时间戳的语义（`:72-78`）。代价是 42 个事件、794 个 gzip 字节，且无需改动会话日志或 `HistoryEntry.view`。它并非因自身缺陷被否决，而是随整个提案一同被否决，因为它同样只换来 1.72x。
- **在 `assistant/message` 上携带 `firstTokenTime`，或将其计算进 `HistoryEntry.view`**——否决：两者都为取回一个上述方案已免费保住的值而扩大持久或线上契约。
- **调低 `PAGE_MESSAGES`**（`packages/client/runtime/src/client/sessions/session.ts:32`，当前为 50）——一个常量即可换来同一量级的节省：同一会话在 30 时实测 1.57 MB 原始字节，在 10 时为 313 KB。它以首屏记录深度换取字节，与本 Note 正交，作为更省事的杠杆继续可用。
- **不做**（已采纳）——与本次调查一并落定的两项边缘修复，即反向代理侧的响应压缩与插件产物的条件重校验，已经消除了主要成本；参见[插件产物重校验](../../implemented/bug-fix/2026-08-25-plugin-bundle-revalidation-etag.zh.md)。当前远程打开一次会话约需一秒，历史页面占其中约 666 ms，而这 280 ms 抵不上下述影响面。

## 我们放弃了什么

已上线行为没有任何损失；提案本会付出的代价正是它落选的原因。

`paginate` 将不再产出一段连续的原始区间，而 `packages/host/apiproxy/README.md:27` 陈述了该性质，压缩流程也依赖它把 `compaction/summary` 记录留在引用它的替换所在页面上。约二十个宿主与客户端规格断言页面携带分片——`packages/host/apiproxy/tests/api-proxy-view.spec.ts:294` 追加 128 个分片并在 `:307` 引用它们——六个以上浏览器端到端测试对来自 `session.history` 的分片计数，加载历史类场景的 `ui.expected.md` 基准也需重录。

动手前还须先解决两个问题：过滤后页面的首个存活事件位于 `cut` 之上时，`hasMore` 与 `beforeSeq` 分页是否仍然正确（`api-proxy.ts:253` 返回 `hasMore: cut > 0`，客户端按窗口基准 seq 翻页）；以及不带 `sourceEventSeqs` 的历史 `assistant/message` 会让其分片不被过滤，导致该投影在不同日志上并不一致。

## 相关

这一想法更宽的形式——从持久日志中删除 `assistant/chunk`——已在[仅持久化组装后的 assistant 消息，不存储流式分片](../simplification/2026-06-20-assembled-assistant-messages-only.zh.md)中被单独否决。该 Note 的阻塞项，即高保真回放与失败流的部分输出依赖持久化分片，在此并不适用：本提案只收窄 RPC 投影，日志原样保留。它败在收益上，因此两份 Note 互不取代。

分页早已把分片溯源当作承重结构：[大体量历史的溯源扫描不使用参数展开](../../implemented/bug-fix/2026-08-04-large-history-pagination-call-stack.zh.md)逐个元素遍历 `sourceEventSeqs`，并否决了在分页中截断它——那会把页面切在消息内部，破坏重放分组。
