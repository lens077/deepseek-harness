# Agent Note: 不可逆的 Session 删除

Status: implemented

[English](2026-09-01-irreversible-session-deletion.md) | 中文

## 问题

归档只会隐藏 Session 并保留日志，删除 Workspace 注册记录也按设计保留所有 Session。这两项操作都不能让用户移除包含敏感内容的会话字节，也不能丢弃不再需要的 Session 谱系。破坏性操作必须同时明确所有权、实时工作拒绝规则、后代语义、崩溃恢复、Workspace 记账，以及两个持久化后端上的过期 client 行为。

## 决策

`session.delete({ sessionId })` 会永久删除目标 Session 以及 `SessionHeader.parentSession` 的完整传递闭包，包括普通 fork 与 subagent 后代。Workspace 注册表先从持久化、实时和已检查的 header 中构建完整谱系视图；若身份冲突或出现环，则拒绝操作；改变状态前会确定一份可复现的后代优先顺序。

注册表会先在内存中预留所有目标，再退役任何实时对象，从而阻止延迟的 attach 或 create 发布进入该子树。只有创建或恢复普通 Agent 的同一个 ApiProxy 实例持有准确 `AgentHandle` 时，空闲 Agent 才能退役。「恢复」包含共享 Agent 解析器为通用动词执行的隐式冷恢复，因此解析器会通过 `onResumed` 把它打开的每个 handle 交给拥有它的 Host。否则解析器就是唯一持有者，被普通读取带上线的 Session——在侧边栏打开一次即可——会保持实时却无法释放，无论当次还是此后都永远无法删除。ApiProxy 会在 `agent/disposed` 时释放 handle，并按 Agent 身份比对，使陈旧条目不会拒绝之后同 id 的新生命周期。存在运行中的 Agent、缺少该所有权能力的实时 Session，或退役后仍实时的任何目标时，整个请求都会在写入持久删除标记或开始物理删除前被拒绝。这样既保留进行中的工作，也避免删除路径擅自接管配置创建的 Agent 或由其他组件拥有的 subagent。

随后，注册表写入 `pendingMutation: { operation: 'delete-sessions', sessionIds }`。重启恢复会重放这份精确的后代优先列表。物理删除对已经缺失或仅惰性创建而未物化的 Session 保持幂等，因此进程在只删除一个前缀后崩溃，重试仍可收敛。确认所有产物都不存在后，注册表通过一次更新从所有 Workspace `sessionIds` 账户、全局归档集合、缓存 header，以及有效或无效路径索引中移除这些 id，并清除标记。Workspace 注册记录删除仍按 [Workspace 注册记录删除决策](2026-07-27-workspace-registration-deletion.zh.md)仅处理元数据。

`SessionPersistence.delete(id)` 是不可逆且不可取消的操作。协调器会等待退役完成，与该 id 的持久化工作串行执行，拒绝实时 owner 或独占 preparation，丢弃非独占 preparation，并返回是否存在已物化产物。JSONL 会删除完整的 Session 自有编码目录，不跟随符号链接或 junction，并在 POSIX 上同步保留的项目目录。SQLite 会执行 `BEGIN IMMEDIATE`、校验 schema、删除 `sessions` 行，依靠外键级联物理删除事件行，再以原子方式提交。

wire 使用 `host/session-deleted` 发布永久删除；`host/session-removed` 仍只表示进程内 detach。一元成功响应与 Host 帧都会携带完整的已提交 id 列表。client 保留进程生命周期内的 tombstone，移除所有以 Session 为键的投影、scope、目录、地址、交互、后台任务和 selection 条目，过滤过期列表响应，并忽略迟到的 Host 或 mux 帧。Sidebar 会在活跃和已归档 Session 行中提供删除操作。中文确认文案会区分归档与删除，说明持久化字节及所有可见后代都将不可逆地删除；等待期间不能关闭对话框，失败后对话框保持打开。

## 已考虑的替代方案

**只删除选中的 Session。** 不采用，因为 fork 或 subagent 日志可能保留同一份敏感历史；保留后代还会产生指向不存在身份的父级引用。完整传递删除符合用户对整个谱系的意图，并通过后代优先顺序支持可恢复清理。

**自动停止任意实时 Agent。** 不采用，因为 Session 出现在实时注册表中并不授予 dispose（资源释放）权限，而且为了执行破坏性请求而取消运行中的工作可能丢失尚未观察的输出。只有 ApiProxy 准确持有的空闲 handle 可以退役；其他任何实时目标都会在写入持久标记前导致拒绝。

**保留持久 tombstone，而不移除字节。** 不采用，因为产品要求删除持久化产物，而不是新增一种隐藏状态。进程生命周期 tombstone 只用于阻止过期 client 或延迟发布竞态，并非持久结果。

**从 Workspace 注册记录删除中级联。** 不采用，因为 Workspace 记录只拥有分组元数据，不拥有目录、用户文件或 Session 日志。单独命名的 Session 操作使用独立确认，并且绝不删除 Workspace 目录。

**为每个派生索引发送持久化层删除事件。** 不采用，因为持久化服务拥有产物，但不拥有所有派生存储。Workspace 自有索引由持久编排清理，可重建的 Session-query 索引会在下一次稳定观察时与持久化快照对齐；面向产品的已提交通知属于 Host wire。

## 后果

成功响应表示所选谱系的产物与 Workspace 引用已经消失，无法通过取消归档或重新连接恢复。该操作放弃只清理根 Session，也不删除运行中或由其他组件拥有的实时 Session；换来的是明确的所有权、重启收敛，以及已提交的字节移除保证。被删除的 id 在 Host 与浏览器进程的剩余生命周期内都不能复活；后续新进程可以复用缺失的 id，但普通创建会使用新的随机身份。
