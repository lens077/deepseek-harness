# Agent Note: Cross-session file leases and resource governance

Status: proposed

English | [中文](2026-09-10-cross-session-file-lock.zh.md)

## Problem

One `dsh web` Host runs many sessions, and their agents work in overlapping directories: parallel Web sessions in one checkout, subagent fan-out across workspaces, and independent agents that happen to touch the same file. Git worktrees isolate branches, not files that two sessions reach through the same path. `dsh-fs-local` serializes single operations per target key and `dsh-fs-observation-policy` refuses a write over content the same session never read, but neither knows about another session: session B can read a file while session A is half-way through a multi-step edit of it, and B's own edit then overwrites A's. Nothing records who was modifying what, so the user cannot see why two sessions produced conflicting results. The [agent teams decision](../../implemented/feature/2026-08-05-agent-teams.md) names the same shared-checkout boundary and rejects treating a task owner as a file lock; this note supplies the explicit lease it left open.

The wider "one person, many agents" concern — shared CPU, memory, disk, build caches, orphaned processes — was examined and reduced for this machine: a single operator on macOS with few concurrent tasks has no memory or disk pressure, so admission by host water levels is unnecessary; the cross-session file conflict is the real, observed problem. Linux-only probes (`/proc/meminfo`, PSI, `flock(1)`) are out of scope.

## Proposal

### Leases follow the modifying turn

`@deepseek-ai/dsh-tool-call-file-lock` wraps `tools/execute` for the tools named in its `tools` rules (the shipped `read`, `read_image`, `write`, `edit`, and `str_replace_editor`). The first `write` or `edit` of a file by a session takes an exclusive lease keyed by the provider's `targetKey` (realpath on the local backend) and held until that session's `turn/end`; `agent/disposed` and `leaseTtlMs` (default 30 minutes) are the fallbacks for a turn that never closes. A lease covers a runtime family — the root agent and every agent it owns — so a subagent editing its parent's file never waits, while two root sessions do.

The lease table is one in-process `FileLockRegistry`: every session of one `dsh` process shares it, so no filesystem lock, `flock`, or external command is needed and the plugin is platform-neutral. A release wakes every waiting reader before granting the first queued writer.

### Foreign writes queue, then refuse

A write against a foreign lease queues FIFO for `writeWaitMs` (default 10 minutes). On release it proceeds and takes the lease; on timeout the model receives a `FILE_LOCKED` error naming the holder session (title and workspace when known), the lease start, and the wait, and telling it to wait for that session's turn or work elsewhere. There is no "overwrite anyway" option: that is the conflict the lease prevents.

### Foreign reads wait, ask, then subscribe

A read against a foreign lease waits `readWaitMs` (default 30 seconds) silently. A release within the window resumes the read with a notice naming the holder and the wait. After the window, a root session with a user-questions answerer asks the human through `ctx.userQuestions`: **Read now** reads the current content with a notice that it may be incomplete and is remembered for the rest of the turn; **Keep waiting** subscribes for the release with no upper bound and is woken the moment the lease frees. The question races the release under one `AbortController`, so a release while the question is pending withdraws it and reads. A delegated agent cannot ask a human (`DELEGATED_CALLER`), and a composition may mount no answerer; both follow `delegatedReadTimeout` (`wait`, the default, or `read-now`).

### Every decision is logged and projected

`file-lock/acquired`, `waiting`, `asked`, `answered`, `subscribed`, `settled`, and `released` (TTL only; a turn-end release is implied by `turn/end`) are hard session events, because the refusal text and the notices reach the model. The `fileLocks` projection (state version 1) folds them into `held` and `waiting` per session and resets at `turn/end`, so a UI reads one authoritative view.

### Settings own the waits

`readWaitMs`, `writeWaitMs`, `leaseTtlMs`, and `delegatedReadTimeout` form the `file-lock` settings section through `settings.installSection`: the composition value is the base layer and the user's settings document overrides it live. `tools` stays composition-only because it names deployment tools, not a user preference.

## Delivery order

1. **This change** — the plugin, its events and projection, the settings section, base-bundle wiring, and the real-composition suite over two root agents.
2. A resource ledger (`subprocess`, `dsh-mcp-client` child processes, jobs per session) and a `resource-governance` Remote that serves the lease table, the ledger, and orphan processes, with an explicit-id `reclaim` behind a confirmation.
3. `dsh-client-ui-digest`: a **等锁** inbox section after **运行中**, a `blocked` nav badge, a **资源** tab (locks, per-session ledger, orphans with confirmed termination on desktop only), the settings card that claims the `file-lock` namespace, and the morning-report lines.
4. Optional heavy-command serialization for `bash` (`pnpm run build|typecheck|test:coverage`) as pure mutual exclusion, no water levels.

## Alternatives considered

- **Lock per tool call.** Rejected: a modification is the whole turn; releasing after `write` returns would let another session read between two edits of one change.
- **Lock at `fs/write-intent` / `fs/edit-intent`.** Rejected: reads do not pass those waterfalls, and the read side is where the human decision lives; `tools/execute` sees both accesses at one point.
- **Filesystem locks (`flock`, lock files under `/tmp`).** Rejected for now: all sessions share one Host process; a file-backed table is deferred until a CLI and a Web Host need to coordinate.
- **Host water-level admission (memory, disk, PSI).** Rejected for this deployment; the design keeps the room for it in delivery step 4 as a plain mutex.
- **Bounded subscription with a second question.** Rejected: the user asked for an unbounded wait; the turn's cancellation is the exit.

## Acceptance criteria

- Two root sessions writing one file: the second is refused after `writeWaitMs` with the holder named; queued within the window, it proceeds on the holder's `turn/end`.
- A foreign read resumes within `readWaitMs` on release; after the window it asks, `Read now` is remembered for the turn, `Keep waiting` resumes on release, and a release while asking withdraws the question.
- A delegated child shares its parent's lease and follows `delegatedReadTimeout` against a foreign one.
- TTL, disposal, and turn end each free the lease; cancelling a waiting turn settles the wait as `aborted`.
- A `file-lock` user section overrides the composition waits; disposing the plugin removes the wrapper and every lease.

## Risks

- Files changed through `bash` take no lease. The heavy-command mutex in step 4 narrows build-output conflicts; the README records the gap.
- A subscribed read holds its turn open indefinitely by design; the digest panel in step 3 is where the user sees and cancels it.
