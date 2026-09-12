/**
 * Model-classified router: one bounded auxiliary request on the baseline
 * route — the model the person already selected — reads the prompt and names
 * one configured choice; the choice's route or effort becomes the proposal.
 * The classifier request is reconstructable from this configuration and the
 * logged prompt, so it writes no Session event of its own.
 * @module @deepseek-ai/dsh-model-router-llm
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { FinishReason, GenerateOptions } from '@deepseek-ai/dsh-llm'
import { ModelRouter } from '@deepseek-ai/dsh-model-router'
import type { ModelRoute, ModelRouteDecision, ModelRouteInput } from '@deepseek-ai/dsh-model-router'
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'

/** Capability-owned timeout reason code for the classifier request. */
export const MODEL_ROUTING_TIMEOUT_CODE = 'MODEL_ROUTING_TIMEOUT'

/** The reserved verdict that keeps the person's route. */
export const BASELINE_CHOICE = 'baseline'

/** One choice the classifier may name; every present route or effort becomes the proposal. */
export interface ChoiceConfig {
  /** Unique verdict token the classifier answers with; `baseline` is reserved. */
  readonly id: string
  /** When the classifier should pick this choice, written for the model. */
  readonly description: string
  /** Registered provider of the route to propose; requires `model` and must be a configured route. */
  readonly provider?: string
  /** Provider-owned model id of the route to propose; requires `provider`. */
  readonly model?: string
  /** Adapter-owned reasoning effort on the proposed route, or the baseline route when no model is named. */
  readonly reasoningEffort?: string
}

/** Required deployment policy for the classifier request. */
export interface Config {
  /** Choices offered to the classifier; the first whose id it answers with decides, and an empty list fails at load. */
  choices: ChoiceConfig[]
  /** Maximum UTF-8 bytes of the framed prompt sent to the classifier; a longer prompt keeps the baseline. */
  maxInputBytes: number
  /** Classifier output-token cap; a verdict is a few tokens. */
  maxOutputTokens: number
  /** End-to-end classifier deadline in milliseconds; the prompt waits this long at most. */
  timeoutMs: number
  /**
   * Reasoning effort for the classifier call on the baseline model; absent
   * means the first effort that model advertises, which adapters order from
   * least to most thinking, or the model's default when it advertises none.
   */
  classifierReasoningEffort?: string
}

interface CompiledChoice {
  readonly id: string
  readonly description: string
  readonly route: Pick<ModelRoute, 'provider' | 'model'> | undefined
  readonly reasoningEffort: ReasoningEffortId | undefined
}

const choiceSchema: z<ChoiceConfig> = z.object({
  id: z.string().required(),
  description: z.string().required(),
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
})

/** Fail loudly at load on any choice the classifier could never apply as written. */
function compileChoices(choices: readonly ChoiceConfig[]): CompiledChoice[] {
  if (choices.length === 0) throw new Error('model-router-llm: choices must list at least one choice')
  const ids = new Set<string>()
  return choices.map((choice) => {
    const label = `model-router-llm: choice "${choice.id}"`
    if (choice.id.length === 0 || /\s/u.test(choice.id)) {
      throw new Error('model-router-llm: every choice needs a non-empty id without whitespace')
    }
    if (choice.id.toLowerCase() === BASELINE_CHOICE) throw new Error(`${label} uses the reserved id`)
    if (ids.has(choice.id.toLowerCase())) throw new Error(`${label} is declared more than once`)
    ids.add(choice.id.toLowerCase())
    if (choice.description.trim().length === 0) throw new Error(`${label} needs a non-empty description`)
    if ((choice.provider === undefined) !== (choice.model === undefined)) {
      throw new Error(`${label} must name provider and model together`)
    }
    if (choice.provider !== undefined && (choice.provider.length === 0 || choice.model?.length === 0)) {
      throw new Error(`${label} needs a non-empty provider and model`)
    }
    if (choice.reasoningEffort !== undefined && choice.reasoningEffort.length === 0) {
      throw new Error(`${label} needs a non-empty reasoningEffort`)
    }
    if (choice.provider === undefined && choice.reasoningEffort === undefined) {
      throw new Error(`${label} needs a route (provider and model), a reasoningEffort, or both`)
    }
    return {
      id: choice.id,
      description: choice.description.trim(),
      route: choice.provider === undefined || choice.model === undefined
        ? undefined
        : { provider: choice.provider, model: choice.model },
      reasoningEffort: choice.reasoningEffort === undefined ? undefined : ReasoningEffortId(choice.reasoningEffort),
    }
  })
}

/** Whether `word` appears in `text` bounded by characters that cannot continue an id. */
function mentionsWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}_-])${escaped}(?![\\p{L}\\p{N}_-])`, 'u').test(text)
}

/** Translate terminal finish reasons into a classifier failure. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('model-router-llm: verdict reached maxOutputTokens')
    case 'tool-calls':
      return new Error('model-router-llm: classifier unexpectedly requested a tool')
    default:
      return new Error(`model-router-llm: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

/**
 * Model-classified router. Each prompt costs one bounded request on the
 * baseline route with thinking off where the adapter honors
 * `purpose: 'model-routing'`; any failure, timeout, or unrecognized verdict
 * throws so the consumer keeps the baseline.
 */
export class LlmModelRouter extends ModelRouter {
  static inject = ['llm']

