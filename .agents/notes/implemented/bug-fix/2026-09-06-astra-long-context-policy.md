# Agent Note: Astra long-context configuration

Status: implemented

English | [中文](2026-09-06-astra-long-context-policy.zh.md)

## Problem

A deployment can advertise `gpt-6-astra` with a stale 272,000-token capacity while its operator requests a 1,000,000-token window. The context meter faithfully displays the adapter's configured capacity. Increasing that capacity alone leaves the default proactive compaction threshold at 800,000, not the requested 900,000.

## Decision

Capacity and reasoning remain explicit provider settings. The [provider guide](../../../../docs/user/guide/providers.md#astra-long-context) documents `contextWindow: 1000000`, `reasoningEfforts.max: max`, and the `agent-default-model` selection. DSH does not infer endpoint capabilities from a model name or import Codex configuration. The configured output cap remains distinct from the window and can be reduced to fit remaining context.

The base bundle and the standard, Cordis, and PTC presets configure the exact `openai/gpt-6-astra` route with `thresholdRatio: 0.9`. The existing policy resolver produces 900,000 tokens at a 1M window. Other routes retain the backend's 80% default. Web's host backend is disabled, so changing only the base row cannot tune Web agents.

Model settings reach the next prepared request, including another step in an active turn. Preset configuration belongs to a pinned composition generation: an existing resident agent needs actual recreation or a process restart followed by stored-session reopening to receive the new ratio. Browser refresh and another turn do not replace that generation.

The [routed-context decision](../architecture/2026-07-20-routed-model-context-and-compaction-policy.md) remains authoritative: adapters own capacity; the compaction consumer owns policy. This configuration applies that decision without adding another registry or configuration API.

## Alternatives considered

**Change only the meter denominator.** This leaves adapter overflow detection and proactive compaction using the wrong capacity.

**Hardcode Astra capacity inside the adapter.** A model id does not prove a gateway's limits or access. Deployment-owned model settings retain precedence and preserve unrelated models.

**Add Codex-style fields to the LLM adapter.** The existing ratio expresses the requested threshold at the configured capacity. Compaction policy does not belong in model transport options, and an additional absolute-limit API is unnecessary for this configuration.

**Reload the active preset engine through a temporary host plugin.** A preset generation can serve several active agents. Reloading its compaction service lacks a quiescence guarantee for in-progress compactions; preserving the generation avoids that lifecycle risk.

## Consequences

The meter, prepared model metadata, and compaction capacity share one provider setting. The ratio scales if that setting changes; it is not an independent 900,000-token cap. Proactive checks use measured pressure between steps, and provider-confirmed overflow can trigger earlier recovery. Local 1M configuration and wire-format tests do not prove that an external endpoint accepts a full 1M request.

## Testing

The shipped-base and shipped-preset tests read the actual YAML policy rows. Compaction tests verify the 900K threshold, 160K retained tail, and unchanged neighboring routes. A real Loader composition watches a settings-file change from 272K to 1M and verifies that an OpenAI Responses request carries `reasoning.effort: max` and the configured output ceiling. The keyless [Astra Session scenario](../../../../snapshots/session/astra-context/session.v2.jsonl) runs the shipped headless policy, continues at 899,999 measured tokens, and compacts at 900,000 while retaining recent image history. Its reported usage and image pricing are synthetic; the real meter, compaction engine, and Session persistence remain in the replay path.
