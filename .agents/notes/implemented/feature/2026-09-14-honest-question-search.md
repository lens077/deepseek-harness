# Agent Note: Honest question search

Status: implemented

English | [中文](2026-09-14-honest-question-search.zh.md)

## Problem

The question navigator's search box filtered `questions` — the questions inside the loaded event window. That window is a suffix of the session: it holds the newest page and whatever earlier pages the reader has paged in. Text that exists only in an earlier page produced an empty list.

An empty list is an answer. Rendered without qualification it reads as "no question matches", and nothing distinguished it from the same empty list produced by a session that genuinely contains no match. The feature was not merely weak; it was wrong in a way the reader could not detect. That is the defect this note is about, and it is why "reduce the scope" was never an acceptable resolution — a narrower search that still lies is the same bug.

The panel's `onLoadAll` did not repair this. Despite the name it pulled exactly one page:

```tsx
onLoadAll={() => { if (hasMore && !loadingOlder) loadOlder() }}
```

The panel also invoked it on every open, so opening the panel silently grew the window by one page and changed what the same query would answer. A reader who pressed the button repeatedly could eventually load the session, at a cost the original request explicitly refused: the whole transcript — message bodies, tool calls, images — resident in the browser to answer a question about question text.

## Decision

Search the whole session on the host, transfer only question text and a jump address, and make every answer state its own reach.

### Reuse: `searchEvents` already is the lightweight question index

The request was for a new host interface returning only question text. Before designing one, we checked what `SessionQueryEngine` already exposes, and the capability exists in full — `packages/session-query/session-query/src/index.ts:124`, "Search events within one live-preferred logical session":

| Requirement | Existing capability |
| --- | --- |
| Restrict to user questions | `SessionEventMetadataFilter` admits `{ kind: 'type', values: ['user/message'] }` and `{ kind: 'surface', values: ['current'] }` |
| Jump target | `SessionEventSearchHit extends SessionEventRecord`, which carries `seq`, `time`, `type`, `surface` |
| Text without message bodies | `snippet`, a bounded plain-text excerpt |
| Partial-result signal | `nextCursor`, absent only on the final page |
| Session scoping | `SessionEventSearchRequest.sessionId` |

`extraction.ts` decides what a `user/message` contributes: `contentText` over its content blocks, where `blockText` returns `[]` for `reasoning`, and reduces `tool-call` to name and arguments. A user question's text blocks are exactly what the index holds. The SQLite backend implements the method with cursor generations and a `snippetChars` bound (default 240).

So no new service method was added. Under `packages/AGENTS.md` ("Require evidence for public choices", and the inverse smell of a public method with one caller) a new method would have needed evidence that the existing one cannot serve this consumer, and it can. The gap was never the capability — it was that `searchEvents` has no wire exposure, so no browser consumer could reach it.

### The honesty guarantee does not depend on the wire

`ChatViewInjected.searchQuestions` is optional, and its absence is not a degraded silent state — it is the `window-only` state, which tells the reader in as many words that only loaded questions were searched. **The view cannot claim a session-wide negative without a session-wide search, whether or not the transport exists.**

This change shipped the contract, the client consumption, and that guarantee while the six wire files were carrying another agent's uncommitted work, since `git add <path>` cannot select part of a file. The transport landed separately once those files settled — see [wiring the question index](2026-09-14-question-search-wire.md) — and the optional prop is what let the two arrive in either order.

Reusing the cross-session `session.search` was rejected on the merits, not only on the file conflict: its request payload is `{ query }` with no session id, and its result is `{ sessionId, snippet }` with no `seq`. It cannot scope to a session and cannot address a jump.

### Honesty is a state distinction, not a disclaimer

The list on screen never speaks for the session by itself. `chat/question-search.ts` keeps the outcomes apart, because an empty list means something different in each:

| State | What the reader is told |
| --- | --- |
| `resolved`, complete, empty | No question in this session matches — **the only state that asserts a negative** |
| `resolved`, incomplete | The list is partial; narrow the term |
| `searching` | A whole-session search is running |
| `failed` | The session was not queried; other matches may exist |
| `window-only` | Only loaded questions were searched |

A rejected search resolves to `failed`, never to an empty `resolved`. This is the arm most likely to be "simplified" later into an empty list, which would silently restore the original defect; the component test `reports a failed search instead of showing an empty list` exists to fail when that happens.

### Jumping without loading the session

