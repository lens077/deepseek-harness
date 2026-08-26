# @deepseek-ai/dsh-session-telemetry-otel

English | [中文](README.zh.md)

The OpenTelemetry backend for [the telemetry seam](../session-telemetry/) — the only entry a deployment loads. Its `mode` decides whether the seam follows session events live, replays the canonical log only at recorded feedback, or keeps telemetry local. Uploading modes compose the OTel JS SDK as-is (`LoggerProvider` → `BatchLogRecordProcessor` → OTLP/HTTP log exporter) and map each handed-over record onto `logger.emit()`, under two instrumentation scopes: ledger records on `@deepseek-ai/dsh-session-telemetry-otel`, operational records on `@deepseek-ai/dsh-session-telemetry-otel/ops`. Resource identity always contains `service.name`/`service.version` from `dsh-llm`'s `APP_IDENTITY`; the persistent Harness-home anonymous `user.id` is a separate, default-off opt-in.

## Config

```yaml
- id: session-telemetry-otel
  name: '@deepseek-ai/dsh-session-telemetry-otel'
  config:
    mode: FULL
    captureContent: false
    includeAnonymousUserId: false
    shutdownTimeoutMillis: 3000
    exporter:
      url: https://collector.example.com/v1/logs
      headers:
        authorization: !!js `Bearer ${process.env.OTLP_TOKEN}`
    processor: {}            # optional; passed verbatim to BatchLogRecordProcessor
```

| `mode` | Behavior |
|---|---|
| `FULL` | Each projected record, including lifecycle ops records, is handed to the OTel SDK immediately. |
| `FEEDBACK_ONLY` | Each `feedback/record` replays, projects, and redacts the canonical session-log suffix through that event. Later records wait for another feedback event and remain local if none arrives. |
| `DISABLED` | Default. No coordinator, provider, processor, or exporter is constructed. No telemetry record leaves the process. A `feedback/record` logs `session sessionTelemetry is DISABLED; nothing will be shared and this feedback remains local`; the event remains in the local session log. |

Programmatic TypeScript configuration uses the exported `SessionTelemetryMode` enum (`SessionTelemetryMode.FULL`, `SessionTelemetryMode.FEEDBACK_ONLY`, or `SessionTelemetryMode.DISABLED`); raw string literals are not assignable. Serialized Cordis configuration continues to use the string values shown above.

`captureContent` defaults to `false` independently of upload mode. Set it to `true` only when the collector boundary is approved for raw prompts, tool payloads, and local artifacts. `includeAnonymousUserId` also defaults to `false`; when enabled, it adds `$DSH_HOME/.anonymous-user-id` (a random UUID created on first use and reset by deleting the file) to the OTel Resource once per export batch. Neither opt-in changes the default `DISABLED` mode.

Upload authorization is positive and fail-closed. An unknown direct-construction mode fails before transport configuration is read. Only `FULL` accepts direct `ctx.sessionTelemetry.emit()` calls. `FEEDBACK_ONLY` gives its on-demand coordinator a private backend capability and treats only the exact `feedback/record` object already stored at `session.events[event.seq]` as consent; an independently emitted bus value is ignored. `DISABLED` never constructs the SDK pipeline, even when exporter options are present.

The mounted service discloses the resolved mode through the seam's [`SessionTelemetrySharingStatus`](../session-telemetry/README.md#the-sharing-disclosure) `sharing` property (`full` / `feedback-only` / `disabled`), so the `/feedback` acknowledgement can report whether and how the session is shared. The disclosure is set in the constructor and is independent of capture: even `DISABLED` discloses `disabled`.

`exporter.url` is required in `FULL` and `FEEDBACK_ONLY`, has no default, and must parse as `http(s)`; it is optional and unused in `DISABLED`. In uploading modes, `shutdownTimeoutMillis` is a positive finite DSH-owned outer deadline that defaults to 3000 ms, and a non-positive-integer `processor.maxExportBatchSize` also fails at plugin load because the SDK accepts it but then hangs on shutdown. Both SDK blocks pass through whole: every `OTLPExporterNodeConfigBase` field (`headers`, `timeoutMillis`, `compression`, `keepAlive`, …) reaches the exporter, and batching, export cadence (`scheduledDelayMillis`), retry, queue bounds, and loss policy under sustained failure are SDK behavior tuned through `processor`. The backend implements no `flush()`: the batch processor owns ordinary flushing. During shutdown, OTel awaits `exporter.forceFlush()` before the processor's `exportTimeoutMillis`-bounded completion promise; if that transport promise never settles, this package abandons the wait at `shutdownTimeoutMillis`, logs the contained shutdown failure through the coordinator, and lets application teardown continue. The deadline cannot cancel the SDK transport, so records still pending then may be lost at process exit.

