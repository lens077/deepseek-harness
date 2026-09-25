# Agent Note: Session reading grace and retained monitoring

Status: implemented

English | [中文](2026-09-26-session-reading-grace-research.zh.md)

## Problem

Navigation does not establish that a user read an answer or finished reviewing the work. Consuming attention state on an accidental open loses a reminder; dismissing a running Session on open removes its monitoring entry. Unread exposure, monitoring membership, and task completion need separate decisions.

## Decision

[Opening a pinned-area row](../../../../packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx), by click or shortcut, only navigates. It neither dismisses automatic membership nor changes a manual pin. Explicit unpin retains its existing dismissal semantics. [Completed membership](../../../../packages/client/ui-digest/src/client/select.ts) includes unread and seen-but-unhandled work under the existing review window; marking seen does not mean handled or unpinned.

The `ui-digest` [settings](../../../../packages/client/ui-digest/src/nav-settings.ts) own `readAcknowledgement` (`automatic` by default, or `manual`) and `readGraceSeconds` (integer 1–60, default **5 seconds**). Five seconds is an anti-accidental-open product heuristic, not a paper-derived reading duration. Automatic acknowledgement requires authoritative settings and inbox state to be ready; loading or unavailable settings never enable default automatic acknowledgement. The current conversation header offers **Mark as viewed** for an unread completed reply in either mode, independently of settings availability once the inbox is ready.

`ui-chat` publishes the read-only `chatReplyExposure` observable, containing `{sessionId, seq}` or `null`. Only the latest turn's settled closing answer qualifies, and that turn must be completed. [Exposure measurement](../../../../packages/client/ui-chat/src/client/chat/reply-exposure.ts) requires a visible document, browser focus, and a readable answer slice within clipping ancestors whose sampled point hits that answer rather than an in-application overlay. Reasoning-only content and clipped slivers do not qualify. Static reading needs no continuing mouse or scroll activity, and the whole answer need not fit on screen.

[ReadingGrace](../../../../packages/client/ui-digest/src/client/reading-grace.ts) counts one continuous interval for the selected unread reply. A different selected Session, lost focus, backgrounding, failed exposure, pending interaction, a different reply, or a change to acknowledgement mode, duration, or readiness cancels/resets it; short visits do not accumulate. The [acknowledgement writer](../../../../packages/client/ui-digest/src/client/index.ts) rechecks the exact completed reply sequence before advancing durable `lastSeenSeq`. Durable seen or handled marks consume the matching transient completion reminder, including acknowledgements from another browser.

[Session selection](../../../../packages/api/session-controller/src/client/sessions/manager.ts) leaves the transient reminder intact. Every observed running-to-idle transition arms it, including the selected Session; `acknowledgeCompletion` removes it immediately and batches subscriber notification in a microtask. No model input, Session log event, or durable inbox schema migration is introduced.

Each Host `api-session/status` transition carries a required complete generic projection baseline. The matching Client seeds it under higher-sequence-wins before applying the running state and arming a reminder, so delayed control delivery cannot pair idle with an older, already-seen reply and consume the new reminder. This transport requirement does not change the Session log format.

## Evidence

These primary studies address related questions, not unread-grace optimization. The first two summaries use publication/author abstracts; the third uses the full author manuscript. Checked 2026-09-26.

