# Agent Note: Mobile compact and pure UI presentation

Status: implemented

English | [中文](2026-09-20-mobile-compact-and-pure-ui.zh.md)

## Problem

The mobile Web GUI gave too much space to session chrome and the composer. Opening or switching a Session also focused the editor, which opened the phone keyboard and displaced the reading position. Header utilities and panel controls consumed space that was secondary to transcript content.

## Decision

The composer no longer focuses itself on mount, unlock, or Session switch. Mobile composer controls stay on one row while they fit and wrap otherwise ([phone toolbar note](2026-09-25-phone-composer-toolbar-fit.md)), the model label yields width with start-side ellipsis, and the draft surface has a compact resting height. A phone-only expand control grows the draft scrollport to 45dvh with an internal scrollbar.

The phone tab strip hosts the statistics pills after the Flow tab. File-open utilities, Session-log utilities, the right-panel corner control, and the mobile Session-panel toggle are hidden on phones. The tab strip and header use reduced spacing and fixed one-line controls.

Theme settings own a `pureUi` boolean, defaulting to `false`. The setting is persisted with the existing `ui-theme` scope and is exposed to both the [Layout Settings row](2026-09-26-shared-layout-settings-and-desktop-density.md) and the phone header switch beside the gear. The layout publishes `data-pure-ui` on the frame. In pure UI, the Session header and docked composer disappear while the current question remains as plain text at the transcript's top-left. A floating bottom-right button reveals the composer on demand; elected interaction overlays remain mounted.

## Alternatives considered

**Keep automatic focus on desktop only.** Rejected because the request identifies Session opening as the unwanted behavior and a single rule avoids device-specific focus races.

**Add a second state store for pure UI.** Rejected because the theme-owned presentation observable already provides a stable cross-entry source and the sidebar can consume it directly.

**Reuse the general sidebar footer-action slot for the phone toggle.** Rejected because that slot is also a desktop rail surface and would make the phone-only action depend on unrelated footer composition.

**Remove the statistics pills on phones.** Rejected because their lifecycle and token readings remain useful; moving them beside Flow keeps them discoverable without increasing composer height.

## Verification

The ui-theme, ui-sidebar, ui-layout, ui-conversation, ui-chat, and ui-model-selection focused suites pass. The client TypeScript project and UI i18n verification pass. Changed client packages bundle successfully. Local Playwright captures at 390px and 1280px verify compact tabs, the phone expand state, the pure UI header fold, the plain question text, and the floating composer control.

The repository GUI suite passes all changed behavior but reports two unrelated existing failures: the tool-call-tree fixture and the corner-shape scan for `ui-theme` AppearanceRow styles. The package dependency verifier also reports pre-existing `ui-session-files` manifest violations.

## Consequences

The pure UI preference changes presentation only; it adds no Session event, model-visible input, wire operation, or durable Session record. The phone tab strip has a new declared slot, so the generated Client catalog must remain synchronized with the ui-conversation contract. Users can always restore the full chrome from Settings or the phone header switch.
