# Agent Note：从提问面板按回合移除上下文

状态：已实现

[English](2026-09-22-per-turn-context-removal.md) | 中文

## 问题

长会话会累积人类不再希望模型考虑的回合——一个错误方向、一段调试弯路、一个在别处已回答的问题。缩小模型历史此前只有两种途径：compaction 把保留尾部之前的全部内容压成摘要，且范围由它自己选择；`session.fork` 把一段前缀复制到新会话，并丢掉切点之后的一切。两者都不能让读者指着第 3 个和第 5 个提问说"模型不该再看到这些"，而追加式日志又禁止删除它们。

## 决定

**移除是 surface 替换，不是删除。** 每一组连续的选中回合被一条 `content` 为空、带覆盖该组区间的 `replace` surface 操作的 `user/message` 替换，它引用一条 `compaction/prune` 影子价格事件和每个被遮蔽节点。`deriveEventMessage` 把空 user 节点投影为无消息——与空系统提示词、仅承载用量的 assistant 消息遵循同一规则——因此 surface 在该位置保留一个节点，而请求历史失去该区间。不需要新的事件类型、surface 操作或格式版本；token meter、compaction 不变量、重放和 Client 的 surface 折叠都消费既有协议。

**单位是整个回合。** 一个回合的区间是事件位于其 `turn/start` 与 `turn/end` 之间的所有当前 surface 节点，加上其引用的 surface 事件全部位于其中的替换副本（被裁剪的工具结果）；两端都必须工具配对平衡。移除单条消息会让工具调用或回答变成孤儿；移除一个回合则移除一个提问以及循环为回答它所做的一切。

**检查点来源放在 `dsh-compaction/checkpoint`。** `contextRemovalSource(removalId, turns, promptSeqs)` 与 `isContextRemovalSource()` 与 compaction 检查点并列，位于 Host 与 Client 程序已经共享的无 Cordis 叶子模块中，因此 Web GUI 无需新的跨聚合项目引用即可识别移除，执行器包也保持仅 Host。

**执行器是 host 平面服务 `ctx.contextRemoval`**，位于 `packages/compaction/context-remove`。它像 `/compact` 一样在 `agent.runMaintenance` 内运行，用一次日志扫描和当前 surface 校验每个请求的回合，然后不让出控制地追加所有组：要么每组都落地，要么什么都不变。它拒绝未闭合的 compaction 括号、持久未结束的回合、未知或未完成的回合、已移除的回合，以及区间与其他历史共用 compaction 摘要的回合。会话控制器把它暴露为 `session.removeTurns`，把拒绝映射为 `session/agent-busy` 与 `session/turn-remove-unavailable`。

**提问面板拥有选择。** Chat 提问面板新增逐行垃圾桶入口（单选）和带复选框行与一个移除按钮的选择模式（多选）；两者都在面板内联确认，因为面板在外部指针按下时关闭，面板外的确认会在指针下被关掉。回合仍在进行、未载入、已移除或已压缩的行不可选，提示说明原因。移除后 transcript 保留每一行：被移除回合的行通过流项上的 `data-context-removed` 以降低的不透明度渲染，一条标记行显示检查点落在何处。

## 考虑过的替代方案

**新的 `{ op: 'remove' }` surface 操作。** 拒绝：它会扩展封闭的 `SurfaceOp` 联合、折叠、每个替换消费方和持久化格式，而空节点投影已经表达了这一语义。

**从日志删除事件。** 拒绝：日志按契约只追加，重放必须重建每个已发送的请求，人类 transcript 必须保留读者看到过的内容。

**移除单条消息。** 拒绝：带工具调用的孤立 assistant 消息或孤立工具结果离开后会破坏提供方要求的配对；回合是让历史保持良构的最小单位。

**带自己影子价格的 `context/remove` 标记事件。** 拒绝：token meter 需要学习第三种计价事件；`compaction/prune` 已经为任何无模型替换陈述精确区间价格，检查点来源携带 transcript 需要的回合身份。

## 测试

`packages/compaction/context-remove/tests/context-remove.spec.ts` 在分离会话上覆盖执行器（单组、相邻合并组与分离组；第一回合受保护的系统头；工具配对；被裁剪的工具结果；每类拒绝；取消与失败的检查点），并通过带不变量伴随的真实循环检查下一次模型请求丢弃被移除回合、日志的全新折叠复现相同历史。`loader-composition.spec.ts` 通过 Loader 启动插件。`session-remove-turns.host.spec.ts` 覆盖控制器的校验与错误映射。`question-navigator.client.spec.tsx` 覆盖单选与多选移除、确认、拒绝、已移除行标记和选择被丢弃；`conversation-node-definitions.client.spec.ts` 覆盖标记节点；`turn-summary.client.spec.ts` 覆盖已移除/可移除推导；`apply-inject.client.spec.tsx` 覆盖远程绑定。

## 后果

- Client 的 `session.removeTurns` 需要挂载 `@deepseek-ai/dsh-context-remove`；web-app bundle 在 host 平面 token meter 旁挂载它，未挂载的部署回答 `gateway/internal`。
- 被 compaction 压缩的回合不可选；摘要是仅剩的单位，本功能不提供它。
- 与任何 surface 替换一样，移除会使提供方从第一条被移除消息起的前缀缓存失效。
