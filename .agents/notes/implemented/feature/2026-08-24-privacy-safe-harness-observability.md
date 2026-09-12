# Agent Note: Privacy-safe local Harness observability

Status: implemented

English | [中文](2026-08-24-privacy-safe-harness-observability.zh.md)

## Problem

The canonical session log already records session lineage, turn/step boundaries, model chunks and assembled messages, tool calls/results, usage, retries, errors, cancellation, and crash repair. At scale, however, operators had to reconstruct several basic questions manually: complete turn and step latency, provider retry count and waiting time, unmatched/error tool outcomes, and the distribution of turn endings. The Web strip exposed model/tool time and TTFT but not those reliability signals.

The shipped telemetry service was disabled by default, but enabling the reference OTel backend handed raw waterfall output to the SDK. Prompts, system/tool schemas, tool payloads, file and command output, feedback, error text, and `cwd` could therefore cross the exporter boundary unless each deployment wrote a rule set. The persistent anonymous `user.id` was also unconditional in upload modes. That made the safe default depend on deployment expertise rather than on the shipped backend boundary.

## Decision

1. Expand the `sessionStats` projection with complete `turnMs`/`stepMs`, tool call/result/error counts, model retry count and scheduled delay, and one counter for each core `turn/end` reason. These are scalar, content-free folds over the append-only log. The Web stats strip shows total turn time and nonzero retry/failure/interruption signals; pagination and compaction cannot change them.
2. Make the reference OTel backend metadata-only by default, independently of delivery mode. A closed structural allowlist keeps identifier-shaped correlation, lineage, lifecycle coordinates, timing, token usage, provider/model/tool identity, retry delay, and outcome/error classification. It removes opaque tool call ids, `cwd`, and all content-bearing payloads. Unknown event bodies retain only their serialized byte count, and no content hash is exported. Retained identifiers are syntax-bounded but deliberately not presented as anonymous; deployments with sensitive topology or tenant naming keep telemetry disabled.
3. Require two independent explicit opt-ins: `captureContent: true` for raw bodies and `includeAnonymousUserId: true` for the persistent Harness-home Resource identity. The base bundle enables either only when its environment value is exactly `true`; `mode` remains `DISABLED` by default.
4. Keep durable session events provider-neutral. Hierarchical session/turn/step/model-attempt/tool Span translation, unstable OTel GenAI semantic-convention names, monetary cost calculation, and exporter queue/drop health remain separate increments. Local diagnosis must work without a collector or cloud credentials.

The shared `session-telemetry/record` waterfall remains a pass-through mechanism. The privacy floor belongs to the shipped exporter boundary, after deployment rules, so custom backends retain the seam contract and stricter deployment rules still win. This does not revive heuristic secret matching: the policy is a named mode, uses positive structural selection, and fails closed for event types it does not know.

## Alternatives considered

**Add pattern-based secret scrubbing to the shared waterfall.** Rejected. Pattern coverage creates false confidence, misses arbitrary content, and can corrupt values through false positives. A structural metadata allowlist has a reviewable set of fields and makes new event types safe without guessing.

**Export raw records but keep telemetry disabled by default.** Rejected. Disabled-by-default protects only deployments that never enable observability; it does not provide a safe path for the deployments that need it.

**Implement hierarchical OTel spans in the same increment.** Deferred. Correct attempt spans need retry-aware parentage, interruption repair rules, and a deliberate semantic-convention version boundary. The local projection and privacy floor are stable without that mapping and solve the immediate diagnosis and data-boundary failures.

**Estimate monetary cost from token usage alone.** Deferred. A trustworthy value needs provider/model price tables, cache-read/write treatment, currency, effective date/version, and a policy for missing prices. A false-precision cost number is worse than the existing exact token buckets.

## Consequences

A fresh or resumed local session now exposes complete lifecycle and reliability aggregates through the existing projection carriers and Web strip with no new service, account, or credential. OTel upload still uses the SDK's best-effort queue and transport semantics; metadata-only mode limits content exposure but does not make delivery durable. Operators can distinguish work count, complete lifecycle time, model-completion time, retry delay, tool failures, and turn termination without reading prompts or tool output.

Raw-content export and stable cross-process user correlation are visibly exceptional configuration choices. Event-specific metadata for a future event type remains unavailable until the OTel backend adds an allowlist case and tests it; event identity and body size remain visible in the meantime. Cost attribution, hierarchical traces, and queue/drop instrumentation are recorded as deferred rather than implied by the new counters.

## Verification

The implementation is pinned by controlled-timestamp projection tests for lifecycle time, retry delay, tool outcomes, every turn ending, negative clock skew, malformed/duplicate lifecycle records, provider-minted prototype property names, and crash-style orphan results; client tests for the whole-session Web display and fixture parity; pure privacy tests containing fixture secrets, prose-shaped identifiers, opaque call ids, and unknown event types; real OTel SDK/HTTP collector tests for default absence and explicit content/identity opt-in; and a base-bundle parse test for exact-`true` environment gates. Repository typecheck, lint, constraints, doc-sync, targeted tests, and the Web artifact build remain the release gates.
