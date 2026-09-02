# Session Inbox

English | [中文](session-inbox.zh.md)

[`@deepseek-ai/dsh-session-inbox`](../../packages/session/session-inbox) owns the user's durable marks on Sessions — the highest log seq they had on screen, whether they dealt with the current outcome, a snooze time, a pin — plus the last inbox review time and a todo list addressed to Sessions and, optionally, to one question inside them. It is a storage-domain sidecar beside the Session log: the log records what the agent did, the sidecar records what the user decided about it, and the web inbox panel ([ui-digest](../../packages/client/ui-digest/README.md)) joins the two per render.

Source: [`packages/session/session-inbox/src/types.ts`](../../packages/session/session-inbox/src/types.ts)

## Public types

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

## Data and concurrency

The `session_inbox` domain holds a `reviewedAt` singleton, a `sessions` table keyed by Session id, and a `todos` table keyed by todo id. Every mutation runs behind one queue; a call that changes nothing neither writes nor emits. A Session row whose every mark is cleared is deleted rather than stored. `markSeen` only raises the mark; `snooze` rejects a time not after the Host clock; todo text is validated for a non-whitespace character and the configured byte budget before any storage access.

## Publication

Every read and mutation answers with the complete snapshot, and every write emits `session-inbox/changed` with the same snapshot. The event is forwarded verbatim to browsers through the `dsh-api-remotes` allowlist, so a consumer replaces its copy instead of merging and every browser attached to the Host converges on one state.

## Known limitations

- Marks and todos are not pruned when their Session is deleted; the marks are invisible because no list row joins them, and the todos remain until removed.
- The inbox is per Host, not per client identity.
- `markSeen` trusts the caller's seq; the Host does not verify it against the Session log.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
