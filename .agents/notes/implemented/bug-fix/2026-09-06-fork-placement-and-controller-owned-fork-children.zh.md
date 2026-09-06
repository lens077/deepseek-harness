# Agent Note: fork placement 到达 wire，fork 子会话保持由控制器所有

Status: implemented

[English](2026-09-06-fork-placement-and-controller-owned-fork-children.md) | 中文

## 问题

上游重构把 Web 的 fork 与 delete endpoint 从 apiproxy 网关搬进了 `dsh-api-session-controller`，fork 契约有两处没有在搬迁中存活。

Client 端 `SessionManager.fork` 只发送 `sessionId` 与 `atSeq`。`ClientSessions.fork` 仍接受 `placement` 并把它展开进 manager 调用，但 manager 的参数类型没有这个字段，请求字面量也把它丢掉了，于是 Workspace 浏览器里的“新建嵌套子会话”到达 Host 时总是不带 placement，并作为平级挂入。Host 也丢掉了合并前 attach 的保护：`nested` 请求被直接交给 `workspace.attachSession(child, { nestUnder: source })`，而它会拒绝 Workspace 没有登记的来源——所有子代理来源都是如此，因为它们通过最近的拥有 Workspace 的祖先挂入。

Host 的 fork 命令直接通过 `ctx.agents.create` 创建子会话并丢弃返回的 handle。`ApiSessionAgentController.retire`——Workspace registry 在永久删除前调用的能力——只会 dispose 控制器自己持有的 handle，因此删除一个存活的 fork 子会话（或包含它的谱系）会以 `session "…" is live but not owned by the Session Controller` 失败。

## 决定

`SessionManager.fork` 像携带 `atSeq` 一样把 `placement` 带到 wire；wire 类型本来就声明了该字段。

fork 命令通过新增的 `ApiSessionAgentController.createSeeded` 发布子会话，走的是 `ensureSession` 与 `resolveAgent` 使用的同一条 `own()` 路径，因此控制器持有 Web 平面创建的每个 Agent 的 disposer。只有当 `workspace.sessionIds` 列出来源时才应用嵌套 placement；否则子会话取 sibling 槽位，恢复 `SessionForkRequest.placement` 上记录的合并前退化行为。

## 考虑过的替代方案

**不持有 handle，通过 `ctx.agents.get(id)` 注销。** 拒绝：registry 不为其他所有者发布的 Agent 暴露 disposer；按身份注销会让 Web 平面拆掉它从未创建的子代理所有或 ACP 所有的 Agent。

**对未登记来源的嵌套 fork 以 `workspace-attach-failed` 失败。** 拒绝：attach 运行时子会话已经发布，失败会留下一个浏览器随后按错误协调的 fork；sibling 槽位让操作保持全函数，与合并前一致。

## 后果

`session-fork.host.spec.ts` 钉住已登记来源的嵌套挂入、子代理来源的 sibling 退化，以及经由控制器 retire 路径的 fork 后删除；`sessions-service.client.spec.ts` 钉住 wire 上的 `placement`。测试 remote 新增 `delete`。

本次未改变：子代理的 fork 仍落在最近的拥有 Workspace 的祖先的 sibling 槽位（合并前行为，由 `subagent-conversation` Web e2e golden 钉住），Chat 与 Workspace 浏览器的调用方仍会吞掉 fork 失败。

## 相关

- [SessionStore fork API](../feature/2026-06-30-session-store-fork-api.zh.md)——该 endpoint 应用的 fork 边界与谱系规则。
