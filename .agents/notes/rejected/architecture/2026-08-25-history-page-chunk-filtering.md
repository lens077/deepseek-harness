# Agent Note: filter superseded assistant chunks out of session.history pages

Status: rejected — the transport already compresses, so filtering superseded chunks buys 1.73x on a history page (about 280 ms per open on a 2.8 Mbit/s link) while breaking the documented contiguous-range property and forcing a host, client, e2e, and snapshot rewrite.

English | [中文](2026-08-25-history-page-chunk-filtering.zh.md)

## Problem

Reading a session through a tunnelled reverse proxy is bandwidth-bound, not latency-bound: one such deployment measures about 2.8 Mbit/s from the proxy to the browser against 40 Mbit/s on the tunnel behind it, so wire bytes convert directly into wait.

A `session.history` tail page for a heavy session measures 2.4 MB for 7513 events, of which 7283 are `assistant/chunk` carrying 1,986,989 bytes — 77.7% of the raw page. Every one of those 7283 chunks is cited by the `sourceEventSeqs` of a finalized `assistant/message` on the same page, so the client folds them and then discards the result. `paginate` (`packages/host/apiproxy/src/api-proxy.ts:228`) emits the page as `window.filter(event => event.seq >= cut)` at `:252`: one contiguous raw range, no filtering by type.

## Proposal

Drop an `assistant/chunk` from a history page when its `seq` appears in the `sourceEventSeqs` of a finalized `assistant/message` on the same page. The durable log keeps every chunk; only the RPC projection narrows.

## What a history page is actually read for

For a finalized message the client fold overwrites rather than merges: `update` on `assistant/message` replaces `blocks` and `usage` wholesale (`packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts:265-272`), and `projectAssistant` prefers the settled node's blocks, seq, and time. The one chunk-derived value that survives finalization is `firstTokenTime`, stamped only at `:128-130` and read at `:163`, which feeds time-to-first-token and decode wall time in `packages/client/ui-conversation/src/client/chat/turn-metrics.ts:42-47`. `turn-tail.ts` looks chunk-dependent and is not: `:86` resets `streamedText` to false when the message lands, and `:96` consults it only for an unfinalized step.

Nothing else reads chunks off a history page. Search excludes them (`packages/session-query/session-query/src/extraction.ts:34` returns an empty string), the log export streams the durable artifact through `readRaw` (`packages/host/apiproxy/src/session-export.ts:243`), `llm-replay` derives its script from the session file directly (`packages/test-support/llm-replay/src/index.ts:280`), the aggregate first-token figure in `sessionStats` folds the live log (`packages/session/session-stats/src/projection.ts:195`), and both SDKs project the live event stream rather than history. A chunk that no message cites — a genuinely interrupted stream — is not superseded and stays on the page, which is what keeps an interrupted transcript renderable.

## Measured economics

Re-serializing one real tail page (7513 events, 42 finalized messages, 42 usage chunks):

| Page | Raw | gzip | gzip vs current |
|---|---|---|---|
| current | 2,553,490 | 233,105 | 1.00x |
| drop every superseded chunk | 559,218 | 134,467 | 1.73x |
| keep the first token delta per message | 568,469 | 135,261 | 1.72x |
| keep the first token delta and the usage chunks | 576,771 | 135,936 | 1.71x |

Raw bytes fall 4.6x and compressed bytes fall 1.73x, because chunk events are highly repetitive and the deflate window already captures most of what the filter would remove. On the 2.8 Mbit/s link that is 666 ms against 384 ms — about 280 ms per session open. A raw-byte share is the wrong estimator for a compressed transport, and the 77.7% figure that motivated this proposal overstates its value by a factor of about four.

## Alternatives considered

- **Keep the first token delta of each finalized message** (the third row above) — the cheapest complete answer to the only real dependency: `firstTokenTime` is stamped for the first token delta alone (`assistant.ts:128`), so retaining exactly that event preserves it byte for byte, including `resetForRetry` carrying the pre-retry stamp across `llm/retry` (`:72-78`). It costs 42 events and 794 gzipped bytes and needs no session-log or `HistoryEntry.view` change. It is not rejected on its merits; it is rejected with the proposal, because it still buys only 1.72x.
- **Carry `firstTokenTime` on `assistant/message`, or compute it into `HistoryEntry.view`** — rejected: both widen a durable or wire contract to recover a value the variant above preserves for free.
- **Lower `PAGE_MESSAGES`** (`packages/client/runtime/src/client/sessions/session.ts:32`, currently 50) — a comparable saving from a constant: the same session measures 1.57 MB raw at 30 and 313 KB at 10. It trades initial transcript depth for bytes, is orthogonal to this note, and remains available as the cheaper lever.
- **Do nothing** (chosen) — response compression at the reverse proxy and conditional revalidation for plugin bundles, both settled alongside this investigation, already removed the dominant cost; see [plugin bundle revalidation](../../implemented/bug-fix/2026-08-25-plugin-bundle-revalidation-etag.md). A history page is roughly 666 ms of the about one second a remote session open now costs, and 280 ms of that does not pay for the blast radius below.

## What we give up

Nothing in shipped behavior; what the proposal would have cost is the reason it lost.

`paginate` would stop emitting one contiguous raw range, a property `packages/host/apiproxy/README.md:27` states and compaction relies on to keep a `compaction/summary` record on the page of the replacement that cites it. About twenty host and client specs assert chunk-carrying pages — `packages/host/apiproxy/tests/api-proxy-view.spec.ts:294` appends 128 chunks and cites them at `:307` — six or more browser e2e tests count chunks arriving from `session.history`, and the `ui.expected.md` goldens for loaded-history scenarios would need refreshing.

Two questions would have to be settled before any implementation: whether `hasMore` and `beforeSeq` paging stays correct when a filtered page's first surviving event sits above `cut` (`api-proxy.ts:253` returns `hasMore: cut > 0`, and the client pages by the window's base seq), and that a legacy `assistant/message` without `sourceEventSeqs` leaves its chunks unfiltered, so the projection is not uniform across logs.

## Related

The broader form of this idea — dropping `assistant/chunk` from the durable log — was rejected separately in [persist assembled assistant messages, not stream chunks](../simplification/2026-06-20-assembled-assistant-messages-only.md). That note's blockers, high-fidelity replay and partial failed streams reading persisted chunks, do not apply here: this proposal narrows only the RPC projection and leaves the log intact. It fails on economics instead, so neither note supersedes the other.

Pagination already treats chunk provenance as load-bearing: [large history provenance is scanned without argument expansion](../../implemented/bug-fix/2026-08-04-large-history-pagination-call-stack.md) walks `sourceEventSeqs` one element at a time and rejected truncating it during pagination, because that can cut a page inside a message and violate replay grouping.
