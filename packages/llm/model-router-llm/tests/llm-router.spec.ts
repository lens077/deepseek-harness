import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ModelRouteInput } from '@deepseek-ai/dsh-model-router'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { describe, expect, it } from 'vitest'
import { LlmModelRouter, MODEL_ROUTING_TIMEOUT_CODE } from '../src/index.ts'
import type { ChoiceConfig, Config } from '../src/index.ts'

const BASELINE = { provider: 'fixture', model: 'baseline-model' }
const STRONG = { provider: 'fixture', model: 'strong-model' }

const CHOICES: ChoiceConfig[] = [
  { id: 'fast', description: 'Short factual questions.', provider: 'fixture', model: 'fast-model' },
  { id: 'strong', description: 'Design and multi-file code.', provider: 'fixture', model: 'strong-model', reasoningEffort: 'max' },
  { id: 'deep', description: 'Long ambiguous requests on the current model.', reasoningEffort: 'high' },
]

const LIMITS = { maxInputBytes: 4096, maxOutputTokens: 16, timeoutMs: 1000 } as const

function reply(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  script: readonly StreamChunk[] = reply('fast')
  efforts: readonly string[] | undefined = ['low', 'high']

  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider: BASELINE.provider, id: BASELINE.model, name: 'Baseline' }])
  }

  override resolveModel(_provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider: BASELINE.provider,
      id: model,
      name: model,
      ...(this.efforts === undefined
        ? {}
        : { reasoning: { efforts: this.efforts.map(id => ({ id: ReasoningEffortId(id), name: id })) } }),
    })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield * this.script
  }
}

class HangingAdapter extends ScriptedAdapter {
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const signal = options.signal!
    await new Promise<never>((_resolve, reject) => {
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercise exact AbortSignal.reason propagation
      signal.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
    })
  }
}

async function harness(
  overrides: Partial<Config> = {},
  adapter: ScriptedAdapter = new ScriptedAdapter(),
): Promise<{ ctx: Context; router: LlmModelRouter; adapter: ScriptedAdapter }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['fixture'], adapter)
  await ctx.plugin(LlmModelRouter, { choices: CHOICES, ...LIMITS, ...overrides })
  return { ctx, router: ctx.modelRouter as LlmModelRouter, adapter }
}

function input(text: string, hasImage = false): ModelRouteInput {
  return { baseline: BASELINE, candidates: [BASELINE, STRONG], prompt: { text, hasImage } }
}

