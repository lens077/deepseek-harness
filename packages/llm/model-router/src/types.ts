/**
 * Cordis-free route-selection vocabulary shared by providers, consumers, and
 * the durable `model/route` record.
 * @module @deepseek-ai/dsh-model-router/types
 */

import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
// Type-only: binds the augmentation below to the Session event map module.
import type {} from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One routing decision taken for a human prompt before that prompt was
     * queued. `selection` is the route the consumer applied to the next
     * request after enforcing its own constraints; when it differs from the
     * provider's answer, `reason` names the refused constraint. Log-only: the
     * applied route reaches the model only through the later `request/header`.
     */
    'model/route': ModelRouteRecord
  }
}

/** One exact provider/model route and optional adapter-owned reasoning effort. */
export interface ModelRoute {
  /** Registered provider route. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Adapter-owned reasoning effort; absent means the model's own default. */
  readonly reasoningEffort?: ReasoningEffortId
}

/** The human prompt a provider classifies. */
export interface ModelRoutePrompt {
  /** Concatenated text parts of the prompt; image and file parts add no text. */
  readonly text: string
  /** Whether the prompt carries at least one image part. */
  readonly hasImage: boolean
}

/** Everything a provider may read when choosing a route. */
export interface ModelRouteInput {
  /** The route the human or caller owns; the answer when no rule applies. */
  readonly baseline: ModelRoute
  /**
   * Every provider/model route the deployment configures, without efforts.
   * The consumer refuses a proposal naming a route outside this list, and
   * refuses any route change while the list holds fewer than two routes.
   */
  readonly candidates: readonly ModelRoute[]
  /** The prompt about to be queued. */
  readonly prompt: ModelRoutePrompt
}

/** A provider's answer for one prompt. */
export interface ModelRouteDecision {
  /**
   * Route the provider proposes; equal to the baseline when nothing applies.
   * An effort belongs to the proposed model, so a proposal that changes the
   * model without naming an effort asks for that model's default.
   */
  readonly selection: ModelRoute
  /** Short human-readable justification recorded in the session log. */
  readonly reason: string
  /** Provider-owned identifier of the rule or classifier output that decided. */
  readonly rule?: string
}

/** Durable `model/route` payload written by a consumer after enforcement. */
export interface ModelRouteRecord {
  /** Route the human or caller owned when the prompt arrived. */
  readonly baseline: ModelRoute
  /** Route the consumer applied to the next request. */
  readonly selection: ModelRoute
  /** Provider justification, or the consumer constraint that refused it. */
  readonly reason: string
  /** Provider-owned rule identifier when one decided. */
  readonly rule?: string
}
