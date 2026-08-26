# @deepseek-ai/dsh-session-stats

English | [中文](README.zh.md)

Function plugin registering the `sessionStats` projection unit: privacy-safe whole-log observability figures — turn/step counts and wall times, model and tool time, first-token and decode time, retry delay, tool outcomes, and turn outcomes — folded from durable session events and served through the session-projection seam (registry snapshot, change feed, and every projection carrier: history tail page, `session/projection` push frames, session list rows). Clients render full-session figures that paging and compaction cannot change; the reference consumer is the web chat stats strip, whose window fold mirrors these field names as its no-unit fallback.

## Fold semantics

- `steps` counts `step/end` events. The agent loop appends exactly one per entered step, in a `finally`, so completed, failed, cancelled, and max-tokens steps all count. `turns` counts distinct turns carrying at least one such step; rejected or empty turns remain outside this work count.
- `turnMs` sums matched `turn/start` → `turn/end` boundaries. `stepMs` sums matched `step/start` → `step/end` boundaries, including cancelled and failed steps that never assemble a message.
- `llmMs` sums `step/start` → `assistant/message` per step that assembled a message (retry waits inside the step are model time, as in the window fold).
- `ttftMs`/`ttftSteps` sum and count `step/start` → first non-empty delta chunk; the first attempt's boundary survives an in-step `llm/retry` (window `resetForRetry` parity).
- `decodeMs`/`decodeTokens` sum first token → assembled message and the provider-reported output tokens, only over steps carrying both.
- `toolCalls` and `toolResults` count durable dispatch and result events independently. `toolErrors` counts result envelopes carrying `isError: true`; `toolMs` sums only call/result pairs matched by callId. Unresolved call boundaries are dropped at `turn/end`.
- `llmRetries` counts `llm/retry` records matching the open step and `retryDelayMs` sums their scheduled delay. Orphan, stale, and wrong-coordinate records are ignored; these are provider-routed retry records, not arbitrary application retries.
- `completedTurns`, `errorTurns`, `abortedTurns`, `blockedTurns`, `maxTokenTurns`, and `interruptedTurns` classify every core `turn/end` reason independently of whether that turn contributed to the work count.
- Every field is 0 until its first contributing event. A composed registry always serves the key, so clients read the value, never key presence.

## Composition

```yaml
- id: session-stats
  name: '@deepseek-ai/dsh-session-stats'
```

Injects `sessionProjections` — the plugin's whole purpose; in assemblies without the registry the fiber stays pending and nothing registers. The fold is entirely local and needs no collector, network endpoint, account, or cloud credential.

## Model Experience

None, as the plugin only computes a client-facing read model of already-logged session events and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the plugin never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Steps count work attempted, not visible output** — a step that failed before producing any visible content still closed with `step/end` and counts; a step interrupted by a crash counts after the session reloads, when crash recovery appends its synthetic `step/end` (`interruptedTurnClosers` in dsh-session).
- **A cancelled step has lifecycle time but no model-completion time** — `stepMs` includes its complete step boundary, while `llmMs`, TTFT, and decode time still require their corresponding model events; a max-tokens usage-host message conversely contributes model time the surface does not show.
- **Counts are log-scoped, not surface-scoped** — steps whose messages were later compacted away stay counted; the figures describe the whole session, not the current model-visible surface.
- **Mounted only in the web-app bundle** — other assemblies serve no `sessionStats` key, and their consumers fall back to window-scoped counting (the web stats strip's fallback path).
