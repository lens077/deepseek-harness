# Agent Note: entity tags for plugin bundle revalidation

Status: implemented

English | [中文](2026-08-25-plugin-bundle-revalidation-etag.zh.md)

## Problem

The plugin bundle route served every `dsh.client` bundle and source map under `/plugins` with `cache-control: no-cache` and no validator. `no-cache` requires revalidation before reuse, and with neither an entity tag nor a last-modified date every revalidation is a full re-download, which makes the header equivalent to `no-store` in effect.

A web GUI first load is about 3.1 MB of plugin JavaScript across roughly thirty bundles, and every page refresh re-transferred all of it. Over loopback that cost is invisible; over a tunnelled reverse proxy measured at about 2.8 Mbit/s to the browser it was roughly two seconds of every refresh.

The rev already in each URL is a content hash of the built bundle (`shortHash`, also the graph rev), but it cannot carry long-lived caching: `serveBundle` resolves only the pathname and ignores the query, so a stale `?rev=` still returns the current bytes — and HMR depends on exactly that, because the loader's cached graph rev goes stale after a rebuild while the prefetch still has to reach the host.

## Decision

Bundle and source-map responses stay `no-cache` and additionally carry an entity tag hashed over the bytes being served (`packages/client/modules/src/index.ts:561`). A request whose `if-none-match` matches that tag receives a bodyless 304 carrying the same `cache-control` and `etag` (`:562-565`); every other request receives the full 200 with the tag alongside the existing headers. A rebuild changes the bytes, so the tag changes and the next revalidation transfers the new bundle.

The validator is computed per request from the buffer the handler already read, so the route gains no cache, no invalidation state, and no dependency on the registry's rev bookkeeping.

## Consequences

- A repeat load transfers 304 headers instead of about 3.1 MB; a first load is unchanged.
- HMR semantics are unchanged: every load still revalidates, a stale `?rev=` still reaches the host, and a rebuilt bundle still answers 200.
- Behind a reverse proxy that compresses responses, the tag rides the origin response and the proxy negotiates the encoding, so the browser stores one encoded variant against that tag and its revalidation still settles as a 304.
- Each revalidation costs one sha1 over the bundle on the host, in exchange for the transfer it replaces.
- `packages/client/modules/tests/node-half.client.spec.ts` pins all three arms: a 200 carries the exact tag, a matching `if-none-match` yields a bodyless 304, and a rebuild changes the tag and re-sends the body.

## Alternatives considered

- **`immutable` with a long `max-age`, keyed on the content-hash rev already in the URL** — rejected: `serveBundle` ignores the query and serves the current file for any rev, which is precisely what lets HMR recover from a stale graph rev. A browser honoring `immutable` would keep replaying the pre-rebuild bundle from cache and break hot replacement.
- **`last-modified` with `if-modified-since`** — rejected: a modification time is coarser than the bytes and unreliable across a rebuild that restores identical content or a checkout that rewrites timestamps, while the bundle hash is already this repository's identity for a client artifact.
- **Reusing the precomputed graph rev as the tag instead of hashing per request** — rejected: that rev is refreshed by the HMR watch hook and can lag the file on disk, and a source map carries no rev at all; hashing the bytes just read is exact for both responses.

## Related

The same investigation measured and then declined a larger payload reduction; see [filter superseded assistant chunks out of session.history pages](../../rejected/architecture/2026-08-25-history-page-chunk-filtering.md).
