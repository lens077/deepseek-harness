# Agent Note: 会话归档（注册表级全局集合）

Status: implemented

[English](2026-07-31-session-archive-global-set.md) | 中文

## 问题

Sidebar workspace 浏览区的会话行菜单里，「Delete session」一直是纯视觉占位（无 handler）。产品口径定为**归档**而非删除：会话日志与 workspace 记账都不动，只把该会话从所有分组视图（workspace 分组、Ungrouped、搜索、平铺列表）里隐藏。归档记录需要一个落点：Ungrouped 的会话不属于任何 workspace 实体，per-workspace 字段放不下它。

## 决策

**归档集合是 workspace domain 全局单例（`workspaceDomainState.archivedSessionIds`）上的一个新字段，覆盖在 workspace 记账之上；显示过滤全部收敛在 client 的 `tree.ts` 派生层；wire 面走全快照姿态。**

- 存储：`archivedSessionIds: z.array(sessionId).default([])`，domain version 保持 2——纯新增字段；旧介质经 schema default 解析为空集合，无需迁移代码。被归档的会话保留其 `sessionIds` slot，因此取消归档后会回到原记账位置，归档集合也不会触及「一个会话只由一个 workspace 记账」的不变式。
- 注册表：`ctx.workspaceRegistry.archiveSession(id)` 和 `unarchiveSession(id)` 都通过 `enqueueOperation` 与所有注册表变更串行执行。归档目标必须是实时或已持久化的会话，否则抛出 `WorkspaceUnknownSessionError`；目标已在集合中时，不写入也不发事件。取消归档会移除集合成员；若 id 不在集合中（包括未知 id），则作为不写入的空操作完成，使过期归档条目仍可清除。`archivedSessionIds` getter 暴露按 Host 顺序排列的只读集合。
- RPC：`workspace.archiveSession({sessionId})` 和 `workspace.unarchiveSession({sessionId})` 都以 `{archivedSessionIds}` 应答更新后的完整集合。`workspace.list` 响应携带该集合作为重连基线；`host/archived-sessions-changed` 会在每次持久变更后推送完整快照（与 `host/workspace-changed` 采用相同方式，从 `domain/changed` 的 global put 分支比较集合后推帧）。未知归档目标复用 `session-not-found` 错误码；取消归档保持目标状态幂等。
- client 运行时：`WorkspaceListState.archivedSessionIds` 是按 Host 顺序排列的 `readonly SessionId[]`，仅在成员变化时更换引用。公有快照状态保持 store 引擎的纯数据类型，因为未启用 MapSet 插件时，immer draft 不接受 Set；成员查询在派生函数中建立临时 Set。list 基线、两项一元回声与 changed 帧都会安装完整集合。投影层会在当前 selection 落入归档集合时统一清空为 New Session 视图状态；同一规则覆盖本地归档回声、其他标签页的 changed 帧，以及重连基线恢复出客户端离线期间被归档的 selection。取消归档不会重新打开 Session。若帧或回声在 `workspace.list` 请求进行期间到达，则更新后的集合（包括成员移除）不会被过期基线覆盖。
- UI：活跃 Session 行提供非 danger 样式的**归档会话**操作，不显示确认对话框。`tree.ts` 通过同一判据从 workspace 分组、Ungrouped、搜索和单列表中滤除归档成员。**已归档**视图遵循 Host 集合顺序，保留 Workspace 上下文和顶层空白行，隐藏来源为 subagent 的行，并且只提供**取消归档**操作。操作成功后，该行保持忙碌状态，直到完整集合投影将其移除；操作被拒绝时，行内会保留可重试的错误信息。

## 已考虑的替代方案

**per-workspace archivedSessionIds（最初表述）。** 否决：Ungrouped 会话无落点；用户改口全局。

**SessionSummary 打 archived 标（session.list 层）。** 否决：要把 workspace domain 事实 join 进 sessions domain 投影，summary 无增量帧还得另发通知，跨域耦合大于收益。

**host 侧在 `workspaceView`/`sessionIds` getter 过滤。** 否决：归档 ≠ 改记账，投影过滤会把两个概念搅浑；未来恢复入口也需要 client 拿到全量记账。

**增量帧（archived/removed 单条）。** 否决：集合极小、变更频率低，全快照免去 client 侧合并逻辑与去重状态，与 workspace-changed 现有姿态一致。

## 后果

已归档 Session 仍存在于 Session 列表与 Workspace 记账中，但只能通过专用的已归档视图访问；该视图中的行不能打开、选中、重命名、fork 或重排 Session。`workspace.list` 响应变更仍是 pre-release 直改，不提供兼容层。workspace-management e2e 覆盖归档、重载恢复、查看已归档会话、取消归档、恢复原位置与再次重载。domain 层测试覆盖两项变更的幂等性、归档未知 id 时的拒绝、取消归档缺失 id 时的容忍、跨重启恢复与旧介质默认升级。
