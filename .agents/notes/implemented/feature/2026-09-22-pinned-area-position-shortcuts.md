# Agent Note: Pinned area position shortcuts

Status: implemented

English | [中文](2026-09-22-pinned-area-position-shortcuts.zh.md)

## Problem

The sidebar **置顶** area from [Pinned sessions in the sidebar and the digest](2026-09-11-pinned-sessions-in-sidebar-and-digest.md) lists the Sessions a user is watching, but reaching one still takes the pointer: find the row, click it. A user cycling between several live Sessions wants to press one key for the first pinned row, another for the second, and so on, the way a browser's ⌘1…⌘9 reach its tabs. The keys must be the user's own choice — recorded by pressing them, not typed as text — and must not be bound at the operating-system or browser level, where they would fire from every window. A chosen chord that the browser or the operating system already answers (⌘T, Ctrl+1, ⌘Q, Alt+F4) may never reach the page, so the user must be told before it is bound.

## Decision

The pinned area binds one chord per listed position, records chords by keypress with a conflict warning, and answers them from this tab's `keydown` events only.

### Positions, not Sessions

`pinnedShortcuts` in the workspace viewing store is a list of ten entries, one per pinned-area position in row order, each a canonical `[Ctrl+][Meta+][Alt+][Shift+]Key` string or `null`. The default is the digit row, `1` through `9` then `0`. `pinnedShortcutsEnabled` (default on) switches the whole list off without losing it. Both persist with the rest of the viewing state (persist key bumped to `v12`), so the bindings are browser-local: they never reach the Host, and each browser profile keeps its own. Binding a chord to a position releases it from any other position, so a chord opens exactly one row.

A position is a slot in `pinnedRows`, the same recency-ordered list the area draws, so the keycap each row wears is the truth the listener reads. Opening through a chord runs the same `openPinnedRow` as a click: the Session opens, a pinned mark stays (the user put it there to come back to), and a row listed by status alone is dismissed until its statuses change, so the pinned rows are a keyboard the user learns while the status rows behave as an inbox.

### One listener on this tab's document

`WorkspaceBrowser` attaches one `keydown` listener to `document` while pins are enabled, the sidebar area is composed in, and the shortcuts are switched on, folded or not. The listener skips events something closer already default-prevented (the recorder, a menu), matches the first position whose chord the event spells, keeps a chord without Ctrl, Meta, or Alt silent inside inputs, text areas, selects, and contenteditable hosts (the composer), and otherwise prevents the default and opens the row at that position. There is no registration outside the page: closing the tab ends the shortcuts.

### Recording by keypress, warning on conflict

The area's ⋯ menu grows a **快捷键** group: **启用快捷键** (a check that keeps the menu open) and **编辑快捷键…**, which switches the chords on, unfolds the area, and opens an inline editor between the header and the rows. The editor shows ten keycaps, one per position, plus **数字键 1–0** and **全部清除**. Clicking a keycap starts recording on it: the next keydown is spelled by `spellPinShortcut` (the physical letter or digit from `event.code` when the layout reports one, modifiers in canonical order), a modifier alone, IME composition, or key repeat is waited past, and Tab, Enter, Esc, Space, Backspace, Delete, or any key outside letters, digits, arrows, Home/End/PageUp/PageDown, and F1–F12 is refused with a status line. Escape cancels, Backspace or Delete clears the position, and losing focus cancels. `pinShortcutConflict` then classifies the chord for the detected platform (`navigator.userAgentData.platform`, then `navigator.platform`, then the user agent): the browser's own bindings (⌘ plus a letter, digit, or arrow on macOS; Ctrl plus a letter or digit, Ctrl+PageUp/PageDown, Alt+←/→/Home/D/E/F, and the bare F1/F3/F5/F6/F7/F10/F11/F12 on Windows and Linux) or the operating system's (⌘Q/H/M, ⌘⇧3/4/5, ⌃⌘ chords, Ctrl+arrows, and function keys on macOS; Win/Super chords, Alt+F4, Ctrl+Alt+arrows everywhere else, plus Ctrl+Alt+T/L and Alt+F-keys on Linux). An unclaimed chord binds at once; a claimed one is held in the keycap in the warn color with a `role="alert"` line naming the owner and **仍然绑定** or **重新录制**. A hint under the keycaps notes that chords without a modifier stay silent while an input has focus, shown only while such a chord is bound.

