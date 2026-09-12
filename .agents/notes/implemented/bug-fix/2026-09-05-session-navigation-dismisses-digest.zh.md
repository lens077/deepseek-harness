# Agent Note: 显式 Session 导航关闭汇总覆盖层

Status: implemented

[English](2026-09-05-session-navigation-dismisses-digest.md) | 中文

## 问题

汇总覆盖层独立于当前 Session selection 持有自己的打开状态。汇总卡片上的操作会先关闭覆盖层再打开 Session，但左侧栏会话行、搜索结果、工作流链接及其他导航界面直接调用共享的 Session 运行时。这些调用可以选中对话，却让汇总继续覆盖在对话上方。

再次打开当前 Session 时，`SessionListState.current` 的值保持不变，因此 selection 观察者无法区分用户的导航请求与没有操作。对话虽已选中，仍被覆盖层遮住。

## 决定

客户端运行时在 `SessionRuntime.open()` 或 `openSubagent()` 校验目标并完成 selection 后发出带类型的 `sessions/navigated` 事件。该事件表示成功的显式导航请求，而不是 selection 发生变化，因此重复请求当前 Session 也会再次发出。启动恢复、重连后重新显现及被动列表投影不会发出该事件。目标被拒绝时会先抛错，不会发出事件。

`@deepseek-ai/dsh-client-ui-digest` 在插件生命周期内订阅该事件，并在事件到达时关闭共享的汇总视图 store。功能仍拥有自身可见性；通用 `center.overlay` slot 与 ui-layout 不承载汇总专属策略。`TestSessions` 同步模拟该事件，使客户端功能测试观察到与生产运行时相同的导航语义。

## 考虑过的替代方案

**观察 `SessionListState.current`。** 否决：该值表示 selection 状态，而不是导航意图。它无法报告对当前 Session 的再次点击，而这正是故障场景。

**在每个导航界面中关闭汇总。** 否决：每个打开方都会依赖汇总功能，漏掉任一调用方都会使缺陷重现。运行时方法已经集中处理成功的显式 Session 导航。

**把覆盖层可见性移入 ui-layout。** 否决：ui-layout 声明的是通用组合 slot，各覆盖层自行决定是否渲染。把某一功能的打开状态集中到这里，会让外壳依赖汇总策略，同时仍然需要导航信号。

## 后果

每次成功的显式 Session 打开都会关闭汇总，包括再次点击左侧栏中已选中的会话行，以及通过目录地址打开 subagent。被动恢复不会改变持久化的汇总状态。事件同步分发，因此监听器保持不抛错；汇总监听器只执行一次 store 操作。功能导航继续通过 `open()` 或 `openSubagent()`，而不直接修改 `SessionManager` selection。

运行时单元测试固定重复成功请求会发出事件、失败请求不会发出；汇总插件测试固定关闭行为与监听器销毁；无密钥的 navigation-panes 浏览器场景固定原始左侧栏交互。

## 相关

- [跨工作区已完成会话汇总](../feature/2026-09-01-cross-workspace-finished-session-digest.zh.md)负责覆盖层与视图 store 设计。
- [汇总卡片高度上限与侧栏揭示外部打开的会话](2026-09-03-inbox-card-cap-and-sidebar-reveal.zh.md)负责 Session selection 值变化时的树揭示与多选行为。
