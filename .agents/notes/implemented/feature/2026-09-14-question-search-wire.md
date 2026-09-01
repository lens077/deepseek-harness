# Agent Note: Wiring the within-session question index

Status: implemented

English | [中文](2026-09-14-question-search-wire.zh.md)

> Scope: this note adds the transport [honest question search](2026-09-14-honest-question-search.md) deferred. That note owns the honesty design and remains current; nothing in it changed.

## Problem

`SessionQueryEngine.searchEvents` already searched one session's whole log, and the navigator already knew how to consume such an answer through `contract/question-search.ts`. Nothing connected them: `searchEvents` had no wire exposure, so no browser consumer could reach it, and the shipped GUI ran in `window-only` — searching the loaded window and saying so.

The prior change could not build that transport because all six wire files were carrying another agent's uncommitted work. Those files have since landed.

## Decision

**`session.searchQuestions` is a new wire operation over the existing service method.** No `session-query` change was needed, which was the point of checking the existing capability first: the request carries `sessionId` and `query`, and the response carries `{ items, complete }` where each item is `{ seq, time, snippet }`.

**Authorization reuses the read path rather than restating it.** The handler calls `historySourceFor(sessionId)` — the same read `session.history` performs — before it queries the index. An id the caller cannot read throws `SessionNotFound` there, so no query for an unreadable session ever reaches the provider. Restating visibility as a second rule would have created two places to keep in agreement.

**The provider's answer is re-checked, not trusted.** Hits are dropped unless they name this session, the `current` surface, and `user/message`. The request already asks for exactly that, so the filter is redundant on a correct provider and load-bearing on a wrong one; the cross-session `session.search` handler revalidates for the same reason.

**`complete` is derived from `nextCursor`, at the only place that knows it.** A cursor means the index holds matches this page does not carry. Mapping it at the handler keeps the honesty bit a fact about the query rather than a guess the client reconstructs from a full page.

**A separate `SESSION_QUESTION_RESULT_LIMIT = 50`,** larger than the cross-session limit of 20. These hits are rows in one session's own list rather than separate sessions to choose between, and the cost of truncation is a narrower query rather than a missed session. Both bounds stay fixed constants: they are product bounds the response schema enforces at every client boundary, not deployment tunables.

**Errors stay distinguishable all the way to the view.** An unmounted index, an unreadable session, and an aborted query return different business errors, and `apply.ts` throws on any of them rather than returning an empty page. The navigator's `failed` state depends on that: a rejection folded into `{ hits: [], complete: true }` would restore the original defect through the back door.

## Alternatives considered

**Widen `session.search` to accept an optional `sessionId`.** Rejected. Its result is `{ sessionId, snippet }` with no `seq`, so it cannot address a jump, and giving one operation two ranking modes would make the sidebar's contract depend on a field it never sends.

**Filter to questions in the client.** Rejected: it would ship whole assistant messages and tool calls over the wire to discard them in the browser, which is what the bounded snippet exists to avoid.

**Have the handler page until it has every match.** Rejected. It converts a bounded request into an unbounded one for exactly the queries that are already too broad, and `complete: false` lets the reader narrow the query — which is both cheaper and more truthful than a long list.

**Return `complete: true` when a page comes back short.** Rejected: page length is not the completeness signal, `nextCursor` is. A provider is free to return a short page and still hold more.

## Testing

`packages/host/apiproxy/tests/api-proxy-search.spec.ts` covers the handler: the filters and limit it sends, a complete page, an incomplete one, hits dropped for the wrong session/surface/type, refusal before the index for an unreadable session, an unmounted index, and abort mapping. Two were verified to reject an invalid implementation — returning a constant `complete: true` fails the incomplete-page test, and deleting the `historySourceFor` call fails the authorization test.

`packages/client/ui-conversation/tests/chat-apply.client.spec.tsx` covers the binding: the injected `searchQuestions` reaches the session service with the session id and query and preserves `complete: false`, and a rejected search throws rather than resolving empty. Deleting the error branch in `apply.ts` fails the second.

`packages/client/connection`'s fixture implements the operation over its own corpus, so keyless GUI scenarios exercise the real path.

Typecheck is clean on both faces; the touched packages pass 1387 tests. Twelve `directory-picker` and 87 `acp-snapshot` failures in the wider `test:gui` lane reproduce with these changes stashed and belong to concurrent work.

## Consequences

- The navigator now answers for the whole session wherever the web app composes `searchQuestions`; `window-only` remains the truthful state for a deployment that does not.
- `SessionsApi` gained a method, so every `ApiProxy` double implements it — two host test doubles and two client fakes were updated with the rest of the change.
- The response is bounded by construction: at most 50 hits of at most 240 code points, independent of session length. A thousand-turn session costs the same page as a ten-turn one.