describe('LlmModelRouter', () => {
  it('asks the baseline model with thinking-off purpose, the least advertised effort, and the framed prompt', async () => {
    const { router, adapter } = await harness()
    await expect(router.route(input('What is 1+1?'))).resolves.toEqual({
      selection: { provider: 'fixture', model: 'fast-model' },
      reason: 'classifier chose "fast"',
      rule: 'fast',
    })
    expect(adapter.requests).toHaveLength(1)
    const request = adapter.requests[0]!
    expect(request).toMatchObject({
      provider: 'fixture',
      model: 'baseline-model',
      purpose: 'model-routing',
      reasoningEffort: 'low',
      maxTokens: 16,
    })
    expect(request.system).toContain('- fast: Short factual questions.')
    expect(request.system).toContain('- deep: Long ambiguous requests on the current model.')
    expect(request.system).toContain('- baseline: keep the model the person selected')
    expect(request.messages).toHaveLength(1)
    expect(JSON.stringify(request.messages[0]!.content)).toContain('{\\"prompt\\":\\"What is 1+1?\\",\\"hasImage\\":false}')
  })

  it('uses the configured classifier effort, or none when the model advertises no efforts', async () => {
    const configured = await harness({ classifierReasoningEffort: 'high' })
    await configured.router.route(input('hi'))
    expect(configured.adapter.requests[0]).toMatchObject({ reasoningEffort: 'high' })
    const bare = new ScriptedAdapter()
    bare.efforts = undefined
    const plain = await harness({}, bare)
    await plain.router.route(input('hi'))
    expect(plain.adapter.requests[0]!.reasoningEffort).toBeUndefined()
  })

  it.each<[string, string, unknown]>([
    ['an exact id with decoration', '  "Strong". ', { selection: { ...STRONG, reasoningEffort: 'max' }, rule: 'strong' }],
    ['an effort-only choice on the baseline route', 'deep', { selection: { ...BASELINE, reasoningEffort: 'high' }, rule: 'deep' }],
    ['the reserved verdict', 'baseline', { selection: BASELINE, reason: 'classifier chose baseline' }],
    ['one id mentioned in a sentence', 'I would pick fast for this one.', { rule: 'fast' }],
    ['baseline mentioned in a sentence', 'Keep the baseline model here.', { reason: 'classifier chose baseline' }],
  ])('accepts %s', async (_label, verdict, expected) => {
    const { router, adapter } = await harness()
    adapter.script = reply(verdict)
    await expect(router.route(input('anything'))).resolves.toMatchObject(expected as object)
  })

  it('reads the verdict from text blocks only, ignoring a reasoning block', async () => {
    const { router, adapter } = await harness()
    adapter.script = [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'strong looks tempting' },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'fast' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    await expect(router.route(input('anything'))).resolves.toMatchObject({ rule: 'fast' })
  })

  it.each<[string, StreamChunk[], RegExp]>([
    ['an empty verdict', reply(''), /names no single choice/],
    ['a verdict naming two choices', reply('fast or strong'), /names no single choice/],
    ['a verdict naming nothing known', reply('medium'), /names no single choice/],
    ['a tool call', [{ type: 'finish', reason: { kind: 'tool-calls' } }], /unexpectedly requested a tool/],
    ['a truncated verdict', [{ type: 'finish', reason: { kind: 'max-tokens' } }], /reached maxOutputTokens/],
    ['a provider error', [{ type: 'finish', reason: { kind: 'error', failure: { code: 'PROVIDER', message: 'boom' } } }], /boom/],
    ['an unknown finish reason', [{ type: 'finish', reason: { kind: 'future' } as never }], /unsupported finish reason "future"/],
  ])('throws on %s so the consumer keeps the baseline', async (_label, script, message) => {
    const { router, adapter } = await harness()
    adapter.script = script
    await expect(router.route(input('anything'))).rejects.toThrow(message)
  })

  it('refuses a framed prompt over maxInputBytes before any request', async () => {
    const { router, adapter } = await harness({ maxInputBytes: 64 })
    await expect(router.route(input('x'.repeat(100)))).rejects.toThrow(/exceeding maxInputBytes 64/)
    expect(adapter.requests).toHaveLength(0)
  })

  it('aborts the classifier at the configured deadline', async () => {
    const { router } = await harness({ timeoutMs: 20 }, new HangingAdapter())
    await expect(router.route(input('slow'))).rejects.toMatchObject({ code: MODEL_ROUTING_TIMEOUT_CODE })
  })

  it.each<[string, Partial<Config>, RegExp]>([
    ['an empty choice list', { choices: [] }, /at least one choice/],
    ['a whitespace id', { choices: [{ id: 'a b', description: 'x', reasoningEffort: 'low' }] }, /without whitespace/],
    ['the reserved id', { choices: [{ id: 'Baseline', description: 'x', reasoningEffort: 'low' }] }, /reserved id/],
    ['a repeated id', { choices: [
      { id: 'a', description: 'x', reasoningEffort: 'low' },
      { id: 'A', description: 'y', reasoningEffort: 'low' },
    ] }, /declared more than once/],
    ['an empty description', { choices: [{ id: 'a', description: '  ', reasoningEffort: 'low' }] }, /non-empty description/],
    ['a provider without a model', { choices: [{ id: 'a', description: 'x', provider: 'p' }] }, /provider and model together/],
    ['an empty route', { choices: [{ id: 'a', description: 'x', provider: '', model: '' }] }, /non-empty provider and model/],
    ['an empty effort', { choices: [{ id: 'a', description: 'x', reasoningEffort: '' }] }, /non-empty reasoningEffort/],
    ['no outcome', { choices: [{ id: 'a', description: 'x' }] }, /a route \(provider and model\), a reasoningEffort, or both/],
    ['a zero limit', { maxOutputTokens: 0 }, /maxOutputTokens/],
    ['a timeout above the timer range', { timeoutMs: MAX_TIMER_DELAY_MS + 1 }, /timeoutMs/],
    ['an empty classifier effort', { classifierReasoningEffort: '' }, /classifierReasoningEffort must be a non-empty string/],
  ])('fails at load on %s', async (_label, overrides, message) => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await expect(ctx.plugin(LlmModelRouter, { choices: CHOICES, ...LIMITS, ...overrides })).rejects.toThrow(message)
  })
})
