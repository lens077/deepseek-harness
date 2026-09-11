---
description: "Cross-session file leases over the fs tools: a modifying session keeps a file until its turn ends, foreign writes queue, and foreign reads wait, ask the user, or subscribe for the release; for users and maintainers composing or debugging the plugin."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-call-file-lock

English | [中文](README.zh.md)

## Summary

Use this package to stop two sessions from modifying one file at the same time. The session whose `write` or `edit` first touches a file leases it until its turn ends. Another session's write waits up to `writeWaitMs` and is then refused with the holder named; another session's read waits `readWaitMs`, then asks the user to read now or keep waiting, and a kept wait subscribes for the release with no time bound. Every decision is a `file-lock/*` session event folded into the `fileLocks` projection. The waits are user-editable under the `file-lock` settings namespace; the `dsh` base bundle enables it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The base bundle mounts the plugin with its defaults. Sessions that never touch a file another session is modifying see no change; only a contended file waits, asks, or refuses.

### When to choose it

Choose it when several sessions of one `dsh` process work in the same directories — parallel Web sessions, subagent fan-out across workspaces — and a half-applied edit from one session must not be read or overwritten by another. Avoid it for a single-session composition, where no foreign lease can exist, and do not rely on it for files changed through `bash`: only the tools named in `tools` are covered.

### Setting it up

Mount the plugin; every field has a default:

```yaml
- name: '@deepseek-ai/dsh-tool-call-file-lock'
  config:
    readWaitMs: 30000        # silent wait before the user is asked
    writeWaitMs: 600000      # queue before a foreign write is refused
    leaseTtlMs: 1800000      # a lease older than this is released even mid-turn
    delegatedReadTimeout: wait   # or read-now, for callers that cannot ask a human
    tools:                   # which tools take which access; defaults cover the shipped fs tools
      - { tool: read, pathArgument: file_path, access: read }
      - { tool: write, pathArgument: file_path, access: write }
```

`readWaitMs`, `writeWaitMs`, `leaseTtlMs`, and `delegatedReadTimeout` form the `file-lock` settings section: the composition values are the base layer, and a user layer written by a settings provider — the `settings.yaml` document under `$DSH_HOME`, or the **File lock** card on the Web Plugins settings page, which edits the waits in seconds and minutes — overrides them live. `tools` is composition-only. A rule with `readWhenArgument` and `readWhenValues` turns a write rule into a read for one call, as the shipped `str_replace_editor` rule does for `command: view`. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-call-file-lock) lists every field.

### What you get

A session's first `write` or `edit` of a file leases it; the lease covers every session of the same runtime family (a root agent and the agents it owns) and ends with the leasing session's `turn/end`, its disposal, or `leaseTtlMs`. Against a foreign lease:

- A **write** queues FIFO for `writeWaitMs`. On release it proceeds and takes the lease; on timeout the model receives `Error: file lock: "<path>" is being modified by session "<title>" (workspace <cwd>) since <time>; waited <n>s. Wait for that session to finish its turn, or work on a different file.` with error code `FILE_LOCKED`.
- A **read** waits `readWaitMs`. A release inside that window resumes the read and appends a notice naming the holder and the wait. After the window, a root session with a user-questions answerer asks **File lock**: `Read now` reads the current content with a notice that it may be incomplete and remembers that choice for the rest of the turn; `Keep waiting` subscribes until the release with no time bound. A release while the question is pending withdraws the question and reads. A delegated caller, or a composition without an answerer, follows `delegatedReadTimeout` instead.
- Cancelling the calling turn ends any wait as `aborted` and lets the tool report the cancellation.

The `fileLocks` projection of each session carries `held`, the display paths it leases in the open turn, and `waiting`, the call currently behind a foreign lease with its holder and phase (`waiting`, `asked`, or `subscribed`). Both reset at `turn/end`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains where the lease table lives, how one call moves through the wait phases, and which code realizes it; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **One in-process table, keyed by file identity.** Every session of one `dsh` process shares the `FileLockRegistry`, keyed by the provider's `targetKey` (the realpath for the local backend), so two workspaces reaching the same file through different relative paths contend for one lease. No filesystem lock or external command is involved.
- **Leases follow turns, not calls.** A modification is the whole turn that performs it, so the lease is released on `turn/end` rather than after the tool returns; `agent/disposed` and the TTL are the two fallbacks for a turn that never closes.
- **Readers before writers.** A release wakes every waiting reader before granting the first queued writer, so a long-waited read is never pushed behind a newly arrived write.
- **The human decides a stalled read.** A read cannot silently return content another session is mid-way through changing; after the silent window, the user chooses between stale-but-now and correct-but-later, and the choice is remembered for the turn.
- **Every decision is logged.** Waits, questions, answers, subscriptions, settlements, and non-turn releases are session events, so a transcript and the `fileLocks` projection reconstruct why a call paused and who held the file.

