# Agent Note: the question panel offers to load the whole history

Status: implemented

English | [中文](2026-09-18-question-panel-load-all-history.zh.md)

## Problem

The loaded event window is a suffix of the session. The question panel says so whenever earlier pages are unloaded — "listing loaded questions only; earlier ones are not loaded yet" — and the whole-session search answers a query without loading them ([honest question search](2026-09-14-honest-question-search.md)). What the panel did not offer was the reading the notice describes as missing: the reader who wants to step through every question of a long session, or to read the whole transcript, had only the transcript's one-page "load earlier" button and the previous-question arrow, one page per press, with no way to ask for all of it.

The earlier `onLoadAll` had been removed with that note because it lied — it pulled one page under a name that promised the session — and because search made it unnecessary for finding a question. It was never unnecessary for reading one. The product owner asked for the button back as an explicit whole-history load.

## Decision

The rail carries a **Load all history** entry directly under its search entry, exactly while `hasMore` holds or a load-all is in flight; it stands whether or not the panel is open, because the search it feeds is what its position says it serves. One press sets a `loadingAll` request in `ChatView`; an effect issues the existing anchored `loadOlder` path again each time a page lands and more remains, and clears the request when the session has no earlier events. The list and the stepping arrows then cover every question, and the entry leaves the rail with the panel's notice.

The loop stops on a page that settled without moving the window's head seq. The runtime keeps `hasMore` true after a failed page, so a loop keyed on `hasMore` alone would retry a persistent failure without end; keyed on progress, a failed or empty page ends the request and restores the offer, and the reader retries deliberately.

Each page goes through `loadOlderAnchored`, which records the reader's settled row before the request so the prepend lands without moving what they are reading. Loading everything is therefore the same operation as paging back by hand, requested once, with the same scroll guarantee.

This is a different operation from search, and the cost the search note quantified is real: the whole transcript ends up resident in the browser. That is what the reader asked for by pressing the button, not a side effect of opening the panel — the panel loads nothing on open, and the button names what it does.

## Alternatives considered

**Keep the panel search-only and rely on "load earlier"** — rejected by the product owner: a session of hundreds of turns needs a way to ask for the whole history in one gesture, and the notice that earlier questions are not loaded should sit next to the way to load them.

**Page automatically when the panel opens**, as the removed `onLoadAll` did — rejected; it is the behavior the search note removed, and it makes opening a panel change what a query answers.

**Loop on `hasMore` alone** — rejected; the runtime leaves `hasMore` true after a failed page, so the loop would issue requests without end. Progress of the head seq is the observable that distinguishes a landed page from a failed one.

**Add `loadAll` to the conversation service and slot contract** — rejected for now; the request is a view-level repetition of an existing slot capability, and widening `ChatViewSlotProps` for one caller is the public-method-with-one-caller smell `packages/AGENTS.md` names. If a second surface needs the whole history the loop moves to the service.

## Consequences

- `QuestionNavigator` takes `loadingAll` and `onLoadAll`; two navigator tests pin the offer's presence and its busy state, and two `ChatView` tests pin the loop's completion and its stop on a page that made no progress.
- `.questionLoadAll` has a renderer again, styled as a peer of the search entry and the arrows; the busy state swaps the icon for a spinner and disables the entry rather than dimming it.
- The honest-search note's consequence that the button was removed is superseded by this note: search still never loads the session, and the load is an explicit request.
