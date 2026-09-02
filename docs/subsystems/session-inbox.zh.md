# 会话收件箱

[English](session-inbox.md) | 中文

[`@deepseek-ai/dsh-session-inbox`](../../packages/session/session-inbox) 拥有用户对 Session 的持久标记——屏幕上看到过的最高日志 seq、是否处理了当前结果、延后时间、置顶——以及上次查看收件箱的时间和指向 Session（可选地指向其中某一问）的待办列表。它是 Session 日志旁的存储域 sidecar：日志记录 Agent 做了什么，sidecar 记录用户对它的决定，Web 收件箱面板（[ui-digest](../../packages/client/ui-digest/README.zh.md)）在每次渲染时把二者连接起来。

来源：[`packages/session/session-inbox/src/types.ts`](../../packages/session/session-inbox/src/types.ts)

## 公开类型

```ts type-equiv
/** Opaque identity of one todo item, minted by the Host on creation. */
type InboxTodoId = Branded<'InboxTodoId'>
```

```ts type-equiv
/**
 * The user's durable marks on one Session. Every field is a human decision
 * or observation, never a fact about the Session log: the log says what the
 * agent did, this record says what the user has done about it.
 */
interface InboxSessionState {
  readonly sessionId: SessionId
  /**
   * Highest log seq the user had on screen. A reply whose seq is above this
   * mark is unread; `null` means the Session was never opened through the
   * inbox-aware client.
   */
  readonly lastSeenSeq: number | null
  /** When the user marked the Session's current outcome as dealt with; `null` when open. */
  readonly handledAt: number | null
  /** Hide the Session from the inbox until this epoch-ms time; `null` when not snoozed. */
  readonly snoozedUntil: number | null
  /** Keep the Session at the top of the inbox regardless of state. */
  readonly pinned: boolean
  /** Host-assigned time of the most recent change to this record. */
  readonly updatedAt: number
}
```

```ts type-equiv
/** Lifecycle of one todo item. */
type InboxTodoStatus = 'open' | 'done'
```

```ts type-equiv
/** One todo item pointing at a Session and, optionally, one question inside it. */
interface InboxTodo {
  readonly id: InboxTodoId
  /** Session the todo is about. */
  readonly sessionId: SessionId
  /** `user/message` seq of the question the todo refers to; `null` for the whole Session. */
  readonly questionSeq: number | null
  /** Todo text, preserved verbatim after validation. */
  readonly text: string
  readonly status: InboxTodoStatus
  /** Host-assigned creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Host-assigned time of the most recent change. */
  readonly updatedAt: number
  /** When the todo was marked done; `null` while open. */
  readonly doneAt: number | null
}
```

```ts type-equiv
/** The complete inbox state, served whole after every read and mutation. */
interface InboxSnapshot {
  /** When the user last reviewed the inbox; the default "since you left" boundary. `null` before the first review. */
  readonly reviewedAt: number | null
  /** Every Session carrying at least one mark, in no particular order. */
  readonly sessions: readonly InboxSessionState[]
  /** Every todo, oldest first. */
  readonly todos: readonly InboxTodo[]
}
```

```ts type-equiv
/** Record that the user had `seq` on screen for a Session. Lower seqs never move the mark down. */
interface InboxMarkSeenRequest {
  readonly sessionId: SessionId
  readonly seq: number
}
```

```ts type-equiv
/** Mark or unmark a Session's current outcome as dealt with. */
interface InboxSetHandledRequest {
  readonly sessionId: SessionId
  readonly handled: boolean
}
```

```ts type-equiv
/** Hide a Session until `until`, or clear the snooze with `null`. */
interface InboxSnoozeRequest {
  readonly sessionId: SessionId
  readonly until: number | null
}
```

```ts type-equiv
/** Pin or unpin a Session. */
interface InboxSetPinnedRequest {
  readonly sessionId: SessionId
  readonly pinned: boolean
}
```

```ts type-equiv
/** Create one todo. */
interface InboxAddTodoRequest {
  readonly sessionId: SessionId
  readonly questionSeq: number | null
  readonly text: string
}
```

```ts type-equiv
/** Change a todo's text, status, or both. Absent fields keep their value. */
interface InboxUpdateTodoRequest {
  readonly id: InboxTodoId
  readonly text?: string
  readonly status?: InboxTodoStatus
}
```

```ts type-equiv
/** Delete one todo; an absent id is a successful no-op. */
interface InboxRemoveTodoRequest {
  readonly id: InboxTodoId
}
```

```ts type-equiv
/** The todo text is empty or whitespace. */
interface InboxTextBlank {
  readonly code: 'text-blank'
}
```

```ts type-equiv
/** The todo text exceeds the deployment's byte budget. */
interface InboxTextTooLarge {
  readonly code: 'text-too-large'
  readonly maxBytes: number
  readonly actualBytes: number
}
```

```ts type-equiv
/** No todo exists with the requested id. */
interface InboxTodoNotFound {
  readonly code: 'todo-not-found'
  readonly id: InboxTodoId
}
```

```ts type-equiv
/** The snooze time is not in the future. */
interface InboxSnoozeInPast {
  readonly code: 'snooze-in-past'
  readonly until: number
}
```

```ts type-equiv
/** Every business failure the inbox reports. */
type InboxFailure = InboxTextBlank | InboxTextTooLarge | InboxTodoNotFound | InboxSnoozeInPast
```