  static Config: z<Config> = z.object({
    choices: z.array(choiceSchema),
    maxInputBytes: z.number().step(1).min(1).required(),
    maxOutputTokens: z.number().step(1).min(1).required(),
    timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
    classifierReasoningEffort: z.string(),
  })

  private readonly choices: readonly CompiledChoice[]
  private readonly config: Config
  private readonly system: string

  /**
   * @param ctx - Host context receiving `ctx.modelRouter` and carrying `ctx.llm`.
   * @param config - validated classifier policy.
   * @throws when a choice repeats, uses the reserved id, lacks a description or outcome, names
   * provider without model, or the classifier effort is empty; the schema owns the numeric limits.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.choices = compileChoices(config.choices)
    if (config.classifierReasoningEffort !== undefined && config.classifierReasoningEffort.length === 0) {
      throw new Error('model-router-llm: classifierReasoningEffort must be a non-empty string')
    }
    this.config = deepFreeze({ ...config })
    this.system = [
      'You route one user prompt sent to an AI coding assistant to the choice that fits it best.',
      'Choices:',
      ...this.choices.map(choice => `- ${choice.id}: ${choice.description}`),
      `- ${BASELINE_CHOICE}: keep the model the person selected; answer this when no other choice clearly fits.`,
      'Reply with exactly one choice id and nothing else.',
    ].join('\n')
  }

  /**
   * Ask the baseline model which choice fits the prompt and translate the
   * verdict into a proposal.
   * @param input - baseline route and prompt to classify.
   * @returns the named choice's route and effort, or the baseline for the reserved verdict.
   * @throws when the framed prompt exceeds `maxInputBytes`, the request fails or times out, or the verdict names no choice.
   */
  async route(input: ModelRouteInput): Promise<ModelRouteDecision> {
    const framed = `Route this prompt, given as JSON:\n${JSON.stringify({ prompt: input.prompt.text, hasImage: input.prompt.hasImage })}`
    const inputBytes = new TextEncoder().encode(framed).length
    if (inputBytes > this.config.maxInputBytes) {
      throw new Error(`model-router-llm: framed prompt is ${inputBytes} bytes, exceeding maxInputBytes ${this.config.maxInputBytes}`)
    }
    const reasoningEffort = await this.classifierEffort(input.baseline)
    using callDeadline = deadline(undefined, this.config.timeoutMs, MODEL_ROUTING_TIMEOUT_CODE)
    const options: GenerateOptions = deepFreeze({
      provider: input.baseline.provider,
      model: input.baseline.model,
      messages: [createUserMessage({
        content: [{ type: 'text', text: framed }],
        source: { kind: 'plugin', plugin: 'dsh-model-router-llm' },
      })],
      system: this.system,
      maxTokens: this.config.maxOutputTokens,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      purpose: 'model-routing',
      signal: callDeadline.signal,
    })
    const assembler = new BlockAssembler()
    for await (const chunk of this.ctx.llm.stream(options)) {
      callDeadline.signal.throwIfAborted()
      assembler.push(chunk)
    }
    callDeadline.signal.throwIfAborted()
    const terminalError = finishError(assembler.finish)
    if (terminalError !== undefined) throw terminalError
    const verdict = assembler.blocks()
      .flatMap(block => block.type === 'text' ? [block.text] : [])
      .join(' ')
    const choice = this.parseVerdict(verdict)
    if (choice === BASELINE_CHOICE) {
      return { selection: input.baseline, reason: 'classifier chose baseline' }
    }
    const route = choice.route ?? { provider: input.baseline.provider, model: input.baseline.model }
    return {
      selection: {
        ...route,
        ...(choice.reasoningEffort === undefined ? {} : { reasoningEffort: choice.reasoningEffort }),
      },
      reason: `classifier chose "${choice.id}"`,
      rule: choice.id,
    }
  }

  /** The configured classifier effort, else the least effort the baseline model advertises. */
  private async classifierEffort(baseline: ModelRoute): Promise<ReasoningEffortId | undefined> {
    if (this.config.classifierReasoningEffort !== undefined) {
      return ReasoningEffortId(this.config.classifierReasoningEffort)
    }
    const info = await this.ctx.llm.resolveModelInfo(baseline.provider, baseline.model)
    const least = info.reasoning?.efforts[0]?.id
    return least === undefined ? undefined : ReasoningEffortId(least)
  }

  /** Match the verdict exactly, else as the single choice id it mentions as a whole word. */
  private parseVerdict(text: string): CompiledChoice | typeof BASELINE_CHOICE {
    const normalized = text.trim().replace(/^[`"'*\s]+|[`"'*.\s]+$/gu, '').toLowerCase()
    if (normalized === BASELINE_CHOICE) return BASELINE_CHOICE
    const exact = this.choices.find(choice => choice.id.toLowerCase() === normalized)
    if (exact !== undefined) return exact
    const lower = text.toLowerCase()
    const mentioned = this.choices.filter(choice => mentionsWord(lower, choice.id.toLowerCase()))
    const [single, second] = mentioned
    if (single !== undefined && second === undefined) return single
    if (single === undefined && mentionsWord(lower, BASELINE_CHOICE)) return BASELINE_CHOICE
    throw new Error(`model-router-llm: verdict ${JSON.stringify(text)} names no single choice`)
  }
}

export default LlmModelRouter
