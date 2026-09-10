/**
 * Deterministic rule-list model router: the first configured rule whose
 * conditions all match the prompt proposes a configured provider/model route,
 * a reasoning effort, or both; no match answers with the baseline unchanged.
 * Zero latency and replayable, so keyless recorded sessions can pin its
 * decisions.
 * @module @deepseek-ai/dsh-model-router-rules
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import { ModelRouter } from '@deepseek-ai/dsh-model-router'
import type { ModelRoute, ModelRouteDecision, ModelRouteInput } from '@deepseek-ai/dsh-model-router'

/** One ordered routing rule; every present condition must hold for it to match. */
export interface RuleConfig {
  /** Unique identifier recorded as `rule` on the durable decision. */
  readonly id: string
  /** JavaScript regular expression source tested against the prompt text with the `u` and `s` flags. */
  readonly pattern?: string
  /** Match only when the prompt's UTF-8 byte length is at most this value. */
  readonly maxBytes?: number
  /** Match only when the prompt's UTF-8 byte length is at least this value. */
  readonly minBytes?: number
  /** Match only when image presence equals this value. */
  readonly hasImage?: boolean
  /** Registered provider of the route to propose; requires `model` and must be a configured route. */
  readonly provider?: string
  /** Provider-owned model id of the route to propose; requires `provider`. */
  readonly model?: string
  /** Adapter-owned reasoning effort on the proposed route, or the baseline route when no model is named. */
  readonly reasoningEffort?: string
}

/** Deployment rule list; a mounted router with no rule is a misconfiguration. */
export interface Config {
  /** Ordered rules; the first whose conditions all hold decides, and an empty list fails at load. */
  rules: RuleConfig[]
}

interface CompiledRule {
  readonly id: string
  readonly pattern: RegExp | undefined
  readonly maxBytes: number | undefined
  readonly minBytes: number | undefined
  readonly hasImage: boolean | undefined
  readonly route: Pick<ModelRoute, 'provider' | 'model'> | undefined
  readonly reasoningEffort: ReasoningEffortId | undefined
}

const ruleSchema: z<RuleConfig> = z.object({
  id: z.string().required(),
  pattern: z.string(),
  maxBytes: z.number().step(1).min(0),
  minBytes: z.number().step(1).min(0),
  hasImage: z.boolean(),
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
})

/** Fail loudly at load on any rule the router could never apply as written. */
function compileRules(rules: readonly RuleConfig[]): CompiledRule[] {
  if (rules.length === 0) {
    throw new Error('model-router-rules: rules must list at least one rule')
  }
  const ids = new Set<string>()
  return rules.map((rule) => {
    const label = `model-router-rules: rule "${rule.id}"`
    if (rule.id.length === 0) throw new Error('model-router-rules: every rule needs a non-empty id')
    if (ids.has(rule.id)) throw new Error(`${label} is declared more than once`)
    ids.add(rule.id)
    if ((rule.provider === undefined) !== (rule.model === undefined)) {
      throw new Error(`${label} must name provider and model together`)
    }
    if (rule.provider !== undefined && (rule.provider.length === 0 || rule.model?.length === 0)) {
      throw new Error(`${label} needs a non-empty provider and model`)
    }
    if (rule.reasoningEffort !== undefined && rule.reasoningEffort.length === 0) {
      throw new Error(`${label} needs a non-empty reasoningEffort`)
    }
    if (rule.provider === undefined && rule.reasoningEffort === undefined) {
      throw new Error(`${label} needs a route (provider and model), a reasoningEffort, or both`)
    }
    if (rule.pattern === undefined && rule.maxBytes === undefined
      && rule.minBytes === undefined && rule.hasImage === undefined) {
      throw new Error(`${label} needs at least one of pattern, maxBytes, minBytes, or hasImage`)
    }
    if (rule.minBytes !== undefined && rule.maxBytes !== undefined && rule.minBytes > rule.maxBytes) {
      throw new Error(`${label} has minBytes greater than maxBytes`)
    }
    let pattern: RegExp | undefined
    if (rule.pattern !== undefined) {
      try {
        pattern = new RegExp(rule.pattern, 'us')
      } catch (error: unknown) {
        throw new Error(`${label} has an invalid pattern: ${String(error)}`)
      }
    }
    return {
      id: rule.id,
      pattern,
      maxBytes: rule.maxBytes,
      minBytes: rule.minBytes,
      hasImage: rule.hasImage,
      route: rule.provider === undefined || rule.model === undefined
        ? undefined
        : { provider: rule.provider, model: rule.model },
      reasoningEffort: rule.reasoningEffort === undefined ? undefined : ReasoningEffortId(rule.reasoningEffort),
    }
  })
}

/**
 * Rule-list router. Rules are tested in configuration order and the first
 * complete match decides. A rule naming a route proposes that route with its
 * own effort, if any; a rule naming only an effort keeps the baseline route.
 */
export class RulesModelRouter extends ModelRouter {
  static Config: z<Config> = z.object({
    rules: z.array(ruleSchema),
  })

  private readonly rules: readonly CompiledRule[]

  /**
   * @param ctx - Host context receiving `ctx.modelRouter`.
   * @param config - validated rule list.
   * @throws when the list is empty, an id repeats, a rule has no condition or no outcome, names provider
   * without model, its byte bounds cross, or its pattern does not compile.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.rules = compileRules(config.rules)
  }

  /**
   * Select the first rule whose conditions all hold for the prompt.
   * @param input - baseline route and prompt to classify.
   * @returns the matched rule's proposal, or the baseline unchanged.
   */
  route(input: ModelRouteInput): Promise<ModelRouteDecision> {
    const byteLength = new TextEncoder().encode(input.prompt.text).length
    for (const rule of this.rules) {
      if (rule.maxBytes !== undefined && byteLength > rule.maxBytes) continue
      if (rule.minBytes !== undefined && byteLength < rule.minBytes) continue
      if (rule.hasImage !== undefined && rule.hasImage !== input.prompt.hasImage) continue
      if (rule.pattern !== undefined && !rule.pattern.test(input.prompt.text)) continue
      const route = rule.route ?? { provider: input.baseline.provider, model: input.baseline.model }
      return Promise.resolve({
        selection: {
          ...route,
          ...(rule.reasoningEffort === undefined ? {} : { reasoningEffort: rule.reasoningEffort }),
        },
        reason: `rule "${rule.id}" matched`,
        rule: rule.id,
      })
    }
    return Promise.resolve({ selection: input.baseline, reason: 'no rule matched' })
  }
}

export default RulesModelRouter
