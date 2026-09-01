# Agent Note：接通会话内提问索引

Status: implemented

[English](2026-09-14-question-search-wire.md) | 中文

> 范围：本记录补上[诚实的提问搜索](2026-09-14-honest-question-search.zh.md)所推迟的传输层。那份记录拥有诚实性设计并且依然有效，其中没有任何内容发生改变。

## 问题

`SessionQueryEngine.searchEvents` 本就搜索单个会话的完整日志，导航器也本就知道如何通过 `contract/question-search.ts` 消费这样的答案。缺的只是两者之间的连接：`searchEvents` 没有 wire 出口，因此没有任何浏览器消费方能够到达它，已发布的 GUI 运行在 `window-only`——搜索已加载的窗口并如实说明这一点。

先前那次改动无法构建该传输层，因为六个 wire 文件当时都承载着另一个 agent 未提交的工作。这些文件此后已经落地。

## 决策

**`session.searchQuestions` 是建立在既有服务方法之上的新 wire 操作。** 无需改动 `session-query`——这正是先核查既有能力的意义所在：请求携带 `sessionId` 与 `query`，响应携带 `{ items, complete }`，其中每一项为 `{ seq, time, snippet }`。

**授权复用读取路径，而不是重新表述它。** 处理器在查询索引之前调用 `historySourceFor(sessionId)`，也就是 `session.history` 执行的同一次读取。调用方无权读取的 id 会在那里抛出 `SessionNotFound`，因此针对不可读会话的查询绝不会到达提供方。把可见性重新表述为第二条规则，只会制造出两处需要保持一致的地方。

**提供方的答案会被重新校验，而不是被信任。** 除非命中同时指明本会话、`current` 内容视图与 `user/message`，否则一律丢弃。请求本就精确要求这些，因此在提供方正确时该过滤是冗余的，在提供方出错时则是承重的；跨会话的 `session.search` 处理器出于同样理由也做重新校验。

**`complete` 由 `nextCursor` 推导，且只在知道它的那一处推导。** 游标存在意味着索引持有本页未携带的匹配。在处理器完成这一映射，使诚实位成为关于该次查询的事实，而不是客户端从满页反推出的猜测。

**独立的 `SESSION_QUESTION_RESULT_LIMIT = 50`**，大于跨会话的 20。这些命中是单个会话自身列表中的行，而非供人选择的不同会话；截断的代价是收窄查询，而不是漏掉一个会话。两个上限都保持为固定常量：它们是响应 schema 在每个客户端边界强制执行的产品边界，而非部署可调项。

**错误一路保持可区分，直到视图。** 索引未挂载、会话不可读、查询被中止分别返回不同的业务错误，而 `apply.ts` 对其中任何一种都抛出，而不是返回空页面。导航器的 `failed` 状态依赖于此：把拒绝折叠成 `{ hits: [], complete: true }` 会从后门复原原始缺陷。

## Alternatives considered

**扩展 `session.search` 以接受可选的 `sessionId`。** 已否决。它的结果是 `{ sessionId, snippet }`，没有 `seq`，因此无法定位跳转；而让同一个操作具备两种排序模式，会使侧边栏的契约依赖一个它从不发送的字段。

**在客户端过滤出提问。** 已否决：那会把完整的助手消息与工具调用传过 wire 再在浏览器里丢弃，而有界 snippet 的存在正是为了避免这一点。

**让处理器持续翻页直到取得全部匹配。** 已否决。它把有界请求变成无界请求，而触发它的恰恰是那些本就过宽的查询；`complete: false` 让读者收窄查询——这既更省，也更诚实。

**当页面偏短时返回 `complete: true`。** 已否决：页面长度不是完整性信号，`nextCursor` 才是。提供方完全可以返回一个短页面同时仍持有更多匹配。

## Testing

`packages/host/apiproxy/tests/api-proxy-search.spec.ts` 覆盖处理器：它发送的过滤条件与上限、完整页面、不完整页面、因会话／内容视图／类型不符而被丢弃的命中、对不可读会话在抵达索引前的拒绝、索引未挂载，以及中止映射。其中两条已验证能够拒绝无效实现——返回常量 `complete: true` 会让不完整页面的测试失败，删除 `historySourceFor` 调用会让授权测试失败。

`packages/client/ui-conversation/tests/chat-apply.client.spec.tsx` 覆盖绑定：注入的 `searchQuestions` 带着会话 id 与查询抵达会话服务并保留 `complete: false`，而被拒绝的搜索会抛出而非解析为空。删除 `apply.ts` 中的错误分支会让第二条失败。

`packages/client/connection` 的 fixture 在其自有语料上实现了该操作，因此无密钥的 GUI 场景走的是真实路径。

两个编译面 typecheck 干净；受影响的包通过 1387 项测试。更大的 `test:gui` 通道中 12 项 `directory-picker` 与 87 项 `acp-snapshot` 失败在 stash 掉本次改动后同样复现，属于并发工作。

## Consequences

- 只要 web 应用组合了 `searchQuestions`，导航器现在就为整个会话作答；对于未组合它的部署，`window-only` 依然是诚实的状态。
- `SessionsApi` 新增了一个方法，因此每个 `ApiProxy` 替身都要实现它——两个宿主测试替身与两个客户端 fake 随本次改动一并更新。
- 响应在构造上就是有界的：至多 50 个命中，每个至多 240 个码点，与会话长度无关。千轮会话与十轮会话的单页代价相同。