The chord is drawn in the platform's notation by `formatPinShortcut`: `⌃⌥⇧⌘` glyphs run together on macOS, `Ctrl+Alt+Shift+Win` (or `Super`) elsewhere. Each pinned row's `SessionNodeItem` takes a `shortcut` label and draws it as a `<kbd>` keycap between the title and the time, kept through hover so the key is readable at the moment of reaching for it; the keycaps hide when the shortcuts are off.

`pin-shortcuts.ts` is a pure module owned by `ui-workspace`; the digest's toggle-shortcut recorder solves a neighbouring problem in `ui-digest`, and a feature plugin may not import another's values, so the two stay separate until a shared owner exists.

## Alternatives considered

**Bind chords to Session ids.** Rejected: the user asked for "the first pinned Session, the second…", and a Session-keyed map would silently orphan a binding when its Session is unpinned while the row that took its place has none. Positions also make the ten keycaps a stable keyboard the user learns once.

**Store the bindings in the durable `session-pins` settings.** Rejected: the user asked for this tab only, not a global binding, and a chord's meaning depends on the keyboard and browser in front of the user; a browser-local viewing preference is the seat the fold and the auto-pin dismissals already use.

**A text field for the chord.** Rejected by the brief: typing `Ctrl+1` invites spelling errors and layout confusion, while pressing the chord records exactly what the listener will see, physical key included.

**Refuse conflicting chords outright.** Rejected: the browser's and the system's tables vary by version, extension, and window manager, and a user who has rebound ⌘1 in their browser should be able to use it here. A warning with an explicit **仍然绑定** keeps the decision with the user while making the risk visible.

**Unpin a marked row when its chord opens it.** Rejected after use: a chord that removes its own target turns the keyboard into a stack that pops, so the second press reaches a different Session than the keycap promised; the mark is the user's, and only the status listing is the area's to clear.

**Suppress a modifierless chord everywhere but the sidebar.** Rejected: the shortcut's point is reaching a pinned row from wherever the user is; only editable fields, where the key means typing, need the silence.

**Reuse `ui-digest`'s `toggle-shortcut.ts`.** Rejected by the client export discipline: a feature plugin must not runtime-import another feature plugin's values. Promoting the recorder to a shared owner is deferred until a third consumer appears.

## Consequences

Every pinned row now carries a keycap, and the digit keys open pinned rows whenever focus is outside an editable field; a user who dislikes that clears the list or switches the group off from the ⋯ menu. `dsh.workspace.view.v11` persisted viewing state is abandoned for the `v12` key; grouping, ordering, expansion, and fold preferences reset once. A chord the user binds over a conflict warning may still be taken by the browser (⌘W closes the tab before the page sees it); the warning is the only defence. The conflict tables are curated, not exhaustive, and are kept in `pin-shortcuts.ts` beside their tests.

## Verification

`ui-workspace` specs pin the platform detection, chord spelling (physical codes, transient keys, refused keys), exact matching, the command-modifier rule, the editable-target rule, the conflict tables per platform, the notation per platform, and the assign-releases-elsewhere rule in `pin-shortcuts.client.spec.ts`; the browser spec pins the row keycaps, the digit press opening a marked row while keeping its mark and dismissing a status-listed one, silence in the search field and on default-prevented or unmatched presses, the menu switch and the settings-off case, a command-modifier chord firing inside an input, the recorder's status, refusal, transient wait, binding, release, Escape, blur, Backspace, preset, clear, close, and the conflict flow with **仍然绑定** and **重新录制**.

## Related

- [Pinned sessions in the sidebar and the digest](2026-09-11-pinned-sessions-in-sidebar-and-digest.md) owns the area and the seat this note extends.
- [Pinned area fold, ⋯ menu, and auto-pin statuses](2026-09-21-pinned-area-fold-menu-and-auto-pin.md) owns the ⋯ menu the shortcut group joins and the viewing-store persistence the bindings share.
- [Configurable digest panel toggle shortcut](2026-09-20-configurable-digest-toggle-shortcut.md) owns the neighbouring durable, Host-validated chord recorder this note deliberately does not share.
