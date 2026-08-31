# Agent Note: 显式创建 Ungrouped scratch Session

Status: implemented

[English](2026-09-01-ungrouped-scratch-session.md) | 中文

## 问题

Web client 原本必须选择或注册 Workspace 才能开始，但 Host 已支持 `session.create({})`，并会为其分配默认 cwd。无 Session 的 Hero 因此把目录选择当成进入可用编辑器的唯一路径；与此同时，其他前端在 Host 默认 cwd 创建的 Session 本就可以不进入任何 Workspace 记账，并显示在 Ungrouped 下。

client 需要一条显式开始操作：它必须保留 [Host 实体 Session 与 Agent scope 的对等模型](../architecture/2026-07-25-web-client-session-scope-and-provide-channel.zh.md)，不得根据 cwd 推断 Workspace 成员关系，还要在实体化期间保留常驻 InputHub 草稿。

## 决策

Hero Workspace 界面在 Workspace 选择项旁提供**不选目录，直接开始**。`WorkspacePicker` 负责该操作的等待与失败呈现，并调用 slot owner 的 `onStartScratch`；当前空白 Session 已在 Ungrouped 时隐藏该操作，避免重复点击创建另一个不可见的空白 Session。

owner 将请求交给 `IWorkspaces.createScratchSession()`。`WorkspaceRuntime` 调用不带 `workspaceId` 的 `sessions.create()`，由 Host 应用默认 cwd，并让该 Session 保持在所有 `WorkspaceView.sessionIds` 记账之外。该方法返回已可寻址的 Session id，但不负责导航。`ui-conversation` 拥有导航，并让 Workspace 选择与 scratch 创建共用一条交接路径：先连接或创建目标，尽可能搬移当前空白 Session 的草稿与暂存图片 id，再调用 `sessions.open(nextId)`。

编辑器是否惰性只取决于 Session 是否缺席。空白 Session 一旦实体化，无论归属 Workspace、留在 Ungrouped，还是原有 Workspace 记账已消失，都使用普通的可用输入界面。该决策部分取代 [Session scope note](../architecture/2026-07-25-web-client-session-scope-and-provide-channel.zh.md)与[编辑器 picker 入口 note](2026-08-07-workspace-picker-composer-entry.zh.md)中关于实体化路径的前提；其中的 scope、常驻 DOM 与 picker 触发决策仍然有效。

## 考虑过的替代方案

**在 Session 出生前创建 client-only scratch 草稿。** 这会引入第二套生命周期与身份轴。Host 已能原子创建 Session、Agent 与 cwd，因此 client 继续只镜像该实体。

**自动把 Host 默认 cwd 注册为 Workspace。** cwd 相等不代表 Workspace 成员关系。自动注册会污染持久 Workspace 列表，并违反 Host 以 `sessionIds` 表示的显式记账。

**复用 cwd 相同的任意空白 Session。** Ungrouped Session 不得通过推断变成 Workspace 成员；重复执行 scratch 操作也不应悄然选中其他进程创建的空白 Session。scratch 创建是显式操作，并始终创建新的 Host 实体。

## 后果

用户无需授权或选择目录即可开始聊天。Session 使用 Host 默认 cwd，在产生内容后显示于 Ungrouped，并完整支持 Session scope 的编辑器功能。Workspace 列表与成员关系保持不变。

运行时测试固定不带 `workspaceId` 的请求与可寻址响应；组件和组合测试固定操作可见性、等待与失败状态、草稿交接、导航和 Ungrouped 编辑器可用性。组装后的无密钥 Web 场景验证可见入口、Host 默认 cwd、可编辑输入区，以及 Session 不进入 Workspace 记账。
