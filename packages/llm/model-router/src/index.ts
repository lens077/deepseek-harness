/**
 * Model router Service Definition (`ctx.modelRouter`): a provider reads one
 * human prompt and the route its owner selected, then proposes the route the
 * next request should use. The consumer that queues the prompt owns
 * enforcement and the durable `model/route` record; the rationale is in the
 * [prompt-driven routing Agent Note](../../../../.agents/notes/proposed/feature/2026-09-10-prompt-driven-model-routing.md).
 * @module @deepseek-ai/dsh-model-router
 */

import { Context, Service } from '@deepseek-ai/cordis'
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

/**
 * Abstract prompt-driven route selection. Load one implementation per
 * context as `ctx.modelRouter`. Implementations are pure decision functions:
 * they never validate a route against the live LLM registry, never mutate the
 * session, and answer with the baseline when nothing applies.
 */
export abstract class ModelRouter extends Service {
  constructor(ctx: Context) {
    super(ctx, 'modelRouter')
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
