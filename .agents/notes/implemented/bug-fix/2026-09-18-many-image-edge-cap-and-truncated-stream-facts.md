# Agent Note: Cap request-image edges and name the response behind a truncated stream

Status: implemented

English | [中文](2026-09-18-many-image-edge-cap-and-truncated-stream-facts.zh.md)

## Problem

Anthropic accepts an image up to 8000 pixels per edge, but once one request carries more than 20 images every image must fit 2000×2000 pixels ([vision limits](https://platform.claude.com/docs/en/build-with-claude/vision)). The pi-ai route sized each inline request image under a 2048×2048 total-pixel budget only, so a 2374×1698 screenshot (4.03 MP) was sent untouched. Images accumulate in a session and are re-sent with every request, so the first request after the 21st image was refused with `At least one of the image dimensions exceed max allowed size for many-image requests: 2000 pixels`, and every later request on that route was refused the same way: compaction shadows text, not images, and a model switch to a provider without the rule was the only recovery.

The refusal was invisible. The user's gateway answers an upstream 4xx with HTTP 200 and an empty or bare-JSON body; pi-ai reads the body through the SDK, finds neither a protocol event nor an `event: error` line, discards the response, and reports `Anthropic stream ended without a stop reason`. `dsh-llm-pi-ai` classified that text as `TRANSPORT`, so the retry layer resent the identical request five times per turn, and session logs across ten days record 194 such failures with no status, media type, or body to explain them.

A second classification gap compounded it on the OpenAI route: a mid-stream `error` event reaches pi-ai as a status-less SDK error carrying only the provider's sentence (`Our servers are currently overloaded. Please try again later.`), which matched no pattern and became the non-retryable `PI_AI_ERROR`; 64 turns ended on the first such event without a retry.

## Decision

[`requestImageDimensions`](../../../../packages/attachment/attachment/src/request-projection.ts) takes an optional per-edge cap beside the total-pixel budget and returns dimensions satisfying both; the cap is applied as an exact integer because scaling the long edge by `cap / edge` can land one pixel short. [`ImageRequestPolicy`](../../../../packages/attachment/attachment/src/types.ts) carries it as `maxDimension`; [`readRequestImageFile`](../../../../packages/attachment/attachment-local/src/request-image.ts) validates it, includes it in the variant identity only when present so existing cached versions keep their ids, and projects under it. The pi-ai profile exposes it as `requestImageMaxDimension`, default 2000, so the default route satisfies Anthropic's many-image rule and a deployment may lower it to Anthropic's 1568-pixel recommended edge or raise it for a provider without the rule. Normalization keeps its own long-edge cap (8192) because it bounds the stored attachment, not a route.

[`createResponseProbe`](../../../../packages/llm/llm-pi-ai/src/response-probe.ts) wraps the `fetch` handed to pi-ai for one request, records the response status, `content-type`, byte count, and the first `responseProbeHeadBytes` (default 512) body bytes through a pass-through `TransformStream`, and resolves the global `fetch` at call time so the process-wide proxy dispatcher still applies. `annotateTruncatedFinish` rewrites a finish whose failure text is pi-ai's truncation wording (`stream ended before|without …`) to name those facts and set `failure.status`. When the body head is a bare JSON object, it is the provider's own error and `classifyPiAiError` re-routes the failure from its words, so a gateway-wrapped `"status":400` becomes `INVALID_REQUEST` and is not retried; an SSE head keeps the transport code because protocol events also contain numbers.

`classifyPiAiError` routes `overloaded`, `overloaded_error`, `api_error`, and `internal server error` to `SERVER`, which the default retry policy retries, and `authentication_error` or `permission_error` to `AUTH`. An HTTP status in the text still wins: `OpenAI API error (400): {"message":"Internal server error"}` stays `INVALID_REQUEST` because the gateway declared the request invalid.

## Alternatives considered

**Lower the pixel budget until no edge can exceed 2000.** Rejected: a budget bounds area, not edges; 8000×400 fits 2048² and still fails, and shrinking the budget far enough would degrade ordinary screenshots for every provider.

**Drop the oldest images from the request once it carries more than 20.** Rejected: the route already offloads images by byte budget, and the model loses those images either way; scaling keeps every image visible and costs nothing on Anthropic, which downsamples above 1568 pixels regardless.

**Fix pi-ai to report the response.** Deferred: pi-ai flattens the caught error to its message before the adapter sees it, and the SDK-owned response is not reachable from the event stream; the `fetch` option is the one seam pi-ai offers, and the probe keeps the adapter independent of pi-ai's internal wording beyond the truncation regex already relied on for classification.

**Treat every truncated stream as `INVALID_REQUEST`.** Rejected: a genuine mid-response socket drop is transient and must retry; only a bare error body proves the provider refused the request.

## Consequences

An image-heavy session on the pi-ai Anthropic route keeps completing requests past 20 images. A truncated-stream failure names the response (`… (upstream response: HTTP 200 text/event-stream, empty body)`), carries `status`, and, when the gateway included the upstream error, is classified from it and not retried. Status-less overload events retry under the provider policy. Each pi-ai request holds at most `responseProbeHeadBytes` of body in memory beyond what the SDK reads. The [projection](../../../../packages/attachment/attachment/tests/request-projection.spec.ts), [request-image](../../../../packages/attachment/attachment-local/tests/request-image.spec.ts), [probe](../../../../packages/llm/llm-pi-ai/tests/response-probe.spec.ts), [adapter](../../../../packages/llm/llm-pi-ai/tests/adapter.spec.ts), and [classification](../../../../packages/llm/llm-pi-ai/tests/convert.spec.ts) specs pin the edge cap, the unchanged variant id without a cap, the empty-body and bare-JSON annotations through a local HTTP server, and the new failure codes.
