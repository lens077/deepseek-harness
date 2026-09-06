# @deepseek-ai/dsh-session-inbox

English | [中文](README.zh.md)

Durable, cross-workspace inbox marks behind the `sessionInbox` Remote: which reply a user has seen in each Session, which outcomes they have dealt with, what is snoozed or pinned, when they last reviewed the inbox, and their todo list. The Session log records what the agent did; this sidecar records what the user decided about it, so the decision survives a refresh, another browser, and a Host restart. The reference consumer is the web inbox panel ([ui-digest](../../client/ui-digest/README.md)).

## Data

The service opens the `session_inbox` storage domain: a `reviewedAt` singleton, a `sessions` table keyed by Session id, and a `todos` table keyed by todo id. Every field is client-visible, so the stored rows and the wire values share one vocabulary (`./types`).

- `lastSeenSeq` is the highest log seq the user had on screen; `markSeen` only raises it. A reply whose seq is above the mark is unread. `null` means the Session was never opened through an inbox-aware client.
- `handledAt` records that the user dealt with the Session's current outcome; `setHandled(false)` clears it.
- `snoozedUntil` hides the Session until a future time; a time not after the Host clock is rejected as `snooze-in-past`, and `null` clears the snooze.
- `pinned` keeps the Session at the top of the inbox.
- A Session row with every mark cleared is deleted rather than stored.
- A todo carries the Session it is about, an optional `questionSeq` (the `user/message` seq the todo refers to), validated text, an `open`/`done` status, and Host-assigned times. Text must contain a non-whitespace character and fit the configured byte budget (`text-blank`, `text-too-large`); an unknown id on update is `todo-not-found`, while removing an absent id succeeds.
- `markReviewed` stamps `reviewedAt` from the Host clock; consumers use it as the default "since you left" boundary.

Every read and mutation answers with the complete snapshot, and every write emits `session-inbox/changed` with the same snapshot. The event is forwarded to browsers through the `dsh-api-remotes` allowlist, so a mark made in one browser lands in every other one without a poll. Mutations are serialized behind one queue; a call that changes nothing neither writes nor emits.

The service never reads a Session log: a mark on a Session that no longer exists is harmless and is filtered by the consumer that joins marks with the live Session list.

## Configuration

| Key | Required | Meaning |
| --- | --- | --- |
| `maxTextBytes` | yes | Maximum UTF-8 byte length accepted for one todo's text. |

A non-positive or non-integer value fails plugin load.

## Composition

```yaml
- id: session-inbox
  name: '@deepseek-ai/dsh-session-inbox'
  config:
    maxTextBytes: 4096
```

Injects `storageDomain`. The Remote namespace is generated from the `@Remote` methods (`get`, `markSeen`, `setHandled`, `snooze`, `setPinned`, `markReviewed`, `addTodo`, `updateTodo`, `removeTodo`) and mounted by `dsh-api-remotes`.

## Model Experience

None, as the plugin stores user decisions about finished work and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Marks are not pruned with Sessions** — deleting a Session leaves its marks and todos in the sidecar until a consumer removes the todos; the marks are invisible because no list row joins them.
- **One inbox per Host** — the marks are not scoped to a client identity, so two people sharing one Host share one inbox.
- **`markSeen` trusts the caller** — the Host does not verify that `seq` exists in the Session log; the client sends the newest landed seq it rendered.
