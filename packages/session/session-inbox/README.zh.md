# @deepseek-ai/dsh-session-inbox

[English](README.md) | 中文

`sessionInbox` Remote 背后的持久化跨工作区收件箱标记：用户在每个 Session 里看到过哪条回复、处理过哪些结果、延后或置顶了什么、上次查看收件箱的时间，以及待办列表。Session 日志记录的是 Agent 做了什么；这个 sidecar 记录的是用户对它的决定，因此刷新、换浏览器、Host 重启都不会丢。参考消费者是 Web 收件箱面板（[ui-digest](../../client/ui-digest/README.zh.md)）。

## 数据

服务打开 `session_inbox` 存储域：一个 `reviewedAt` 单例、一张按 Session id 键控的 `sessions` 表，以及一张按待办 id 键控的 `todos` 表。所有字段都对客户端可见，所以存储行与线上值共用一套词汇（`./types`）。

- `lastSeenSeq` 是用户在屏幕上看到过的最高日志 seq；`markSeen` 只会抬高它。seq 高于该标记的回复即为未读。`null` 表示该 Session 从未通过收件箱感知的客户端打开过。
- `handledAt` 记录用户已处理该 Session 当前结果；`setHandled(false)` 清除它。
- `snoozedUntil` 把 Session 隐藏到未来某个时间；不晚于 Host 时钟的时间被拒绝为 `snooze-in-past`，`null` 清除延后。
- `pinned` 让 Session 固定在收件箱顶部。
- 所有标记都被清空的 Session 行会被删除而不是保留。
- 一条待办携带它所关于的 Session、可选的 `questionSeq`（待办指向的 `user/message` seq）、经过校验的文本、`open`/`done` 状态以及 Host 分配的时间。文本必须含非空白字符且不超过配置的字节预算（`text-blank`、`text-too-large`）；更新未知 id 返回 `todo-not-found`，删除不存在的 id 视为成功。
- `markReviewed` 用 Host 时钟写入 `reviewedAt`；消费者把它作为默认的"离开以来"边界。

每次读取和变更都返回完整快照，每次写入都以同一快照发出 `session-inbox/changed`。该事件通过 `dsh-api-remotes` 的允许列表转发给浏览器，因此在一个浏览器里做的标记无需轮询就会出现在其他浏览器里。变更串行排队；没有改变任何东西的调用既不写也不发事件。

服务从不读取 Session 日志：指向已不存在 Session 的标记是无害的，由把标记与实时 Session 列表连接的消费者过滤。

## 配置

| 键 | 必填 | 含义 |
| --- | --- | --- |
| `maxTextBytes` | 是 | 单条待办文本可接受的最大 UTF-8 字节数。 |

非正数或非整数值会使插件加载失败。

## 组合

```yaml
- id: session-inbox
  name: '@deepseek-ai/dsh-session-inbox'
  config:
    maxTextBytes: 4096
```

注入 `storageDomain`。Remote 命名空间由 `@Remote` 方法生成（`get`、`markSeen`、`setHandled`、`snooze`、`setPinned`、`markReviewed`、`addTodo`、`updateTodo`、`removeTodo`），由 `dsh-api-remotes` 挂载。

## 模型体验

无。插件只存储用户对已完成工作的决定，不触及任何提示、消息、schema、流或工具结果。

#### KV 缓存影响

无；插件从不组装或发送 provider 请求。

## 已知限制与延后工作

- **标记不随 Session 删除而清理** — 删除 Session 后，其标记和待办仍留在 sidecar 中，直到消费者删除待办；标记不可见，因为没有列表行与之连接。
- **每个 Host 只有一个收件箱** — 标记不按客户端身份区分，共用一个 Host 的两个人共用一个收件箱。
- **`markSeen` 信任调用方** — Host 不校验 `seq` 是否存在于 Session 日志；客户端发送它渲染过的最新落地 seq。
