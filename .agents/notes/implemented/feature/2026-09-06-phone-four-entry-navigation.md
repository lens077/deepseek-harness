# Agent Note: Four-entry phone navigation

Status: implemented

English | [中文](2026-09-06-phone-four-entry-navigation.zh.md)

## Problem

A desktop sidebar and conversation compete for the same narrow phone viewport. Users need to check work, handle requests, browse Workspaces, and start a conversation without navigating a compressed desktop rail. Giving each status its own bottom entry makes the navigation crowded.

## Decision

Below 768px, the [layout](../../../../packages/client/ui-layout/README.md) presents full-width content with fixed phone navigation. The four entries are Overview, Pending, Workspaces, and New Session; Settings stays in the top header. Desktop retains its column layout. The frame owns transient navigation and passes it through existing sidebar and center-overlay slots; feature plugins retain their data and actions.

[Pending](../../../../packages/client/ui-digest/README.md) groups waiting interactions and finished unread sessions with the existing personal todo list. Manual Add to todos remains a user decision stored by the [durable inbox](2026-09-17-durable-session-inbox.md), not a separate phone task domain. Project todo documents remain distinct from these personal tasks.

[Workspace browsing](../../../../packages/client/ui-workspace/README.md) proceeds from the Workspace list to one Workspace's Sessions and then to a conversation. Phone New Session explicitly creates an ungrouped scratch Session. Desktop New Session retains its Workspace selection rules.

The [conversation shell](../../../../packages/client/ui-conversation/README.md) uses full phone width and places its file rail behind a disclosure that starts closed. A scratch Session's resolved cwd, not Workspace membership, satisfies the composer's directory prerequisite; other input blockers remain effective. The [Settings dialog](../../../../packages/client/ui-settings-general/README.md) places section navigation above its content in a horizontal row. Both arrangements keep auxiliary navigation from consuming the main content width.

Overview has a phone-local tab selection initially set to Inbox, places running work first, and exposes a running-only count filter. Its Workspace filters scroll horizontally rather than consuming multiple rows.

Overview and Pending initially show compact session titles, with one expandable detail row per panel. This preserves scanning density without removing the existing prompt, reply, file, and action content. Workspace management remains reachable through an accessible header icon instead of a separate text row.

The [informational welcome notice](../../../../packages/client/ui-settings-models/README.md) skips phone presentation without recording acknowledgement or writing settings. Security and permission confirmations retain their own behavior.

[Phone appearance](../../../../packages/client/ui-theme/README.md) separates layout density from font size and desktop typography, so a denser layout does not discard a reader's text-size choice. Small layout reduces visible navigation labels while retaining accessible names and groups Overview filters into native selects and More. The [task-flow strip](../../../../packages/client/ui-task-flow/README.md) is opt-in on phones; its explicit Flow view remains available. Host scopes persist these preferences in their existing namespaces; remote memory scopes persist only the phone preferences in origin-local browser storage with schema-validated hydration.

## Alternatives considered

**Keep the compressed desktop rail on phones.** Rejected because the rail consumes conversation space and retains desktop navigation density on a narrow screen.

**Give running work, questions, completed unread work, personal todos, and new conversations separate bottom entries.** Rejected because the bottom navigation becomes crowded; Overview and Pending group related work without adding more destinations.

**Put Settings in the bottom navigation.** Rejected in favor of the top header so the four persistent entries serve the primary work tasks.

## Consequences

Phone navigation changes presentation, not Host storage, Session logs, or the meaning of personal todos. Feature plugins still own their operations, and phone and desktop layouts read the same data. Phone navigation is transient rather than a durable preference.

The durable-inbox note remains active because it owns persistence and unread derivation; this note owns the phone navigation decision rather than replacing those rules.
