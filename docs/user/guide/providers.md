# Configure models

English | [中文](providers.zh.md)

This guide assumes you started the Web UI through the [root README](../../../README.md#run). Model changes take effect on the next request without restarting the server.

## Configure DeepSeek

Open **Settings → Models**. The DeepSeek card exposes one API-key field; enter the key and save it.

![The Models page: the DeepSeek card, with Add provider and Add a custom provider below it](providers-models-page.png)

Keys are write-only. The page receives a redacted descriptor after saving, never the literal secret. The key is stored in `$DSH_HOME/.credentials.yaml`, while settings retain only its credential reference.

## Add a built-in provider

Choose **Add provider** and pick a provider dsh ships with; the list shows provider ids such as `anthropic`, `openai`, `moonshotai` for Kimi, or `zai` for GLM. Enter its API key and save. The installed catalog supplies the endpoint, protocol, and model list.

Providers that sign in with OAuth, such as Codex, are not supported here yet.

## Add a custom provider

Choose **Add a custom provider** for a company gateway, self-hosted server, or provider absent from the installed catalog. Supply a lowercase Provider ID, base URL, API protocol, credential, and at least one model. The **API protocol** must be the one your gateway speaks, and the form offers three: `openai-completions` for OpenAI Chat Completions, `openai-responses` for the OpenAI Responses API, and `anthropic-messages` for the Anthropic Messages API. A provider speaks one protocol, so a gateway that serves two needs two providers.

![The custom provider form: Provider ID, display name, base URL, API protocol, and API key](providers-custom-form.png)

The Provider ID is permanent because requests, saved sessions, model defaults, and credential references use it. To rename a provider, add a new provider and delete the old one. The display name, base URL, protocol, credential, and models remain editable.

### Discover models

Under **Model catalog**, choose **Fetch available models** to ask the endpoint which models it serves. The request uses the base URL, protocol, and key currently in the form, or a saved provider's stored key, and the reply opens a searchable picker: search, tick the models you want, and choose **Add selected**. Nothing is stored until you save or create the provider.

Discovery reads the listing formats common gateways publish, but not every endpoint answers in one of them, so treat it as a convenience rather than a guarantee: when it fails or lists nothing, add the model ids by hand and they work just the same. A built-in provider is always answered from the installed catalog, even when its base URL points at a gateway, so fetch through a custom provider to see what the gateway really serves.

## Select a model

Configured providers appear in the model picker. Selecting a model also makes it the default for new sessions. A session that has already sent a request retains the model recorded in its own log.

If a saved default names a provider that was deleted, the composer displays **Select model** and blocks input until another model is selected.

## Advanced configuration

The generated [plugin configuration catalog](../../config-catalog.md) lists every supported field and default for every plugin; [`dsh-llm-pi-ai`](../../config-catalog.md#deepseek-aidsh-llm-pi-ai) is the provider section this page configures. The [`dsh-llm-pi-ai`](../../../packages/llm/llm-pi-ai/README.md) and [`dsh-llm-deepseek`](../../../packages/llm/llm-deepseek/README.md) references own direct `settings.yaml` configuration, catalog resolution, reasoning controls, credentials, and adapter errors.

::: tip The form is deliberately small
The Models page exposes only what a route needs to exist: the API key, display name, base URL, API protocol, and for each model its id, display name, context window, and max output tokens. Every other field — reasoning effort levels, image input, request-compatibility switches, headers, timeouts, retry policy — is set in `$DSH_HOME/settings.yaml`, the same document the page writes. Edit it directly, or, when the browser runs on the same machine as the server, open it with **Open configuration file** in the Settings header; the adapters re-read it on the next request, so nothing needs a restart. The subsections below cover the fields most gateways need.
:::

<a id="image-input"></a>
### Image input

A model you enter by hand is treated as text-only until it says otherwise, because nothing can ask an endpoint which modalities it accepts. Attaching an image to such a model is refused before it is sent, naming the model.

A vision model on a custom provider therefore needs one line. The form has no field for it; add `input` to the model in `$DSH_HOME/settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: legacy-chat
        - id: vision-preview
          input: [text, image]
```

`input` accepts `text` and `image`, and applies to that model alone, so one route can serve both kinds. Omitting it — or writing an empty list, which means the same thing — keeps whatever the installed catalog records for that model, and falls back to the route's `defaultInput` for a model the catalog does not describe.

If every model you entered by hand takes images, set the fallback once on the route instead of on each of them:

```yaml
llm-pi-ai:
  providers:
    vision-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://vision.example/v1
      defaultInput: [text, image]
      models:
        - id: first-model
        - id: second-model
```

`defaultInput` is a fallback, not an override, and defaults to `[text]`: on a built-in provider it answers only for models its catalog does not describe, so it never removes images from a catalog model that has them. Narrow one of those with that model's own `input`. A built-in provider has no `models` list to put it in, so write it under `modelOverrides`, keyed by model id:

```yaml
llm-pi-ai:
  providers:
    anthropic:
      modelOverrides:
        claude-sonnet-4-5:
          input: [text]
```

Every list must name at least one modality except a model's own, where an empty list means the same as omitting it. An unknown modality is refused wherever it is written.

Both fields state a claim about your endpoint rather than checking it. A model that declares images its endpoint does not serve is not caught here; the provider rejects the request instead.

### Reasoning effort

The model picker offers an **Effort** menu for a model that declares reasoning levels. A built-in provider's models inherit their levels from the installed catalog. A model you enter by hand declares none, so the Effort entry does not appear in the menu and the endpoint's own default decides whether the model thinks. Declare the levels with `reasoningEfforts` in `$DSH_HOME/settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      reasoning: high
      models:
        - id: my-reasoner
          reasoningEfforts:
            off:
            high: high
            max: max
```

Each key is a level the menu offers, and its value is the spelling sent on the wire as `reasoning_effort`, so `max: xhigh` renames a level for a gateway with its own vocabulary. Only `off` may stay empty, because for most endpoints not thinking is the parameter's absence. The route's `reasoning` is the level used while a session has picked none; choosing an effort in the picker saves it, with the model, as the default for new sessions.

An `off` left empty sends nothing, which only stops a model that thinks on request; an `off` given a value sends that value as `reasoning_effort` instead. A model that thinks unless told not to — DeepSeek V4 behind an OpenAI-compatible gateway, for example — needs `compat.thinkingFormat: deepseek`, which makes `off` send `thinking: {type: disabled}` and every other level send `thinking: {type: enabled}` beside the effort:

```yaml
      models:
        - id: deepseek-v4-pro
          compat:
            thinkingFormat: deepseek
          reasoningEfforts:
            off:
            high: high
            max: max
```

A built-in provider's model whose gateway does not reason loses its levels with `reasoningEfforts: false` under `modelOverrides`; selecting an effort for it is then refused as `UNSUPPORTED_REASONING_EFFORT`. DeepSeek's own route needs none of this: its models already offer `off`, `low`, `high`, and `max`, and `llm-deepseek.reasoningEffort` sets the default the picker starts from:

```yaml
llm-deepseek:
  reasoningEffort: max
```

<a id="claude-model-onboarding"></a>
### Claude: add an Anthropic model

Native Claude routes use `anthropic-messages`, usually through the existing `anthropic` provider. For a gateway, first confirm that it accepts the exact model ID, then obtain the context window, output limit, input modalities, and reasoning levels from upstream documentation or verified configuration. A successful minimal call proves routing, not the accuracy of capacity metadata.

#### 1. Preserve the provider and existing models

Read `llm-pi-ai.providers.anthropic` in `$DSH_HOME/settings.yaml`. If it has an explicit `models` list, append the entry to that list and retain every older model you still need; the list replaces the installed catalog rather than extending it. When there is no explicit list and the catalog already contains the target, use the catalog directly; `modelOverrides` can adjust a known model, but cannot coexist with `models` or add a model unknown to the catalog.

Keep the existing `baseURL` and `apiKeyEnv`. For a first setup, configure the credential through **Settings → Models → Add provider → anthropic**; choose `anthropic-messages` for a custom route. `apiKeyEnv: ANTHROPIC_API_KEY` is a credential reference, not the key value. Do not write keys or bearer tokens into documentation, the repository, or model entries.

#### 2. Declare the Claude model's capabilities

The example uses `claude-fable-5-1` and assumes the endpoint supports a 1M context, 128K output, image input, and the listed adaptive reasoning levels. These are example settings, not universal Claude specifications; adjust them to the endpoint before use. Merge only the needed fields and model entry into an existing configuration rather than replacing the whole settings file:

```yaml
llm-pi-ai:
  providers:
    anthropic:
      api: anthropic-messages
      apiKeyEnv: ANTHROPIC_API_KEY
      models:
        - id: claude-fable-5-1
          name: Claude Fable 5.1
          contextWindow: 1000000
          maxTokens: 128000
          input: [text, image]
          reasoningEfforts:
            low: low
            medium: medium
            high: high
            xhigh: xhigh
            max: max
          compat:
            forceAdaptiveThinking: true
```

Declare only capabilities the endpoint supports; omit `off` when disabling reasoning is unsupported. Use `forceAdaptiveThinking: true` only for models whose endpoint supports adaptive thinking and needs that protocol behavior explicitly enabled; a request with a selected reasoning level then uses `thinking.type: adaptive` and `output_config.effort`. Do not add it to every Claude model or copy this Anthropic-only switch into a GPT `openai-responses` or `openai-completions` route.

#### 3. Verify before switching the default

Check that the YAML parses, then verify a minimal upstream call, the model entry in DSH, image capability, and reasoning levels. Send a minimal prompt in a new session and confirm the target provider/model in `request/header` and the configured capacity in `request/context.contextWindow`; also verify image or tool requests if you use them. Keep an older model available until these checks succeed rather than switching the default before investigating failures.

After verification, select Claude and the desired reasoning level in the model picker, or merge the following new-session defaults. `high` is this example's choice; before using `max`, confirm that both the endpoint and the model declaration support it:

```yaml
agent-default-model:
  provider: anthropic
  model: claude-fable-5-1
  reasoningEffort: high
```

Model configuration is re-read on the next request; changing the global default does not replace an existing session's model selection. To use Claude in an existing session, explicitly switch through that session's model picker.

#### 4. Check automatic compaction separately

`maxTokens` caps output, not automatic compaction. Without an exact model-policy override, the backend's 80% default triggers at 800K measured pressure for a 1M window; Astra's 90% policy does not automatically apply to Claude. For a dedicated threshold, configure `thresholdRatio = target threshold / contextWindow` for the exact `anthropic/<model ID>` in a custom preset and keep `retainRatio < thresholdRatio`; alternatively, set `retainTokens` below the trigger threshold.

Web's compaction engine belongs to the session preset. Copy an existing preset into the user preset directory `$DSH_HOME/.agent-presets/`, edit the copy, and create a session using it; do not edit an installed shipped preset directly because upgrades overwrite it. The [preset reference](../../../packages/preset/agent-presets/README.md) documents copying, default selection, and activation.

<a id="astra-long-context"></a>
### GPT-6 Astra: 1M context and 900K compaction

DSH uses its own model settings, not Codex's `-c` flags or `config.toml`. When your endpoint supports a 1,000,000-token window and `max` effort, merge these fields into the existing `openai` model entry in `$DSH_HOME/settings.yaml`. Preserve its endpoint, credential reference, other models, and any additional reasoning levels:

```yaml
llm-pi-ai:
  providers:
    openai:
      models:
        - id: gpt-6-astra
          contextWindow: 1000000
          maxTokens: 128000
          input: [text, image]
          reasoningEfforts:
            high: high
            max: max
agent-default-model:
  provider: openai
  model: gpt-6-astra
  reasoningEffort: max
```

The context meter and model request preparation use `contextWindow` on the next request. The Responses API sends `reasoning.effort: max`; Chat Completions uses `reasoning_effort: max`. `maxTokens` is an output ceiling, not the context window; the adapter may reduce output to fit the remaining context. Declaring 1M does not grant endpoint access or prove its actual capacity.

The [base bundle](../../../packages/bundle/base/README.md) and [standard, Cordis, and PTC presets](../../../packages/preset/agent-presets/README.md) configure `compaction-basic.modelPolicies` for the exact `openai/gpt-6-astra` route with `thresholdRatio: 0.9`. With a 1M window, `floor(1000000 * 0.9)` gives a 900,000-token measured-pressure trigger; other routes keep the 80% default. This is the DSH equivalent of the requested compaction limit for that window, not an independent absolute limit: changing the window also changes the threshold. Provider-confirmed overflow can trigger recovery earlier.

Preset policy changes apply to newly composed agents. An already resident agent keeps its preset generation; refreshing the browser or sending another turn does not update its compaction policy. Restart DSH and reopen the saved session to recompose it, or start a new session. Model-capacity settings alone do not require a restart.

### Request compatibility

A gateway can hold a working key at a reachable address and still refuse every request. pi-ai decides the shape of a request — which role carries the system prompt, which field caps the output, how a thinking level travels — from the endpoint's URL, and an address it does not recognize is addressed as though it were OpenAI itself. Most OpenAI-compatible gateways refuse at least one thing OpenAI accepts.

Two account for most of it. A model that declares reasoning has its system prompt sent as `role: "developer"`, which many gateways reject outright, and the output cap is sent as `max_completion_tokens`, which a server that only knows `max_tokens` refuses. The form has no field for either; correct them on the route in `$DSH_HOME/settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      compat:
        supportsDeveloperRole: false
        maxTokensField: max_tokens
      models:
        - id: my-model
```

A route's `compat` is the default for its models, and a model's own wins field by field, so one model can be corrected without restating the route:

```yaml
      models:
        - id: my-model
        - id: my-reasoner
          compat:
            thinkingFormat: deepseek
```

What neither sets keeps the installed catalog's value for that model, and what the catalog does not describe falls to pi-ai's detection. Give every switch you name a value: a key left empty (`supportsDeveloperRole:`) is refused rather than ignored, because an empty value would erase what the catalog knows while saying nothing in its place. A name no protocol accepts is refused too, and the message lists the ones that are available.

Each switch belongs to the protocols that declare it, so a switch valid on one `api` may be refused on another — the message names what that protocol does offer. Like `input` above, a switch states a claim about your endpoint rather than checking it: setting one your gateway does not actually need simply sends a different request.

Every switch, its accepted values, and the protocols that take it are listed under `PiAiCompatProfile` in the [generated `dsh-llm-pi-ai` configuration reference](../../config-catalog.md#deepseek-aidsh-llm-pi-ai) — which is derived from the source, so it cannot fall behind what the adapter accepts.

## Troubleshooting

- **`MISSING_CREDENTIAL`** — Store the provider key through the Models page or supply the referenced environment variable.
- **`UNKNOWN_MODEL`** — Select a configured model or add the missing model to the custom provider.
- **Fetching available models returns 401** — Check the key. Model discovery calls the OpenAI-compatible `GET /models` endpoint; enter models manually for endpoints that do not provide it.
- **Fetching available models reports neither a `data` array nor a `models` object** — The endpoint's listing is in a format discovery does not read. Enter the models by hand.
- **The gateway refuses every request although the key and URL are right** — Its request shape differs from OpenAI's. Start with `compat.supportsDeveloperRole: false` and `compat.maxTokensField: max_tokens` on the route.
- **Only reasoning models fail** — pi-ai sends their system prompt as the `developer` role, which the gateway rejects. Set `compat.supportsDeveloperRole: false`.
- **The Effort menu does not appear for a model you entered by hand** — It declares no levels. Add `reasoningEfforts` to the model in `settings.yaml`.
- **`off` does not stop a DeepSeek model from thinking** — An empty `off` sends no reasoning field at all, and an endpoint that thinks by default keeps thinking. Set `compat.thinkingFormat: deepseek` on the model or the route.
- **A compat switch is refused as having no value** — A key written with nothing after the colon. Give it a value, or remove the key to keep the installed catalog's.
- **An image is refused before sending** — The model declares no image modality. Give a custom provider's model `input: [text, image]`; on DeepSeek's own route, select `deepseek-v4-flash-vision-exp`, the model that declares images.
- **The provider rejects a request carrying an image** — The model declares images its endpoint does not actually serve. Remove `image` from whichever list granted it — the model's `input`, or the route's `defaultInput` — then start a new session: the attached image stays in the session log, so the same request repeats until the session moves off it.
