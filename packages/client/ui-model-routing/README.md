---
description: "Model-routing switch for the Web GUI: the composer chip beside the model seat and the row under the Models settings page that turn automatic model assignment on or off; for users and maintainers of prompt-driven routing."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-model-routing

English | [中文](README.zh.md)

## Summary

This package renders the model-routing switch twice in the Web GUI: a chip in the composer tool row beside the model seat, and a row under the provider list on the Models settings page. Both show the same fact — whether the mounted router may pick another configured model or reasoning effort for each prompt — and one click writes the `model-routing.enabled` setting immediately. Turn it off to always answer with the model selected in the session; a session left on a routed model returns to it at its next prompt. While no router is mounted, nothing renders.

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

Mount this plugin alongside `ui-conversation` and `ui-settings-models`, and mount a `dsh-model-router` provider on the Host; the chip and the row then appear as soon as the Host serves the `model-routing` settings namespace.

### What the chip shows

The chip sits in the composer tool row before the model seat and reads **Auto model** while routing is on and **Fixed model** while it is off; its tooltip explains the current state. Clicking it flips the setting for the whole deployment and disables the chip until the Host answers. The Models-page row shows the same switch with its full description and the hint for the current state.

### Failures

A write the Host did not accept — a read-only document, a transport fault, or a write the Host acknowledged without republishing — reports itself on the Models-page row while both surfaces keep showing the stored value. Neither surface stages a draft; there is nothing to save or discard.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One `ModelRoutingController` binds the `model-routing` scope through `ctx.settingsScope` and publishes a snapshot store both registrations inject as `useModelRouting`; the row registers into the Models page's `settings.models.footer` seat and the chip into the composer's `conversation.input.right` seat at order −10. `available` is the scope's `ready` status: a router serves the namespace or nothing renders. `enabled` reads an absent value as on, matching the Host schema default. `toggle` performs one `scope.set('enabled', next)`, ignores further toggles while it is in flight, and marks `failed` when the write throws or the republished value differs from what was written. The node half is an empty apply (the roster row).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the switch is not enough. They move from the surface to the routing seam and the settings it edits.

- [dsh-model-router](../../llm/model-router/README.md) — the routing seam, the `model-routing` setting it serves, and what happens while the switch is off.
- [dsh-model-router-llm](../../llm/model-router-llm/README.md) — the provider that asks the session's own model which configured choice should answer.
- [ui-settings-models](../ui-settings-models/README.md) — declares the `settings.models.footer` seat the row fills.
- [ui-conversation](../ui-conversation/README.md) — declares the composer's `conversation.input.right` seat the chip fills.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `model-routing.enabled` setting the switch writes: the Session controller reads it before each prompt, and the router and request assembly own every model-visible effect.

#### KV Cache effect

Turning routing off returns a routed Session to its baseline route at its next prompt, which changes the request route once; the switch itself adds no prompt content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current switch. They are current package constraints, not a task backlog.

- **One deployment-wide switch** — the chip toggles `model-routing.enabled` for every Session; a per-Session Auto/pinned state is deferred with the routing seam.
- **No verdict preview** — the chip shows whether routing is on, not which model the router will pick for the draft; the applied route appears in the model seat once the request lands.
- **The chip belongs to the default composer** — a pending whole-composer interaction temporarily replaces the tool row and its chip.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The setting's semantics are owned by dsh-model-router, while both surfaces are slot effects whose declaration, registration, and teardown are exercised by this package.
