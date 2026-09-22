# Agent Note: Context-removal confirmation as a centered dialog

Status: implemented

English | [中文](2026-09-23-context-removal-confirmation-dialog.zh.md)

## Problem

Removing questions from model context was confirmed inside the question panel, as a strip above the list ([per-turn context removal](2026-09-22-per-turn-context-removal.md)). The panel opens upward from the composer floor, so the strip pushed the rows it was asking about downward and out from under the pointer that had just pressed the trash entry: the reader pressed a row's entry and the row moved. The strip was also pointer-only — no key confirmed it and no key cancelled it — and it hid the question texts of a multi-question selection behind the very list it displaced, so a reader confirming a five-question removal could not see what was leaving.

The inline placement existed for one reason: the panel closes on an outside pointer press, and a confirmation rendered outside the panel would be dismissed by the same press that reached it.

## Decision

**The confirmation is a centered modal dialog over a masked page,** built from the shared `Modal` primitive and portaled to the document body, so it sits at the middle of the viewport regardless of where the panel is anchored. The panel stops reflowing under the pointer, and a removal reads as the consequential decision it is.

**The outside-press rule is suspended while the dialog stands.** `QuestionNavigator` derives `removalOpen` from its removal state and skips installing the panel's `pointerdown` listener while it holds; that is what makes an out-of-panel confirmation possible at all. The panel therefore stays open behind the mask, and cancelling returns the reader to the same list position.

**Enter confirms, Escape cancels.** The dialog owns Escape and the mask through `Modal`'s own dismissal, and `QuestionNavigator` binds Enter for the duration of the `confirm` state. A running request answers neither: it drops the Enter binding, sets `dismissable={false}`, and disables both footer buttons, so one removal cannot be sent twice.

**The dialog names the questions that are leaving.** It lists the loaded question text of every pending turn under the count sentence, because the mask covers the selection the reader made. A question whose turn the loaded window holds no boundary for is not listed — the same rule that denies it a pick.

**Select-all completes multi-select.** Selection mode gains an entry that picks every removable row currently on screen and clears the picks again once they are all held. It is scoped to the visible rows, so it never silently picks a question a query is filtering out, and it disables when no visible row is removable.

**Picking is a list gesture, not a mode the reader must find first.** A Cmd/Ctrl press on a row adds or drops that one pick; a Shift press adds every removable row between the anchor and the pressed row, in the order the list currently stands, so a filtered list ranges over what the reader sees rather than over hidden history. Either press enters selection mode, and the last row a pick addressed becomes the anchor. A Shift press with no anchor — or one whose anchor a query filtered away — picks its own row and becomes the new anchor, because a range with one reachable end is not a range. A modifier press on a row that cannot be removed does nothing: it neither picks nor jumps the transcript. The explicit mode toggle stays, with a hint beside it naming the gestures.

**Holding Shift takes the range live, and the hovered row is always in it.** Shift is tracked as a held state, so a Shift press while the pointer stands on a row picks that row and everything removable back to the anchor without a click, and moving the pointer re-runs the range. Each recomputation starts from the picks held when the gesture opened, so a sweep shrinks as readily as it grows instead of accumulating every row crossed. Releasing Shift commits by forgetting that starting point; a lost keyup — window focus leaving mid-gesture — releases it the same way, so a range can never stay open invisibly.

**Escape backs out one level at a time: an open range, then selection mode, then the panel.** Cancelling a live range restores exactly the picks the gesture started from and stays in selection mode. With no range open, Escape leaves selection mode and drops the picks; with neither, it closes the panel — which nothing did before. While the removal dialog stands, Escape belongs to the dialog alone.

## Alternatives considered

**Keep the strip and only add keys.** Rejected: the displacement is the complaint. A confirmation that moves the list it describes is wrong whether or not a key can answer it.

**Anchor the dialog to the panel (popover above the rail).** Rejected: the panel already spends the height between the composer floor and the transcript band, so an anchored card either overlaps the list or runs off the viewport on short windows — the failure the centered layout removes.

