# Agent Note: Model Row Capability Fields

Status: implemented

English | [中文](2026-09-02-model-row-capability-fields.zh.md)

## Problem

The Models page adds a pi-ai model with `id`, `name`, `contextWindow`, and `maxTokens`. The adapter resolves everything else from the installed catalog, and a model the catalog does not describe — a release newer than the installed pi-ai, or a company gateway's model — resolves as text-only and non-reasoning. The result reaches the user as two unrelated symptoms: pasting an image into the composer falls back to an `@` file reference because the composer reads `inputModalities`, and the model picker offers no thinking levels because the adapter reports no `reasoning`. Both fixes were one line in `settings.yaml` (`input: [text, image]`, `reasoningEfforts: { high: high }`), and the user guide said so, but the form that created the entry gave no sign that the line was needed. The `dsh-llm-pi-ai` README also stated that input modalities were not configurable, which the adapter had stopped being true for.

Separately, every settings section a plugin contributes drew the General gear, so the installed vision bundle's page and ui-session-files' Conversation layout page were told apart by label alone.

## Decision

The model row's disclosure, relabelled **Advanced**, carries two controls beside the capacities. **Image input** is a select over the catalog default (field absent), text and images (`['text', 'image']`), and text only (`['text']`); a stored list the select cannot express — image alone, a duplicate, an unknown modality — is displayed as *as written in settings.yaml* through a disabled option and is never rewritten until the user picks a real choice. **Reasoning** is a select over the catalog default (absent), non-reasoning (`false`), and selectable levels, which reveals one checkbox per pi-ai level in pi-ai's order. Checking a level writes its canonical spelling (`high: high`; `off` valueless, the adapter's "supported, send nothing"), unchecking removes the key, and a spelling already present is kept, so a `max: ultra` written by hand survives the row being edited. Switching to selectable levels opens on `low`, `medium`, `high`.

Validation lives in `model-capabilities.ts` and joins the shared row checker, so a bad field is named by row and blocks Apply like a bad capacity: a modality outside `text`/`image`, a reasoning value that is neither `false` nor a dict, an unknown level, a level other than `off` without a spelling, and a dict offering no level besides `off` — the same refusals `resolveModelReasoning` makes at load. `compat` and renamed spellings stay in `settings.yaml`; the row hint says so.

The settings shell maps two more registration ids to glyphs: `vision-toolkit` to a new `IconEyeOutline16` and `conversation-layout` to `IconPanelLeftOutline16`. The mapping stays id-keyed in the shell rather than becoming a registration option, because the slot registration carries only serializable data and the id table already existed for the shipped sections.

## Alternatives considered

**A single "vision" checkbox** — rejected because `input` has three meanings, not two: absent inherits the catalog, and text-only is how a catalog model whose gateway drops images is narrowed. A checkbox could not express "inherit".

**A single "reasoning" checkbox writing every level** — rejected because a hand-entered model rarely serves all seven, `xhigh` and `max` are model-specific, and a level the endpoint refuses fails the request with `UNSUPPORTED_REASONING_EFFORT`. Per-level checkboxes make the offered set explicit.

**Editing wire spellings and `compat` on the row** — deferred. Both are gateway vocabulary that the user guide already documents under `settings.yaml`; a text field per level would crowd the row for the rare rename.

**An `icon` option on `settings.section` registrations** — rejected for now: it would widen the slot registration API for two rows, and the shell's id table is the established place.

## Verification

`provider-form.client.spec.tsx` drives the selects and checkboxes through the real card: writes `input` and `reasoningEfforts` as the adapter field values, returns both to absence, shows a hand-written list as such, and blocks Apply on a dict offering only `off`. `model-capabilities.client.spec.ts` pins classification, level toggling, and every refusal. `settings-root.client.spec.tsx` asserts the two new ids draw their own glyph and unknown ids still draw the gear. The screenshots in [Configure models](../../../../docs/user/guide/providers.md#image-input) were taken from the built Web UI.

## Consequences

A vision or thinking model on a custom provider is configured where it is created. The settings document is unchanged in meaning: the form writes exactly the fields `dsh-llm-pi-ai` documents, and a `settings.yaml` edited by hand reads back into the same controls. The row checker duplicates the adapter's reasoning refusals on the client, which is the same source-plane split that already mirrors `normalizeApiKey` there.
