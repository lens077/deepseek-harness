---
description: "Model selection for the Web GUI: the /model popup, the composer model seat, and the quick-switch strip over one per-session provider-grouped directory; for users and maintainers of model routing."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-model-selection

English | [中文](README.zh.md)

## Summary

The Web GUI lets users switch the model and reasoning effort for an existing session through the `/model` popup, the composer's model control, or the quick-switch strip of recently used models directly above the composer. All surfaces present the same provider-grouped choices, and the selected model determines the available effort names and default. A complete selection applies to the next request; a running step keeps the model and effort it started with. If no adapter can serve the session's route, the composer remains disabled until routing becomes available.

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

Mount this plugin alongside `ui-conversation` and the commands package; the composer then shows the model seat next to the pending indicator, and `/model` opens the same directory as a popup. Both surfaces show the host-reported current selection when the exact provider/model pair remains in the advertised groups; a missing catalog row leaves the routable selection intact while the trigger prompts `Select model`.

### Model and effort

Models stay grouped by provider. The menu shows model and effort names only; catalog descriptions remain available to other consumers. The `/model` popup applies the selected model's default effort; the composer can then choose any advertised effort. An adapter without reasoning metadata leaves the Effort row absent; there is no arbitrary effort input.

### Quick switch

Every selection the Host accepts through any surface is remembered in the user settings document under `ui-model-selection.recentModels`, newest first and at most five routes, with the route it replaced right behind it so the first switch already offers the way back. The strip above the composer shows one pill per remembered route the loaded catalog still advertises, the current route pressed, and each pill submits the model with the effort it was last used with; a remembered effort the model no longer offers falls back to the model's default. The strip renders nothing until a pill offers a switch, hides for addressed subagent sessions, and is turned off in General Settings through `Quick model switch` (`ui-model-selection.quickSwitch`, on by default). The list is a user preference: it is shared by every session and never changes which model a running session uses.

### Unroutable sessions

When the Host reports that no adapter serves the session's route, this plugin raises a composer block and the input goes inert with its own copy; recovering clears it without a reload. A `null` before the first load or after one failed never blocks, and catalog membership never blocks either — a route serving a model it does not advertise is missing from the groups yet usable.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Three entries over ONE per-session directory owned by `ModelDirectoryResolver` (`ctx.modelDirectories`): the `/model` popupSelect contribution (registered through `ctx.commandUi`), the composer's named `conversation.input.model` seat, and the `conversation.input.dock` quick-switch strip all load the session's advisory directory through `session.models` and submit through `session.selectModel` via the same `ModelDirectory` instance, so a switch made in any entry is what the others show next. Directory loads and selections share a generation counter so an older response never overwrites a newer one; a connection reset drops every resident projection and repulls the Host-restored selection. Directories are per-session, resolved lazily, and disposed with the session scope; addressed subagent sessions expose no entry. Every resident directory refetches directly on forwarded `llm/adapters-updated` and `settings/document-updated` owner events. The Host half registers the `ui-model-selection` settings namespace; the browser half binds it through `ctx.settingsScope`, and `QuickSwitchPolicy` publishes the toggle and the recent list before persistence settles, folds each accepted selection with `rememberRecentModel`, and adopts the Host section without writing it back. `quickModelChips` resolves the remembered routes against the directory at render time, so the strip never names a model the catalog stopped advertising.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the model surface is not enough. They move from the browser surfaces to the command popup shell and the selection contract.

- [ui-commands](../ui-commands/README.md) — the popupSelect shell the `/model` contribution registers into.
- [ui-conversation](../ui-conversation/README.md) — declares the composer's `conversation.input.model` seat, the `conversation.input.dock` strip, and the composer block.
- [ui-settings](../ui-settings/README.md) — the `settingsScope` binder the quick-switch preference persists through and the General section the toggle row registers into.
- [dsh-agent-default-model](../../core/agent-default-model/README.md) — the default-model service for sessions that never choose.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `session.selectModel` selection every entry submits: the Host snapshots the complete `ModelSelection` at the next prompt-assembly boundary and owns the model-visible effect, while a running step keeps its assembled selection. The recent-model list is a browser preference and reaches no model request.

#### KV Cache effect

Switching the route can reduce or invalidate provider-side cache reuse for subsequent requests; the prompt prefix itself is untouched.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current model surface. They are current package constraints, not a general model-router comparison or a task backlog.

- **No create-time or addressed-subagent selection** — every entry requires an existing ordinary session's Agent; there is no draft-phase model choice to fold into session creation, and subagent continuation deliberately exposes no independent model-selection contract.
- **Directory names are presentation-only** — selection and persistence use provider/model/effort ids; a provider whose catalog or exact-model metadata lookup fails lists as an unselectable failure row until reload.
- **No arbitrary effort input** — the composer offers only the exact model's adapter-advertised levels; an adapter without reasoning metadata leaves the Effort row absent.
- **Recent, not pinned** — the strip is fed only by selections made in this GUI, in recency order; there is no way to pin a route, reorder the pills, or record a selection made from another client.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. A command contribution, two slot registrations, and one settings namespace whose disposal is proven by the HMR-safety specs — it emits no cordis events and owns no cross-plugin mutable state.