**A `role="alertdialog"` card written locally in ui-chat.** Rejected: `Modal` already owns the mask, the centering, the body portal, Escape, and the focus-visible chrome, and a second implementation of that in a feature package would drift from the shared dialog style. The trade is the generic `role="dialog"`; the dialog is `aria-modal` and titled, and the failure message inside it carries `role="alert"`.

**Confirm nothing for a single-row removal.** Rejected: removal changes what the model sees for the rest of the session and is not undoable from the panel; the count sentence is the only place that says the transcript keeps the rows.

**Let a plain press pick while the panel is open, with no mode at all.** Rejected: a plain press is how the reader jumps to a question, and the panel exists for that first. Modifier presses add picking without spending the gesture the list already owns.

**Range over the loaded questions rather than the displayed rows.** Rejected: under a query the two differ, and a range that quietly picks filtered-out questions removes turns the reader never saw named. The visible order is the only order the reader can reason about.

**Show the Shift range as a preview and commit it only on click.** Rejected: it needs a third row state between picked and unpicked, and the reader must still press to keep what they already see. Live picks reuse the state the list already draws, and Escape covers the mistake a preview was protecting against.

**Leave Escape unbound in the panel, or give it one fixed meaning.** Rejected on both ends. Unbound, a live sweep has no cheap way back: the reader who overshoots must re-press every wrong row, and a selection built over a long list is expensive to rebuild — that cost is what makes the cancel worth its wiring, which is one branch on a listener the panel now needs anyway to close on Escape. One fixed meaning is worse than none: bound only to closing the panel, Escape throws away a selection the reader spent effort on, and bound only to cancelling, the panel keeps refusing the key every popover answers. The ladder keeps each press the smallest undo available, and its levels are visible on screen — a sweep in progress, checkboxes, the panel — so the reader can predict which one answers.

**Undo a committed range with Escape too.** Rejected: once Shift is released nothing on screen distinguishes a pick made by a sweep from one made by a press, so an Escape that removed only the last sweep would act on invisible history. Cancellation ends at the gesture it belongs to; the next level, leaving selection mode, is the honest coarse undo.

## Testing

`packages/client/ui-chat/tests/question-navigator.client.spec.tsx` covers the dialog: single-row and multi-select confirmation, the listed question texts, Enter confirming and Escape cancelling, an unrelated key leaving the request standing, a running removal refusing a second answer and refusing dismissal, a press inside the portaled dialog leaving the panel open, select-all picking and clearing only visible removable rows, the failure dialog reporting the refusal and closing, and the list gestures: a Cmd/Ctrl press entering selection and toggling one pick, a Shift press taking the removable rows between the anchor and itself while stepping over a running turn, a Shift press with no reachable anchor picking its own row, and a modifier press on a non-removable row doing nothing. The held-Shift sweep has its own cases: the hovered row joining the picks with its range, the range shrinking when the pointer sweeps back, a hovered non-removable row adding nothing, a release committing so a later Escape cannot take it back, Escape cancelling an open range down to the picks it started from, the Escape ladder stepping through range, selection mode, and panel, and the removal dialog keeping Escape while it stands.

## Consequences

- `QuestionNavigator` renders through `Modal` and `Button` from `dsh-client-ui-primitives`; the panel-local confirmation styles are gone, replaced by the dialog's list, key hint, and destructive-action classes in `ChatView.module.css`.
- The panel's `pointerdown` listener is now conditional. A future control that also renders outside the panel must extend the same suspension rather than adding a second rule.
- Selection survives a cancelled confirmation, so a misclicked removal costs one Escape rather than a rebuilt selection.
- The anchor is a row seq, held only while the panel is open. Closing the panel, leaving selection mode, and a landed removal all clear it, so a later Shift press never ranges from a row the reader has forgotten.
- macOS delivers Ctrl-press as a context-menu gesture, so Cmd is the picking modifier there; Ctrl serves Windows and Linux. Both are accepted everywhere rather than branched on platform.
- The panel now listens for Shift and Escape on the document while it is open. A held Shift changes picks with no press, so any later control that reads Shift inside this panel must state which gesture owns it.