### The lease table

`FileLockRegistry` holds one `Lease` per key with its family, owner session, and holder set. `acquire` grants immediately to a free key or to the holding family and otherwise queues a writer; `awaitRelease` resolves at once when no foreign lease exists and otherwise queues a reader; `releaseAll(session)` removes that session's share of every lease and frees the ones left empty, waking readers and then the first writer. A waiter combines its abort listener, deadline, and queue slot in one `PendingWait` that settles exactly once. The TTL timer per lease is cleared on release, so an expiring lease is always the live one; `onExpire` lets the plugin record `file-lock/released`.

### One call through the wrapper

The `tools/execute` listener matches the tool name against `tools`, reads the path argument, resolves it through `ctx.fs.resolve` against the session `cwd`, and derives the caller's family by walking `ctx.agents.isOwnedBy` to the root. A write acquires (queueing behind a foreign lease) and records `file-lock/acquired` the first time this session takes the key in its turn. A read behind a foreign lease records `file-lock/waiting`, waits `readWaitMs`, and on timeout either asks through `ctx.userQuestions` — racing the question against an unbounded `awaitRelease` under one `AbortController` so the loser is withdrawn — or applies `delegatedReadTimeout`. Both paths end in `file-lock/settled` with the outcome and the wait length, and a resumed read carries a `notice`-form plugin message as `additionalContexts`.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config`, the settings section, the `tools/execute` wrapper, turn-end and disposal releases |
| [`src/registry.ts`](src/registry.ts) | `FileLockRegistry`: leases, writer and reader queues, TTL, disposal |
| [`src/projection.ts`](src/projection.ts) | The `fileLocks` projection definition |
| [`src/types.ts`](src/types.ts) | Settings, event payloads, and projection state shared with clients |
| — | No runtime invariant companion is published; the registry is the single owner of lease state and the projection is a pure fold of logged events, so no two observations can diverge. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the tool-call pipeline to the question seam, the projection registry, and the guard group map.

- [Tools subsystem reference](../../../docs/subsystems/tools.md) — the `tools/execute` waterfall this wrapper hooks.
- [`dsh-user-questions`](../../interaction/user-questions/README.md) — the answerer waterfall the stalled read asks through, and why a delegated caller cannot ask.
- [`dsh-session-projection`](../../session/session-projection/README.md) — how the `fileLocks` projection is folded, cached, and served.
- [Resource governance Agent Note](../../../.agents/notes/proposed/feature/2026-09-10-cross-session-file-lock.md) — the decision record: turn-scoped leases, the three read phases, and the deferred panel work.
- [guard group map](../README.md) — the sibling guard packages.

-----

<a id="model-experience"></a>
## Model Experience

### Conditional tool result

#### What the model sees

This plugin adds no prompt or schema, and uncontended calls pass through unchanged. A refused write replaces the tool result with `Error: file lock: "<path>" is being modified by <holder> since <ISO time>; waited <n>s. Wait for that session to finish its turn, or work on a different file.`, where `<holder>` is `session "<title>"` or `session <id>`, followed by ` (workspace <cwd>)` when the holder has one. A read that waited appends one `notice` message after its result, in one of the two forms below:

##### Verbatim text of the released-read notice

```markdown
[file-lock] waited <n>s until <holder> finished modifying "<path>"; the content you read is the released version.
```

##### Verbatim text of the read-now notice

```markdown
[file-lock] "<path>" is being modified by <holder> right now; the content you read may be incomplete or change again.
```

#### Token effect

Zero tokens on uncontended calls. A refusal replaces the tool's own result with one short error; a waited read adds one retained notice message beside the unchanged result.

#### KV Cache effect

Append-only; the refusal and notices follow the reusable request prefix and do not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the policy is a poor fit. They are current package constraints, not a task backlog.

- **Only rule-listed tools are covered** — a file changed through `bash`, `git`, or a tool absent from `tools` takes no lease and waits for none.
- **One process** — the table is process-local; a `dsh` CLI and a `dsh web` Host on the same machine do not see each other's leases.
- **A subscribed read blocks its turn** — `Keep waiting` and the `wait` policy have no upper bound by design; cancelling the turn is the way out.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

Merging leases across git worktrees of one repository (`mergeWorktreePaths`) and a file-backed lease table for several `dsh` processes are both open; neither has a current consumer.

</details>
