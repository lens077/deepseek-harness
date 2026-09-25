---
description: "Rest companion controls, responsive placement, local state, and bundled artwork for deployments choosing an optional browser companion."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-companion

English | [中文](README.zh.md)

## Summary

Keep a small blue whale companion docked beside navigation, or move it to a position you choose. Click the character to greet it, let it sleep, and wake it; pause motion or minimize it when it distracts. Phones and the collapsed navigation rail show a still, clickable character. This optional decoration makes no model calls and forgets its state on page reload.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Choose this companion for optional, user-controlled decoration, not task progress or break reminders.

### Activation

The [web-app composition](../../bundle/web-app/cordis.patch.yml) includes the `ui-companion` Cordis row with `disabled: true`. Activation is a deployment opt-in through that row's `disabled` metadata, not a package configuration field. The package has no configuration fields; its browser contribution requires the locale service and the sidebar slot declaration.

### Interaction and placement

Each character click advances `idle → greeting → sleeping → idle`; moods do not advance on a timer. In expanded presentation, **Pause animation** and **Enable animation** control motion without changing the mood. **Minimize companion** replaces the expanded area with a compact button; clicking that button restores the area.

On phones and the collapsed navigation rail, the compact character cycles moods instead of expanding. Compact layouts, hidden pages, and dragging pause motion; the operating system's reduced-motion preference disables animation. Mood, minimization, manual motion preference, and position survive responsive remounts within the plugin instance. Page reload resets the companion to idle, expanded, unpaused, and docked.

Windows at most 600px high use a still, short row that retains the motion and minimize controls. The companion starts docked in reserved `sidebar.footer.action` space above desktop Settings. The sidebar renders that same slot in the phone header with `wide: false`. Docked placement does not cover the conversation or composer.

### Move and dock

Drag the character with the primary mouse button, pen, or touch. Movement of at least 6 CSS pixels detaches it to a viewport-relative floating position; releasing a drag does not activate the character. An ordinary click keeps its mood-cycle or restore action. While the character has focus, arrow keys move it by 16 CSS pixels, and **Home** returns it to navigation; these shortcuts do not handle Alt, Ctrl, or Meta combinations.

The floating position is clamped after movement and viewport or companion resizing. **Dock** remains available while floating, including compact presentation, and restores the navigation position. A user-chosen position can cover conversation content or the composer; move it again or dock it to clear the obstruction.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [browser entry](src/client/index.ts) owns one [interaction store](src/client/store.ts), localized copy, and a page-visibility observation. Declaration-aware slot registration lets the sidebar own geometry while the [component](src/client/Companion.tsx) renders the controls. Plugin disposal removes its contribution, dictionaries, and visibility listener.

The [bundle configuration](tsdown.config.ts) embeds [awake.webp](src/client/assets/awake.webp) and [sleeping.webp](src/client/assets/sleeping.webp) as data URLs. Rendering makes no external image requests.

No invariant companion is published: one local presentation store owns the interaction state, with no independently observed relationship to reconcile.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

The surrounding owners explain placement, activation, and the decision.

- [Sidebar](../ui-sidebar/README.md) — reserved desktop and phone navigation slots.
- [Web-app bundle](../../bundle/web-app/README.md) — deployment composition.
- [Rest companion Agent Note](../../../.agents/notes/implemented/feature/2026-09-26-rest-companion.md) — rationale and alternatives.
- [Draggable companion Agent Note](../../../.agents/notes/implemented/feature/2026-09-26-draggable-rest-companion.md) — user-controlled placement and docking.

-----

<a id="model-experience"></a>
## Model Experience

None, as the companion changes only browser presentation and contributes no model input, calls, or session events.

#### KV Cache effect

None; the companion changes neither model-input tokens nor provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The companion remains local decoration.

- There is no sound, timer, notification, session-status integration, or durable preference storage.
- The bundled artwork is locally processed from a user-supplied blue chibi maid whale reference. This provenance does not establish an upstream character license; redistribution requires separate rights verification.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