- **Kim et al., 2014, “Modeling Dwell Time to Predict Click-level Satisfaction” (WSDM).** Page topic, content length, and readability affected the dwell time associated with satisfaction. The paper explicitly challenges a single threshold independent of page characteristics. Its discussion of **30 seconds or longer** describes an existing search heuristic, not a validated email/chat reading delay. [Institutional publication and abstract](https://www.microsoft.com/en-us/research/publication/modeling-dwell-time-to-predict-click-level-satsifaction/).
- **Duggan and Payne, 2009, “Text skimming: The process and effectiveness of foraging through text under time pressure” (Journal of Experimental Psychology: Applied).** With time sufficient to read **half a document**, Experiment 1 found that skimming improved memory for important ideas relative to reading half the text, but not memory for less important details or inferences. Extracting the gist and retaining detailed meaning are different outcomes. These were expository-text experiments, not Chinese/code review or read-receipt tests. [University record and accepted-manuscript link](https://researchportal.bath.ac.uk/en/publications/text-skimming-the-process-and-effectiveness-of-foraging-through-t/) and [author abstract indexed by Europe PMC](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:19751073%20AND%20SRC:MED&format=json&resultType=core).
- **Sarrafzadeh et al., 2019, “Characterizing and Predicting Email Deferral Behavior” (WSDM).** The study combined **15 workplace interviews**, partly contextual inquiry, with **40,000 enterprise users**, approximately **3 million actions**, and **two weeks** of Outlook logs. Users deliberately marked already-viewed mail unread to remember pending work. Under the log definition, **12% of triage sessions** and **16% of daily active users** had a deferred message on weekdays. That definition required a later-session reply, reply-all, or forward; it misses reading-only and offline follow-up. The sample is enterprise email, and the interviews are from one company, not representative of all users. [Full author manuscript, §§2–3](https://arxiv.org/html/1901.04375v1).

## Limits

No direct experiment establishing an optimal unread-grace threshold was found in these sources. They do not validate a universal 3-, 5-, or 10-second cutoff. Dwell can indicate opportunity for exposure, not attention, comprehension, agreement, or completion: an open foreground page can still be unattended. Scrolling, including reaching the bottom by auto-scroll, is not proof of reading. English prose reading rates cannot be converted directly into a Chinese-character or code-reading formula.

## Alternatives considered

**Immediate read/dismiss on open.** Fast triage, but a navigation mistake consumes attention state and hides monitoring work; it conflates distinct user intentions.

**A length-derived reading clock or mandatory scroll-to-bottom.** Neither establishes comprehension; code, mixed-language answers, auto-scroll, assistive technology, and selective reading make these unreliable completion tests.

**Manual acknowledgement only for everyone.** Provides clearer intent but adds work to every ordinary read. Manual mode remains an option rather than a requirement.

## Consequences

Running monitoring and unfinished review remain accessible after navigation. The delay can annoy fast readers yet acknowledge distracted users. Shared durable seen marks affect other browsers; explicit pin, handled, todo, and snooze actions remain independent. User calibration for Chinese prose, code, short/long answers, accessibility, and multi-window reading is not established by the automated tests. Unwanted read transitions, missed follow-ups, and triage effort remain the relevant evaluation outcomes, not merely fewer badges.

## Verification

[Grace-period tests](../../../../packages/client/ui-digest/tests/reading-grace.client.spec.ts) cover continuous timing, interruption, reply/duration changes, and disposal; [exposure tests](../../../../packages/client/ui-chat/tests/reply-exposure.client.spec.ts) cover clipping, focus, visibility, overlays, reasoning exclusion, and observer cleanup. The [digest integration suite](../../../../packages/client/ui-digest/tests/browser-plugin.client.spec.ts), [workspace browser suite](../../../../packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx), and [Session manager suite](../../../../packages/api/session-controller/tests/manager.client.spec.ts) cover settings readiness, exact-reply acknowledgement, retained click/shortcut targets, and transient-reminder lifecycle. The [keyless browser scenario](../../../../apps/web/tests/session-reading-grace.e2e.ts) defines assembled delayed-rendering, navigation/overlay, manual-mode, and seen-but-unhandled cases. The five [status-observation regressions](../../../../packages/api/session-controller/tests/status-observation.client.spec.ts) cover delayed control delivery, newer projection preservation, stale list refreshes, and distinguishing prior-reply acknowledgement from the current reply. These named regressions do not establish a universally appropriate reading duration or a passing full GUI suite.

## Related

This decision owns navigation retention and exposure-based acknowledgement. The [durable inbox](2026-09-17-durable-session-inbox.md), [automatic pinning](2026-09-21-pinned-area-fold-menu-and-auto-pin.md), and [position shortcuts](2026-09-22-pinned-area-position-shortcuts.md) records remain active for storage, membership/dismissal policy, and keyboard binding rationale; each is only partially superseded.
