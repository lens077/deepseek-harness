# Agent Note: 从小助手菜单打开既有用量视图

Status: implemented

[English](2026-09-26-companion-usage-menu.md) | 中文

## 问题

小助手需要一个显式的 DSH 用量入口，但不能替换角色交互或另建一套记账实现。没有选中会话时，用量视图仍有价值，但此时既没有当前账本，也没有治理策略。

## 决策

菜单入口决策被[日历用量预览](2026-09-26-companion-calendar-usage.zh.md)部分替代：独立的**用量速览**按钮直接打开紧凑预览，**查看详情**以「全部会话」范围打开既有抽屉。选中会话后，抽屉仍提供「本会话」和「会话树」。角色点击、拖动、收起、归位和本地动效偏好保留各自行为。

[ui-companion](../../../../packages/client/ui-companion/README.zh.md)拥有 `companion.usage.panel` 子 slot，其基数为 `single`、作用域为 `session-maybe`，owner props 传递所需日历周期或详细范围、范围切换与关闭。[ui-chat](../../../../packages/client/ui-chat/README.zh.md#session-usage-and-cost)通过感知声明的注入注册私有适配器。Chat 对小助手只有用于类型的开发依赖；两个包都不在运行时导入对方。抽屉只在打开时挂载，关闭后焦点回到持续存在的用量按钮。打开状态保存在小助手状态存储中，响应式重新挂载会保留视图。缺少提供方时，在非模态预览中显示不可用提示。

适配器复用 `UsageLedgerDrawer`、汇总逻辑、本地化文案，以及缺失、待完成、未定价和冷快照警告。全部会话读取已发现的列表投影，不创建或选择会话，不虚构账本，也不从其他会话推断策略。此入口不新增后端调用或聚合服务。[本会话请求用量治理](2026-09-12-own-request-usage-governance.zh.md)继续拥有记账和建议性策略。

这是对[休息小助手](2026-09-26-rest-companion.zh.md)的增强，不替代其本地状态、内置图片或不调用模型的保证。[可拖动小助手决策](2026-09-26-draggable-rest-companion.zh.md)继续负责位置。这些相关决策保持有效，没有任何一项被完全替代。

## 考虑过的备选方案

**用角色点击打开用量。** 独立入口保留状态循环，以及点击和拖动的区别，紧凑布局也不例外。

**将 Chat 组件导入小助手，或在小助手内复制记账逻辑。** 子 slot 让小助手不依赖 Chat 的运行时值，并让既有所有者继续负责记账、警告和抽屉行为。

**为全局用量创建占位会话，或借用其他账本的策略。** 发现过程提供可用观测，不授予虚构当前会话或其治理设置的权限。缺失数据仍明确呈现。

## 影响

用量在输入区之外获得导航入口，不改变模型请求或会话历史。额外的用量按钮会占用小助手空间，全部会话总量仍受已发现快照限制，不代表完整的提供方账单。未加载用量提供方的部署保留角色控件，但无法通过该 slot 显示用量。

## 验证

[小助手交互测试](../../../../packages/client/ui-companion/tests/companion.client.spec.tsx)负责用量入口可用性及其与角色控件的分离。[适配器测试](../../../../packages/client/ui-chat/tests/companion-usage.client.spec.tsx)和[汇总测试](../../../../packages/client/ui-chat/tests/usage-rollup.client.spec.ts)负责未选中会话时的聚合、缺失策略和不完整数据披露；[注册测试](../../../../packages/client/ui-chat/tests/chat-apply.client.spec.tsx)负责感知声明的注册内容释放。

组合后的[小助手场景](../../../../apps/web/tests/companion.e2e.ts)负责键盘入口、未选中会话时的全局用量、焦点恢复、紧凑布局和保留的角色交互。[用量治理场景](../../../../apps/web/tests/usage-governance.e2e.ts)负责持久化会话／会话树／全部会话范围的集成及不确定性披露。以上说明验证职责，不记录测试已通过。