```ts type-equiv
/** Successful branch carrying the value. */
interface InboxSuccess<T> {
  readonly ok: true
  readonly value: T
}
```

```ts type-equiv
/** Rejected branch carrying one explicit business failure. */
interface InboxRejected<E extends InboxFailure> {
  readonly ok: false
  readonly error: E
}
```

```ts type-equiv
/** Result of a todo creation or update. */
type InboxTodoResult =
  | InboxSuccess<InboxSnapshot>
  | InboxRejected<InboxTextBlank | InboxTextTooLarge | InboxTodoNotFound>
```

```ts type-equiv
/** Result of a snooze request. */
type InboxSnoozeResult =
  | InboxSuccess<InboxSnapshot>
  | InboxRejected<InboxSnoozeInPast>
```

## 数据与并发

`session_inbox` 域持有一个 `reviewedAt` 单例、一张按 Session id 键控的 `sessions` 表和一张按待办 id 键控的 `todos` 表。所有变更在同一队列后串行执行；没有改变任何东西的调用既不写也不发事件。所有标记都被清空的 Session 行会被删除而不是保留。`markSeen` 只会抬高标记；`snooze` 拒绝不晚于 Host 时钟的时间；待办文本在访问存储前先校验非空白字符与配置的字节预算。

## 发布

每次读取与变更都返回完整快照，每次写入都以同一快照发出 `session-inbox/changed`。该事件经 `dsh-api-remotes` 允许列表原样转发给浏览器，因此消费者整体替换自己的副本而不做合并，连接到 Host 的每个浏览器都收敛到同一状态。

## 已知限制

- Session 被删除时其标记与待办不会被清理；标记不可见，因为没有列表行与之连接，待办则保留到被删除为止。
- 收件箱按 Host 而非客户端身份划分。
- `markSeen` 信任调用方的 seq；Host 不对照 Session 日志校验它。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsessioninbox--sessioninboxservice"></a>

### `ctx.sessionInbox` — `SessionInboxService`

Storage-domain sidecar service. It never reads a Session log: a mark on a Session that no longer exists is harmless and is filtered by the consumer that joins marks with the live Session list.

```ts cordis-catalog
/**
 * Read the complete inbox state.
 * @returns every Session mark and todo plus the review boundary.
 */
@Remote('get') get(): InboxSnapshot

/**
 * Raise a Session's seen mark to `seq`. A lower or equal seq changes
 * nothing and emits nothing.
 * @param request - Session and the highest seq the user had on screen.
 * @returns the complete state after the change.
 */
@Remote('markSeen') markSeen(request: InboxMarkSeenRequest): Promise<InboxSnapshot>

/**
 * Mark or clear a Session as dealt with.
 * @param request - Session and the desired handled state.
 * @returns the complete state after the change.
 */
@Remote('setHandled') setHandled(request: InboxSetHandledRequest): Promise<InboxSnapshot>

/**
 * Hide a Session until a future time, or clear its snooze.
 * @param request - Session and the epoch-ms time to resurface it, or `null`.
 * @returns the complete state, or `snooze-in-past` for a time not after now.
 */
@Remote('snooze') snooze(request: InboxSnoozeRequest): Promise<InboxSnoozeResult>

/**
 * Pin or unpin a Session.
 * @param request - Session and the desired pinned state.
 * @returns the complete state after the change.
 */
@Remote('setPinned') setPinned(request: InboxSetPinnedRequest): Promise<InboxSnapshot>

/**
 * Record that the user reviewed the inbox now. The next "since you left"
 * window starts here.
 * @returns the complete state after the change.
 */
@Remote('markReviewed') markReviewed(): Promise<InboxSnapshot>

/**
 * Create one todo.
 * @param request - target Session, optional question seq, and text.
 * @returns the complete state, or an explicit text failure.
 */
@Remote('addTodo') addTodo(request: InboxAddTodoRequest): Promise<InboxTodoResult>

/**
 * Change a todo's text or status. A request that changes nothing is a
 * successful no-op.
 * @param request - todo id and the fields to replace.
 * @returns the complete state, or an explicit failure.
 */
@Remote('updateTodo') updateTodo(request: InboxUpdateTodoRequest): Promise<InboxTodoResult>

/**
 * Delete one todo. An absent id is a successful no-op.
 * @param request - todo id.
 * @returns the complete state after the change.
 */
@Remote('removeTodo') removeTodo(request: InboxRemoveTodoRequest): Promise<InboxSnapshot>
```

Source: [`packages/session/session-inbox/src/index.ts`](../../packages/session/session-inbox/src/index.ts)

<a id="session-inbox-events"></a>

### `session-inbox/*` events

<a id="session-inboxchanged--emit"></a>

#### `session-inbox/changed` — emit

The durable inbox state changed through any mutation. Carries the complete snapshot so a consumer replaces its copy instead of merging.

```ts cordis-catalog
/**
 * The durable inbox state changed through any mutation. Carries the
 * complete snapshot so a consumer replaces its copy instead of merging.
 * @mode emit
 * @param snapshot - the complete inbox state after the change.
 */
'session-inbox/changed'(snapshot: InboxSnapshot): void
```

Source: [`packages/session/session-inbox/src/types.ts`](../../packages/session/session-inbox/src/types.ts)
<!-- END GENERATED cordis-surface -->
