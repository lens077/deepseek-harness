/**
 * Deterministic rule-list model router: the first configured rule whose
 * conditions all match the prompt selects a reasoning effort on the baseline
 * route; no match answers with the baseline unchanged. Zero latency and
 * replayable, so keyless recorded sessions can pin its decisions.
 * @module @deepseek-ai/dsh-model-router-rules
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand'
import { ModelRouter } from '@deepseek-ai/dsh-model-router'
import type { ModelRouteDecision, ModelRouteInput } from '@deepseek-ai/dsh-model-router'

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
  /** Adapter-owned reasoning effort applied on the baseline route when the rule matches. */
  readonly reasoningEffort: string
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
  readonly reasoningEffort: ReasoningEffortId
}

const ruleSchema: z<RuleConfig> = z.object({
  id: z.string().required(),
  pattern: z.string(),
  maxBytes: z.number().step(1).min(0),
  minBytes: z.number().step(1).min(0),
  hasImage: z.boolean(),
  reasoningEffort: z.string().required(),
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
    if (rule.reasoningEffort.length === 0) throw new Error(`${label} needs a non-empty reasoningEffort`)
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
      reasoningEffort: ReasoningEffortId(rule.reasoningEffort),
    }
  })
}

/**
 * Rule-list router. Rules are tested in configuration order and the first
 * complete match decides; the answer keeps the baseline provider and model and
 * replaces only the reasoning effort.
 */
export class RulesModelRouter extends ModelRouter {
  static Config: z<Config> = z.object({
    rules: z.array(ruleSchema),
  })

  private readonly rules: readonly CompiledRule[]

  /**
   * @param ctx - Host context receiving `ctx.modelRouter`.
   * @param config - validated rule list.
   * @throws when the list is empty, an id repeats, a rule has no condition, its byte bounds cross, or its pattern does not compile.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.rules = compileRules(config.rules)
  }

  /**
   * Select the first rule whose conditions all hold for the prompt.
   * @param input - baseline route and prompt to classify.
   * @returns the baseline with the matched rule's effort, or the baseline unchanged.
   */
  route(input: ModelRouteInput): Promise<ModelRouteDecision> {
    const byteLength = new TextEncoder().encode(input.prompt.text).length
    for (const rule of this.rules) {
      if (rule.maxBytes !== undefined && byteLength > rule.maxBytes) continue
      if (rule.minBytes !== undefined && byteLength < rule.minBytes) continue
      if (rule.hasImage !== undefined && rule.hasImage !== input.prompt.hasImage) continue
      if (rule.pattern !== undefined && !rule.pattern.test(input.prompt.text)) continue
      return Promise.resolve({
        selection: { ...input.baseline, reasoningEffort: rule.reasoningEffort },
        reason: `rule "${rule.id}" matched`,
        rule: rule.id,
      })
    }
    return Promise.resolve({ selection: input.baseline, reason: 'no rule matched' })
  }
}

export default RulesModelRouter
