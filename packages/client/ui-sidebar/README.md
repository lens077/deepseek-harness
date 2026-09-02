# @deepseek-ai/dsh-client-ui-sidebar

English | [中文](README.zh.md)

Sidebar shell plugin: the brand row, New Session action, layout-owned collapse control, `sidebar.nav.entry` list, scroll-aware region seat, and bottom-pinned Settings and footer-action seats. Whole-surface navigation entries render between New Session and the Workspace browser and receive the same `wide` flag as the rest of the rail-aware controls. [ui-workspace](../ui-workspace/README.md) owns the Workspace and Session browser rendered into `sidebar.workspaces`; this package neither derives its rows nor owns its view preferences. Collapse into the layout-owned 56px rail remains presentation-local. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

The expanded brand row renders `sidebar.brand.mark` and `sidebar.brand.name` as independent single slots, while the collapsed rail renders the same mark slot. Without occupants, the shell uses the fish mark and a `Sumery DSH Pro` label carrying the build's 7-character `DSH_CLIENT_COMMIT_HASH` badge. A deployment package can replace either value without replacing the New Session control or rail geometry; declaration-aware `slots.inject()` lets such a package activate before or after the sidebar. The shell renders both at a 20px row height (occupant artwork scales to that height through CSS) and places its own `brand.tagline` copy — the fork tagline — in smaller secondary text beneath the row.

New Session starts the runtime's page-local frontend Session Intent. The runtime targets the explicit Workspace used by a scoped action, otherwise the current Session's Workspace, otherwise the most recently active Workspace; when none exists it clears into the blank New Session page. Workspace-specific controls and the shared picker belong to ui-workspace.

`SidebarRootComponentProps` composes the layout owner share, the global `useSessions` and `useWorkspaces` hooks, the declared brand, `sidebar.nav.entry`, `sidebar.workspaces`, `sidebar.settings`, and `sidebar.footer.action` child slots, and injected `startSession` plus sidebar-toggle callbacks. There is no plugin store.

During a live collapse, the shell holds the expanded content at its current width while it fades out for 150ms. The upper controls—the shell toggle, New Session, `sidebar.nav.entry` occupants, and add/search rendered through `sidebar.workspaces`—then share one 150ms fade and 49px leftward translation into the 56px rail, ending with the layout's 300ms column slide; every 36px control box follows the same path to the rail's 10px left inset. The bottom-pinned `sidebar.settings` control shares the fade timing but has no horizontal translation. A page that starts collapsed renders the rail statically, and reduced-motion mode disables both transitions.

Scrollbars in the column are a pointer affordance: the shell rebinds ui-theme's [scrollbar indirection](../ui-theme/README.md) to `transparent` whenever the pointer is outside it, and keeps the thumb drawn for 2s after the pointer leaves, so a list nobody is pointing at carries no bar. The reservation that keeps rows from moving belongs to the scrolling region ([ui-workspace](../ui-workspace/README.md)), so revealing a thumb never reflows.

The foot contains `sidebar.footer.action` entries above the `sidebar.settings` seat. The sidebar shares only its column state (`wide`); ui-settings registers the settings trigger and panel, while optional actions keep their own behavior.

The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; SidebarRoot, the row components, and the tree derivation remain package-internal behind the slot registration.

## Model Experience

None, as the sidebar renders the browser session list; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Session state-dot rendering is owned by [ui-workspace](../ui-workspace/README.md)** — no done/error notification sources are available.
- **Workspace browser behavior is composition-owned** — grouping, ordering, search, and row state belong to [ui-workspace](../ui-workspace/README.md), not this shell.
- **"New task completed" unread marking is local viewing state** — completion-time > last-seen never reaches the host.
