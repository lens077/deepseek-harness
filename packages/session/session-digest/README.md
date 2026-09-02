# @deepseek-ai/dsh-session-digest

English | [中文](README.zh.md)

Function plugin registering the `sessionDigest` projection unit: the newest direct human question, the closing assistant answer to it, that turn's terminal reason, the files the turn changed, and a bounded history of the questions before it, folded from durable session events and served through the session-projection seam (registry snapshot, change feed, and every projection carrier: history tail page, `session/projection` push frames, session list rows). It exists so a client can summarize finished work across many workspaces without opening each session and without spending a model call — the reference consumer is the web digest panel.

## Fold semantics

- `question` retains the newest `user/message` whose `source.kind` is `user`. Every other `user/message` — injected workspace instructions, time context, compaction checkpoints, goal continuation rounds — is model-visible surface rather than something a human asked, and is ignored.
- A new question moves the previous question into `history` (its seq, event time, text, outcome, reply time, and changed-file count, oldest first, cut to the `historyQuestions` budget) and clears `reply`, `outcome`, `replySeq`, `repliedAt`, and the changed-file record. A session whose newest question is still being worked therefore reports `outcome: null` instead of inheriting the finished state of the question before it, which is what lets a consumer separate running work from finished work. `questionSeq` and `questionAt` carry the newest question's log seq and event time, the address a todo or a transcript jump uses.
- `changedFiles` and `changedFileCount` come from the mutation tools' own `tool/result` record — the `diffs[].path` list `dsh-tool-fs` attaches — so a tool joins by declaring what it changed and the fold never guesses from a tool name or its prose. The count covers every distinct path of the current question's turn; the list keeps the first paths up to the `changedFilePaths` budget.
- `reply` retains the newest non-empty `assistant/message` after a question, so a multi-step turn keeps the model's closing summary rather than an intermediate tool-calling step; `repliedAt` is its event time. An assistant message with no preceding question is ignored.
- `outcome` mirrors the `turn/end` reason discriminant (`completed`, `error`, `aborted`, `blocked`, `max-tokens`, `interrupted`) and stays `null` until that turn closes. Consumers distinguish success from a turn that merely stopped.
- Both texts join only `text` content blocks — tool calls, images, and reasoning never enter the value — and are cut to the configured budgets with `questionTruncated` / `replyTruncated` reporting the cut. `replySeq` carries the retained message's log seq for an exact on-demand full read through `session.history`.
- A composed registry always serves the key, so clients read the value, never key presence.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `questionChars` | `400` | Maximum retained question characters. |
| `replyChars` | `1200` | Maximum retained answer characters. |
| `changedFilePaths` | `8` | Maximum retained changed-file paths of the current question. |
| `historyQuestions` | `30` | Maximum retained earlier questions. |

The value rides every `session.list` row, so these budgets bound the listing payload rather than the durable log. Raising them enlarges every listing response; a consumer that needs the complete message reads it through `session.history` instead. A non-integer or non-positive value fails plugin load.

## Composition

```yaml
- id: session-digest
  name: '@deepseek-ai/dsh-session-digest'
```

Injects `sessionProjections` — the plugin's whole purpose; in assemblies without the registry the fiber stays pending and nothing registers. The fold is entirely local and needs no collector, network endpoint, account, or cloud credential.

Cold session-list rows are served from the persisted projection cache, so a deployment that wants digests for sessions this process never attached to also mounts `@deepseek-ai/dsh-session-projection-cache`.

## Model Experience

None, as the plugin only computes a client-facing read model of already-logged session events and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Only the newest question keeps its answer** — earlier questions survive in `history` with their outcome and file count but no reply text; an earlier answer is readable only through the session itself.
- **A path dropped from the bounded list can be counted twice** — once the list is full, a later result naming a path the list never kept is counted as new; the count is therefore an upper bound for turns touching more distinct files than the budget.
- **A cache written before this unit has no digest row** — an existing cold Session appears after a cold projection read or after it is opened and checkpointed; the zero-I/O session listing does not scan every old log merely because the unit was installed.
- **A changed budget does not rewrite cached values** — `stateVersion` covers the state fields and fold semantics, not the configured cut, so rows already in the persisted projection cache keep their previous truncation until their session is folded again.
- **Truncation counts UTF-16 code units** — a cut can land inside a grapheme cluster, so a consumer renders the retained text as a preview rather than treating it as a complete sentence.
- **Outcome describes the turn, not the task** — a turn that ended `completed` after the model reported it could not finish still reports `completed`; the fold classifies lifecycle, not success of the underlying work.