## What leaves the machine

With the default `captureContent: false`, uploading modes apply a closed structural allowlist after the seam's `session-telemetry/record` waterfall. Records retain correlation and lifecycle metadata (`session.id`, lineage, event type/seq, turn/step), durations and token counts, provider/model and tool names, retry delay, result/error classification, and the original body byte count. They remove opaque tool call ids, `session.cwd`, prompt/message text, system prompts and tool schemas, tool arguments and results (including command output and file contents), todo text, compaction summaries, hook output, feedback text, error messages, and unknown attributes. Event types without an explicit metadata projection export only their body byte count, so a newly added event cannot start exporting content by accident. No content hash is emitted.

Retained string metadata must look like an operational identifier (at most 128 characters; letters, digits, `_`, `.`, `:`, `/`, and `-`). This rejects prose-shaped or control-character payloads, but identifiers such as session ids, provider/model routes, and tool names can still reveal deployment topology or tenant naming. Keep telemetry `DISABLED` when even that metadata is sensitive; `metadata-only` means raw content fields are structurally excluded, not that retained identifiers are anonymous.

With `captureContent: true`, the backend exports the waterfall result as structured body and attributes. That can include every content category listed above and any secret copied into a prompt, tool argument/result, file, command output, feedback message, or error message. This mode therefore requires an approved collector boundary or a deployment-mounted waterfall policy (see [the seam README](../session-telemetry/README.md#the-redact-waterfall)). `FULL` runs the waterfall at append time; `FEEDBACK_ONLY` retains no telemetry copy and runs the currently mounted rules when feedback triggers canonical-log replay. Adapter API keys remain structurally absent when they stay in constructor configuration, but the raw mode cannot protect credentials repeated inside event content. `DISABLED` constructs no SDK pipeline and hands no capture to a backend.

## Field mapping

Prepared seam record → SDK log record: `time` → `timestamp`/`observedTimestamp`; `severity` → `severityNumber`/`severityText` (INFO 9 / WARN 13 / ERROR 17); prepared `body` → the structured log body; prepared `attributes` → log attributes. Every record carries `dsh.telemetry.content_mode` (`metadata-only` or `full`); metadata-only records also carry `dsh.telemetry.body_bytes`. Receivers dedupe on `(session.id, event.seq)` and alert on severity. In `FULL`, they may also detect crashes by `shutdown`-record absence: the marker is emitted at the session's own disposal or application teardown, and a marker followed by more events is a telemetry reload. In `FEEDBACK_ONLY`, a released prefix normally has no later `shutdown` marker, so its absence is not a crash signal. Streams are not self-contained across lineage: a resumed session continues its own id's stream from where the previous process left off, and a forked session's stream starts at its inherited boundary — its prefix lives in the parent's stream, stitched via `session.parent_id` + `session.seed_length`. A resumed local log may contain synthetic closers that were never exported; the wire stream stays faithful to records actually handed to the SDK.

## Model Experience

None, as the backend only forwards the seam's redacted records into the OTel SDK pipeline; it never contributes to a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Upstream experimental tree** — `@opentelemetry/sdk-logs` is still published from the upstream experimental tree; SDK API churn lands here and only here — the seam contract does not move.
- **Live-collector behavior belongs to the SDK exporter** — authentication, TLS, throttling, and other real OTLP deployment behavior follow the upstream SDK rather than a package-owned compatibility layer.
- **Feedback-time snapshot** — `FEEDBACK_ONLY` retains no telemetry-owned copy before feedback. It reads and redacts the current canonical log when feedback is recorded; a crash before feedback uploads nothing, and policy changes before feedback affect what that replay exports.
- **Allowlist lag is intentionally opaque** — a new event type remains visible by identity and body size but exposes no event-specific fields until this backend adds and tests an explicit metadata projection.
- **No first-party content sampling** — the backend supports metadata-only export or explicit full-content export. Selective content sampling remains a deployment waterfall concern; it is not inferred heuristically here.