A hit inside the window jumps by index. A hit outside it is addressed by `seq` and pages back along the existing mechanism: `ChatView` records the requested seq and drives the existing `loadOlder` until the window covers it, then jumps. No second scroll path was introduced. Paging stops when `hasMore` is false — an unreachable hit ends the attempt rather than spinning forever, since a permanent spinner is its own false claim.

### Quantified: what this avoids transferring

A hit is `{ seq: number, time: number, snippet: string }` with the snippet bounded at 240 code points. A realistic question snippet of 40 CJK characters is ~120 bytes UTF-8, plus ~40 bytes of JSON envelope and numbers: **~160 bytes per hit**, with a hard ceiling near 760 bytes at the snippet bound. One page of 20 hits is **~3 KB typical, under 16 KB worst case** — bounded by page size, independent of session length.

The alternative — the behavior `onLoadAll` gestured at — transfers session events. A single turn's raw events (user message, assistant message, tool calls with arguments, tool results) run from single-digit KB to hundreds of KB when results carry file contents, and images are larger by orders of magnitude. For a thousand-turn session, paging in the whole log to filter question text in the browser means transferring and retaining tens to hundreds of megabytes, and keeping every rendered node's state resident, to answer a query whose entire answer is a few kilobytes. The user's concern about memory and CPU was well founded; the ratio here is roughly three to five orders of magnitude.

The bound is enforced where the complete result is known, per `packages/AGENTS.md` ("Apply bounds to the complete result"): the page limit bounds the item count and `snippetChars` bounds each snippet, so the emitted value is bounded in both dimensions rather than only per item.

### The entry is its own button

Search had been reachable only by opening the panel from the tick strip, which made it a mode discovered by exploration. It is now a standing button beside the navigation arrows, visible without hover, as the request specified. On this line the strip itself is gone — [the rail reduced to stepping](2026-09-02-question-rail-reduced-to-stepping.md) removed every surface that redrew the question index and named a standing entry button as the way to bring search back — so the entry is the rail's third and only other control, and the panel it opens lists questions only on request.

`onLoadAll` and `chat.questions.loadAll` were removed rather than repaired at the time: a whole-session search finds a question without loading every question. An explicit whole-history load later returned as a separate operation for reading, not finding — see [the question panel offers to load the whole history](2026-09-18-question-panel-load-all-history.md).

## Alternatives considered

**Add a new host method returning only question text**, as the request literally described — rejected because `SessionQueryEngine.searchEvents` already returns exactly that under `type`/`surface` filters. Under `packages/AGENTS.md` a new public method needs evidence the existing one cannot serve the consumer, and the table above is evidence that it can. A second method would also have split within-session search across two entry points that must agree about what a question is.

**Reuse the existing `session.search` wire operation** to avoid touching contested files — rejected on the merits before the conflict mattered. Its payload is `{ query }` with no session id and its result is `{ sessionId, snippet }` with no `seq`, so it can neither scope to one session nor address a jump. Widening it would also change what the sidebar's cross-session search returns.

**Make `onLoadAll` honest — page the whole session with progress and cancellation** — rejected as the primary fix, and the button was removed instead. It is the memory cost the design exists to avoid (see the quantification above), and with a whole-session search it buys nothing: the reader wants to find a question, not to hold every question. Keeping a truthful button that is still the wrong operation would have preserved the shape of the defect.

**Ship the client with search disabled until the wire lands** — rejected because it trades a visible limitation for an invisible one. `window-only` shows the matches it can find and states what it did not search; a hidden entry teaches the reader that the feature does not exist, and an entry that silently filters the window is the original bug.

**Let a failed search fall back to filtering the loaded window** — rejected because the fallback is indistinguishable from success. The reader would see a plausible short list with no indication that the session was never queried, which is precisely the class of error this note removes.

## Consequences

- The navigator can no longer report a session-wide negative it did not verify. Nine component tests pin the state distinctions.
- `QuestionNavigator` props changed: `onLoadAll` and `loadingOlder` are gone; `onSelectSeq` and optional `searchQuestions` replace them.
- A deployment that composes no `searchQuestions` runs in `window-only`: search results come from the loaded window and say so. This is a visible, honest limitation, not a silent one.
- `.questionLoadAll` was left without a renderer until the explicit whole-history load reused it ([note](2026-09-18-question-panel-load-all-history.md)).

## Follow-up

The wire binding this note deferred has landed as described, with no change to this design: [wiring the question index](2026-09-14-question-search-wire.md).
