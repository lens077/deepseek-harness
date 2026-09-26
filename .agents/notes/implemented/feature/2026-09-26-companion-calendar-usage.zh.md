# Agent Note: 小助手日历用量预览

Status: implemented

[English](2026-09-26-companion-calendar-usage.md) | 中文

## 问题

详细用量抽屉适合查账，却会打断对今天活动的快速查看。累计会话总量无法回答今天、本周或本月的问题：会话跨越多个日期，重试增加流量，fork 保留继承历史。日历摘要还需要一个明确的时区，并区分历史缺失与没有记录到用量。

## 决策

小助手的本地化**用量速览**按钮直接打开紧凑的非模态浮层。**今天**、**本周**和**本月** pill 用于选择已发现会话的 token、上报用量的请求数与估算费用。**查看详情**以「全部会话」范围打开既有累计用量抽屉，选中会话后仍可查看「本会话」和「会话树」。主 Chat 用量抽屉和 token 回退保持独立，行为不变。

[ui-companion](../../../../packages/client/ui-companion/README.zh.md)负责触发按钮、视口范围内的锚定位置、关闭行为，以及跨重新挂载保留的周期状态。浮层不提供遮罩，不使应用背景 inert，也不限制焦点范围；在外部操作指针、按 Escape 或点击关闭均可收起。[ui-chat](../../../../packages/client/ui-chat/README.zh.md#session-usage-and-cost)通过 `companion.usage.panel` 提供预览与抽屉内容，跨包依赖仅用于类型。预览的分钟时钟仅在挂载时存在，因此已打开视图可跟随日期切换，无需后台轮询服务。

### 按日期记录本会话请求

[session-stats](../../../../packages/session/session-stats/README.zh.md)在累计记账旁负责按日期折叠。Host 校验的 `calendarTimeZone` 接受 IANA 时区，默认使用 `UTC`；部署可选择 `Asia/Shanghai`。账本状态使用 `stateVersion: 3` 并保留时区。恢复其他时区的检查点会校验失败，而不是给日期换标签；源事件重放会重建这些日期。

可选的 wire 字段 `calendar` 包含 `timeZone` 和按日期升序排列的 `days`。每个日期行在 `UsageBuckets` 基础上增加 `date`、`requests`、`incompleteRequests`、`unreportedAttempts`、`unpricedRequests`，以及可选的 `estimatedCost` 和 `observedCost`；费用使用所属账本的币种。日期是公历 `YYYY-MM-DD` 值，根据持久 Assistant 结算时间、压缩摘要时间或未结算步骤的关闭时间确定。每次重试结算和已记录的压缩请求只贡献一次；组装样本和嵌入样本仍互为替代，fork 继承前缀不贡献用量。累计记账与 UTC 价格分层语义保持不变。

[客户端周期汇总](../../../../packages/client/ui-chat/src/client/chat/usage-period.ts)使用投影时区、周一开始的周和日历月，所有范围均截止今天，排除未来日期。持久 Session id 会去重，当前实时投影覆盖列表快照。汇总绝不按 `session.updatedAt` 确定流量日期，不重新分配累计总量，不查询后端总量，也不回填历史会话。

缺少日历、时区不匹配或发现尚未完成均会明确披露。没有可用日历时，预览显示破折号而非虚构的零值。已知的部分流量仍显示并附带警告；快照缺失、用量不完整或未上报、请求未定价、币种混合时，隐藏完整费用。可用日历中缺少某个日期，表示该日没有记录到本会话请求用量，不证明提供方没有活动。

### 决策所有权

本记录部分替代[小助手用量菜单决策](2026-09-26-companion-usage-menu.zh.md)：菜单入口由直接日历预览替代，但 slot 所有权、既有详细抽屉和未选中会话时的记账仍有效。[本会话请求治理](2026-09-12-own-request-usage-governance.zh.md)继续负责累计记账和建议性策略。[休息小助手](2026-09-26-rest-companion.zh.md)和[可拖动小助手](2026-09-26-draggable-rest-companion.zh.md)继续负责角色与位置决策。没有相关记录被完全替代。

## 考虑过的备选方案

**按会话更新时间或累计总量划分日历周期。** 最近的标题或消息可能让旧流量看起来属于当前日期，而会话本身也会跨越多个日期。按日期记录本会话请求可保留请求的实际记账日期。

**每次查看用量都打开详细抽屉。** 模态抽屉保留排查深度，但查看三个主要数值无需限制焦点或占用较大空间。直接打开非模态预览可保持对话可用。

**打开预览时查询或回填全部历史会话。** 预览只读取可用投影，不是新的总量服务或加载历史的流程。快照缺失仍是可见限制，而不是隐藏工作或虚构的零值。

**合并不同时区的日期，或在更改时区后继续使用旧检查点。** 仅凭日期标签无法转换时区。Host 拒绝时区绑定已过期的状态，客户端披露不匹配的快照，而不是合并不兼容的周期。

## 影响

日历查看保持紧凑，不改变模型调用、Session 事件或既有累计用量抽屉。存储随产生用量的日期增长，并保留路由／小时分桶以按当前价格表估价，不表示提供方账单或历史价格变更。冷快照在普通投影生命周期刷新前可能仍不可用或过期。预览有意减少细节，无法证明完整的提供方支出。

## 验证

[账本测试](../../../../packages/session/session-stats/tests/usage-ledger.spec.ts)和 [Loader 测试](../../../../packages/session/session-stats/tests/loader-composition.spec.ts)负责日期归属、时区校验、过期检查点拒绝、重试与压缩计数、fork 排除和定价完整性。[周期测试](../../../../packages/client/ui-chat/tests/usage-period.client.spec.ts)负责日／周／月范围、跨年和夏令时边界、未来日期排除、去重、缺失日历、时区不匹配与费用隐藏。

[小助手交互测试](../../../../packages/client/ui-companion/tests/companion.client.spec.tsx)、[入口测试](../../../../packages/client/ui-companion/tests/menu.client.spec.tsx)和[适配器测试](../../../../packages/client/ui-chat/tests/companion-usage.client.spec.tsx)覆盖直接入口、周期选择、焦点恢复和详细抽屉复用。适配器测试覆盖跨午夜刷新与定时器清理；[浮层测试](../../../../packages/client/ui-companion/tests/popover.client.spec.tsx)覆盖内外部指针关闭行为及监听器清理。组合后的[小助手](../../../../apps/web/tests/companion.e2e.ts)与[用量治理](../../../../apps/web/tests/usage-governance.e2e.ts)场景负责浏览器集成和记录的 UI 证据。这些链接说明验证职责，不声称某次运行或新的浏览器快照已经通过。
