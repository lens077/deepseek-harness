# Agent Note: Workspace 折叠在加载与揭示之间保持

Status: implemented

[English](2026-09-18-workspace-fold-persistence.md) | 中文

## Problem

拥有大量 Workspace 的用户发现每次加载时所有访问过的 Workspace 都是展开的，即使已经折叠过。侧边栏的 `groupExpansion` 记录已被持久化，但有两种机制会抹掉或覆盖折叠。其一，`defineStore` 整体恢复持久化值，因此每次新增状态字段都必须升级持久化键（`dsh.workspace.view` 经十二次升级到 `v12`，其中五次在一周之内），而每次升级都会丢弃用户设置的全部折叠、顺序与偏好。其二，[侧边栏揭示](2026-09-03-inbox-card-cap-and-sidebar-reveal.zh.md)会把 `setGroupExpanded(key, true)` 写入该持久化记录，持有当前 Session 而无记录的分组也被持久化为展开；于是在折叠的 Workspace 内打开置顶、摘要或搜索中的 Session 会永久撤销折叠。诊断时检查的一份 Firefox 配置在 `v12` 下有十四个 `true` 条目而没有 `false`，其过期的 `v11` 值却仍带有折叠。

## Decision

`createSnapshotStore` 以 `{ ...init, ...stored }` 恢复持久化的普通对象值（`packages/client/store/src/index.ts` 中的 `rehydrate`）；基本类型与数组仍整体恢复。新增字段可保留持久化键，因为新字段从其初始值开始；只有已有字段的含义或类型变化才升级键，`StoreSpec.persist` 的 JSDoc 声明了这条规则。合并保留初始值中没有的存储键，因此像 `SessionSelection`（初始值 `{}`）这样的可选字段 store 仍能恢复。

在 `SessionTree`（`WorkspaceBrowser.tsx`）中，`groupExpansion` 只记录用户的决定：点击区头切换，或从 Workspace 的 ＋ 新建 Session。临时的 `revealedGroups` 状态——与全部展开列表和折叠分支一样只在本次会话内有效——承载无记录时持有当前 Session 的分组以及每次揭示。`expandedGroups` 是持久化 `true` 记录与 `revealedGroups` 的并集；因此在显式折叠的分组内揭示会在本次访问中显示该行。折叠区头会把分组从 `revealedGroups` 移除并写入 `false`，所以折叠会隐藏当前 Session 的行（文件夹保留激活色），下次加载只从持久化的折叠开始。

## Alternatives considered

**保留整体恢复并停止升级键。** 之后新增的必需字段在运行时会读到 `undefined`，整体恢复规则正是为此而存在；合并则消除了升级的理由。

**只合并初始值中的键。** 会丢掉初始值没有的存储键，破坏初始值为 `{}` 且带可选字段的 store；保留所有存储键最多只是在下次写入前留下一个过期键。

**手风琴模式（展开一个 Workspace 折叠其余）。** 改变了所有用户的模型，而不是尊重该用户设置的折叠；它仍可作为持久化记录之上的视图选项实现。

**当前 Session 离开时把揭示的分组折回。** 会关闭用户仍在阅读的 Workspace；揭示持续到用户折叠或重新加载，与其他临时状态一致。

## Consequences

- 折叠、顺序与偏好在新增 store 字段的客户端升级后仍然保留；升级持久化键现在是为不兼容字段变化保留的有意重置。
- 从置顶区、摘要或搜索打开的 Session 仍会变得可见，但其 Workspace 在下次加载时回到持久化的折叠。
- `workspace-browser.client.spec.tsx` 固定了临时揭示、未被触碰的记录、隐藏当前行的折叠以及从持久化折叠开始的重新挂载；`store.client.spec.ts` 固定了合并、可选字段恢复与数组整体恢复。
