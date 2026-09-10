# Agent Note: Static shell caching and phone digest density

Status: implemented

English | [中文](2026-09-08-static-shell-caching-and-phone-digest-density.zh.md)

## Problem

A phone reaching a public `dsh web` deployment through a tunnel paid the full shell download on every refresh: `dsh-host-frontend-static` served the Vite output with no `Cache-Control`, `ETag`, or `Last-Modified`, so the browser had no freshness lifetime and no validator for the 1.2 MB of `index` and `vendor` chunks, while the plugin combo scripts beside them were already immutable. On the same phone, the digest panel's todo rows doubled in height because every row action inherited the 44px chrome control size, and the small layout's bottom bar hid its labels and left the overview and pending entries drawn with the same checklist glyph.

## Decision

`serveStatic` classifies every 200 response. A file whose basename matches Vite's `-<8-character base64url hash>.<ext>` naming is `public, max-age=31536000, immutable` with no validator: the URL is the content identity, so a refresh never asks about it again. The rendered index is `private, no-cache` and every other unhashed file is `no-cache`; both carry a strong `ETag` (sha1 of the response bytes, base64url) and a matching `If-None-Match` (weak or strong, any list member) answers an empty 304 for GET and HEAD. The index tag is computed after injection rendering and taps, so a Host restart that changes the boot graph invalidates the page while the hashed shell assets stay cached. The real-composition test runs the webserver with gzip enabled at threshold 0 so the validators are proven through the compression middleware the shipped bundle uses.

The digest panel's phone media query gives row actions (`.action`, `.openSession`) their own `--dsh-digest-action-size` (36px, 32px in the small layout) instead of the 44px `--dsh-mobile-control-size` that tabs, chips, and the close button keep; todo rows drop to a 6/8px vertical padding and the layout's row gap between the text line and the wrapped action line. The phone bottom bar's overview entry takes `IconGaugeOutline16`; the pending entry keeps `IconChecklistOutline14`, the glyph the wide sidebar entry uses, and the panel spec asserts the two glyphs differ.

## Alternatives considered

**A service worker with precache or stale-while-revalidate.** It would also cover offline opening, but it adds a second install and update lifecycle, needs a build-time manifest of every asset, and interacts with the authenticated index and the HMR-revisioned plugin graph. Correct HTTP caching already reduces a refresh to one 304 for the index plus one conditional request per unhashed file, which is the incremental update the phone needed.

**Weak stat-based validators (`Last-Modified`, size+mtime ETag).** They avoid reading and hashing the body before a 304, but the rendered index has no file identity and a tunnel-fronted deployment may sit behind a proxy that rewrites weak tags. The unhashed set is four small files; hashing them per request costs less than one extra round trip on a mobile link.

**Hashing the plugin combo revisions at boot so those URLs also survive a restart.** The batch URLs are already content-addressed; only the exceptional per-plugin URL uses a process nonce, and [the loading-model note](../architecture/2026-07-23-client-plugin-loading-model.md) keeps boot hashing deferred on purpose.

**Shrinking `--dsh-mobile-control-size` on the small layout.** It would shorten every phone control, including the tab bar, close button, and chips that stay one-per-row and benefit from the larger target. Only the actions that sit under text the user already read needed the shorter size.

**Showing labels under the small-layout icons.** The small layout exists to give the conversation the height back; distinct glyphs keep that budget.

## Consequences

A returning phone re-downloads only files whose bytes changed; a new build changes the hashed URLs and the index tag, so nothing stale is reused. The index and unhashed files are read and hashed on every request, including the 304 path. Todo and inbox row actions on phones are shorter than the 44px platform target; the tab bar and chips keep it. The frontend-static real-composition test owns the cache headers, the conditional GET/HEAD 304s, the changed-bytes retag, and the gzip interplay; the digest panel spec owns the distinct bottom-bar glyphs.

## Related

The plugin combo route under `/plugins` made the same revalidation choice for its own bytes in [entity tags for plugin bundle revalidation](../bug-fix/2026-08-25-plugin-bundle-revalidation-etag.md); this note covers the Vite shell files the fallback seat serves.
