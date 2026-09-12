/**
 * Model router Service Definition (`ctx.modelRouter`): a provider reads one
 * human prompt and the route its owner selected, then proposes the route the
 * next request should use. The consumer that queues the prompt owns
 * enforcement and the durable `model/route` record; the rationale is in the
 * [prompt-driven routing Agent Note](../../../../.agents/notes/proposed/feature/2026-09-10-prompt-driven-model-routing.md).
 * @module @deepseek-ai/dsh-model-router
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import type { ModelRouteDecision, ModelRouteInput } from './types.ts'

export type {
  ModelRoute,
  ModelRouteDecision,
  ModelRouteInput,
  ModelRoutePrompt,
  ModelRouteRecord,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    modelRouter: ModelRouter
  }
}

/** User-settings section every mounted router serves. */
export const MODEL_ROUTING_SETTINGS_NAMESPACE = 'model-routing'

/** Stored user preference over the mounted router. */
export interface ModelRoutingSettings {
  /** Whether prompts consult the router; off keeps every Session on the route its person selected. */
  enabled: boolean
}

/** Schema served to settings clients for the preference. */
export const MODEL_ROUTING_SETTINGS_SCHEMA: z<ModelRoutingSettings> = z.object({
  enabled: z.boolean().default(true),
})

/**
 * Abstract prompt-driven route selection. Load one implementation per
 * context as `ctx.modelRouter`. Implementations are pure decision functions:
 * they never validate a route against the live LLM registry, never mutate the
 * session, and answer with the baseline when nothing applies.
 *
 * Mounting any implementation serves the `model-routing` settings section
 * while a settings provider is present; its `enabled` switch lets a person
 * stop routing without unmounting the provider, and consumers read it through
 * {@link ModelRouter.enabled} before every prompt.
 */
export abstract class ModelRouter extends Service {
  private source: () => ModelRoutingSettings = () => ({ enabled: true })

  constructor(ctx: Context) {
    super(ctx, 'modelRouter')
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(
        ctx,
        MODEL_ROUTING_SETTINGS_NAMESPACE,
        MODEL_ROUTING_SETTINGS_SCHEMA,
        { enabled: true },
        {
          setSource: (source) => { this.source = source },
          // Consumers read the switch per prompt, so a change needs no re-judging here.
          onChange: () => {},
        },
      )
    })
  }

  /**
   * Whether the person left routing on. Without a settings provider the
   * answer is always true.
   * @returns the current `model-routing.enabled` value.
   */
  enabled(): boolean {
    return this.source().enabled
  }

  /**
   * Propose the route for the prompt about to be queued. The call sits in the
   * prompt's admission path, so an implementation that performs I/O must bound
   * its own latency.
   * @param input - the owner's baseline route and the prompt to classify.
   * @returns the proposed route with its justification; the baseline when no rule applies.
   * @throws when classification fails; the consumer keeps the baseline and records the failure.
   */
  abstract route(input: ModelRouteInput): Promise<ModelRouteDecision>
}

export default ModelRouter
