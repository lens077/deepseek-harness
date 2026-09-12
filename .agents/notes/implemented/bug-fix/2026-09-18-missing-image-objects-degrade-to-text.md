# Agent Note: Missing image objects degrade to request text

Status: implemented

English | [中文](2026-09-18-missing-image-objects-degrade-to-text.zh.md)

## Problem

Session logs reference uploaded images by content address; the bytes live below `DSH_HOME/attachments/v1`. A user who reinstalls the operating system or deletes `.dsh` keeps the session log but loses the objects. Every later turn of such a session called `readImageRequest` inside the provider adapter, which threw `AttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND')` and became a terminal failure chunk. The session could never run again, even for a request whose new turn contained no image.

## Decision

Request assembly in `LlmRuntime.adapterStream` treats an absent object as one more deterministic image projection beside the text-only-model and file projections. Before dispatch to an image-capable route, it collects every distinct `ImageBlock` reference (nested tool results included), asks the mounted `AttachmentStore.imageAvailable(ref, signal)` for each, and replaces occurrences of absent references with `missingImageText(ref)`, which names the attachment and asks the user to attach it again. Durable session messages are never rewritten; present images still reach the adapter unchanged.

`imageAvailable` is a non-abstract `AttachmentStore` method. The default reads and verifies the object and maps only `ATTACHMENT_NOT_FOUND` to `false`; corruption and storage failures still propagate, so this path never hides a damaged store. `LocalAttachmentStore` overrides it with `imageFileExists`, one `access()` per distinct image, so the probe costs no reads on ordinary requests.

This realizes the absent-object part of the proposed [attachment read quarantine](../../proposed/bug-fix/2026-08-20-attachment-read-quarantine.md) without its durable `attachment/quarantine` event, corrupt and read-failure classes, or verified recovery; that proposal remains open for those parts. The [reconstructable requests](../architecture/2026-07-05-reconstructable-requests.md) limitation list records the narrowed fail-loud scope.

## Alternatives considered

**Catch `ATTACHMENT_NOT_FOUND` inside each adapter.** Both `llm-deepseek` and `llm-pi-ai` would duplicate the substitution and its placeholder text, and future adapters would have to remember it. The runtime already owns route-independent image projection.

**A configuration switch between failing and degrading.** No consumer wants a session that can never run again; the placeholder is model-visible and names the recovery action, so nothing is silently skipped. Failing stays available through the unchanged `readImage` path used by the Web image preview and export.

**Treat corrupt objects the same way.** A digest mismatch signals a storage fault rather than a deleted home and must remain loud.

## Consequences

Sessions whose attachment objects were deleted continue; the model sees `[image unavailable: its stored copy is missing from this harness installation; "name" (sha256:…). Ask the user to attach it again if its content is needed.]` in place of each lost image. Every request over image history pays one existence probe per distinct image on the local backend. The generated Cordis API catalog and `docs/subsystems/attachment.md` list the new method.

## Verification

`packages/llm/llm/tests/service.spec.ts` drives a runtime with a stubbed attachment service and asserts distinct-reference probing, direct and nested substitution, untouched durable messages, and unchanged dispatch when every object is present or no attachment service is mounted. `packages/llm/llm/tests/content.spec.ts` pins the placeholder text and identity-preserving projection. `packages/attachment/attachment/tests/index.spec.ts` covers the default probe's three outcomes; `packages/attachment/attachment-local/tests/store.spec.ts` covers present, absent, blocked-path, invalid-reference, and cancelled probes.
