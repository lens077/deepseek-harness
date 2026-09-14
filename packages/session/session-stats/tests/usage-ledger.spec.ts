/** Request-attempt, fork ownership, billing completeness, and persisted replay regressions. */
import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createSystemMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { createUsageLedgerProjection, usageLedgerViewSchema } from '../src/usage-ledger.ts'
import { priceUsage, resolveRoutePrice, usageConfigSchema } from '../src/usage-config.ts'
import type { UsageStatsConfig } from '../src/types.ts'

const TIME = Date.UTC(2026, 8, 7, 12)
const META: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId('ledger'), createdAt: TIME, isSeeded: false }
const CONFIG: UsageStatsConfig = { pricing: { currency: 'USD', routes: { 'test/m': { input: 1, cacheRead: 0.1, cacheWrite: 2, output: 3 } } } }
const USAGE: TokenUsage = {
  inputTokens: 100, outputTokens: 20, cacheReadTokens: 200, cacheWriteTokens: 10, totalTokens: 330, reasoningTokens: 5,
}

function at(seq: number, type: string, data: unknown, intent: Record<string, unknown> = {}): SessionEvent {
  return { seq, time: TIME + seq * 1000, type, data, ...intent } as SessionEvent
}
function header(seq = 0, model = 'm', extra: Record<string, unknown> = {}) {
  return at(seq, 'request/header', { header: { config: { provider: 'test', model }, ...extra }, reason: 'initial' })
}
function start(seq = 1, step = 1) { return at(seq, 'step/start', { turn: 1, step }) }
function end(seq: number, step = 1) { return at(seq, 'step/end', { turn: 1, step }) }
function message(seq: number, usage: TokenUsage | undefined = USAGE, model = 'm', step = 1): SessionEvent {
  return at(seq, 'assistant/message', {
    turn: 1, step, stream: [], message: createAssistantMessage({ content: [], source: { provider: 'test', model } }),
    ...(usage === undefined ? {} : { usage }),
  }, { surfaceOp: 'append' })
}
function attempt(seq: number, usage?: TokenUsage): SessionEvent {
  return at(seq, 'assistant/attempt', { turn: 1, step: 1,
    stream: usage === undefined ? [] : [{ type: 'chunk', time: TIME + seq * 1000, chunk: { type: 'usage', usage } }],
  })
}
function retry(seq: number): SessionEvent {
  return at(seq, 'llm/retry', { turn: 1, step: 1, delayMs: 1000, retryId: 'retry', retry: 1 })
}
function restarted(seq: number): SessionEvent {
  return at(seq, 'llm/retry-started', { turn: 1, step: 1, retryId: 'retry', retry: 1 })
}
function run(events: readonly SessionEvent[], config: UsageStatsConfig = CONFIG, inherited = 0) {
  const definition = createUsageLedgerProjection(config)
  const state = events.reduce((previous, event) => definition.apply(previous, event),
    definition.init(META, SessionLogOffset(inherited)))
  return { definition, state, view: definition.wire.view(state) }
}

describe('usage ledger', () => {
  it('serves an empty view and keeps internal-only transitions off the change feed', () => {
    const { definition, state, view } = run([], {})
    expect(view.models).toEqual([])
    expect(view.estimatedCost).toBeUndefined()
    expect(run([], CONFIG).view.estimatedCost).toBeUndefined()
    const opened = definition.apply(definition.apply(state, start()), header())
    expect(definition.wire.view(opened)).toBe(view)
    expect(definition.wire.view(opened)).toBe(view)
    expect(definition.apply(opened, at(4, 'user/message', {}))).toBe(opened)
  })

  it('prices disjoint prompt buckets and output once; reasoning stays a subset', () => {
    const { view } = run([header(), start(), message(2), end(3)])
    expect(view.models).toMatchObject([{ requests: 1, steps: 1, reasoningTokens: 5, incompleteRequests: 0 }])
    expect(view.estimatedCost).toBeCloseTo(0.0002)
    expect(view.activity).toMatchObject({ turns: 1, steps: 1, llmMs: 1000 })
    expect(usageLedgerViewSchema.safeParse(view).success).toBe(true)
  })

  it('adds failed and successful requests without duplicating a logical step', () => {
    const { view } = run([header(), start(), attempt(2, USAGE), retry(3), restarted(4), message(5), end(6)])
    expect(view.models).toMatchObject([{ requests: 2, steps: 1, uncachedInputTokens: 200, outputTokens: 40 }])
    expect(view.estimatedCost).toBeCloseTo(0.0004)
    expect(view.activity).toMatchObject({ retries: 1, retryDelayMs: 1000, llmMs: 2000, steps: 1 })
  })

  it('attributes retry route changes without adding a second logical step', () => {
    const { view } = run([header(), start(), attempt(2, USAGE), retry(3), restarted(4), header(5, 'other'), message(6, USAGE, 'other'), end(7)])
    expect(view.models).toMatchObject([{ model: 'm', steps: 1, requests: 1 }, { model: 'other', steps: 0, requests: 1 }])
    expect(view.cacheBreaks).toMatchObject({ total: 1, routeChanged: 1 })
    expect(view.estimatedCost).toBeUndefined()
  })

  it('uses the last embedded sample when no assembled usage is available', () => {
    const sample = message(2)
    if (sample.type !== 'assistant/message') throw new Error('fixture')
    delete sample.data.usage
    sample.data.stream = [
      { type: 'chunk', time: TIME, chunk: { type: 'usage', usage: { ...USAGE, inputTokens: 1 } } },
      { type: 'chunk', time: TIME + 2000, chunk: { type: 'usage', usage: USAGE } },
    ]
    const { view } = run([header(), start(), sample, end(3)])
    expect(view.models[0]?.uncachedInputTokens).toBe(100)
    expect(view.models[0]?.requests).toBe(1)
  })

  it('counts usage-less settlements once, including canceled backoff and terminal failures', () => {
    for (const tail of [[end(4)], [restarted(4), attempt(5), end(6)], [restarted(4), end(5)]]) {
      const { view } = run([header(), start(), attempt(2), retry(3), ...tail])
      expect(view.unreportedAttempts).toBe(tail.length === 1 ? 1 : 2)
      expect(view.estimatedCost).toBeUndefined()
    }
    const emptyMessage = message(2)
    if (emptyMessage.type !== 'assistant/message') throw new Error('fixture')
    delete emptyMessage.data.usage
    expect(run([start(), emptyMessage, end(3)]).view.unreportedAttempts).toBe(1)
    expect(run([start(), end(3)]).view.unreportedAttempts).toBe(1)
    expect(run([start(), at(2, 'turn/end', { turn: 1, reason: { kind: 'interrupted' } })]).view.unreportedAttempts).toBe(1)
  })

  it('counts direct recovery retries without requiring retry-started events', () => {
    const { view } = run([header(), start(), attempt(2, USAGE), message(3), end(4)])
    expect(view.models[0]).toMatchObject({ requests: 2, steps: 1, uncachedInputTokens: 200, outputTokens: 40 })
    expect(view.estimatedCost).toBeCloseTo(0.0004)
    expect(view.activity).toMatchObject({ steps: 1, retries: 0, llmMs: 1000 })
  })

  it('counts compaction recovery and its changed-route retry as distinct requests', () => {
    const { view } = run([
      header(), start(), attempt(2, USAGE),
      at(3, 'compaction/summary', { provider: 'test', model: 'm', usage: USAGE, llmStreamCall: true }),
      header(4, 'recovered'), message(5, USAGE, 'recovered'), end(6),
    ], { pricing: { currency: 'USD', routes: {
      'test/m': { input: 1, cacheRead: 0.1, cacheWrite: 2, output: 3 },
      'test/recovered': { input: 1, cacheRead: 0.1, cacheWrite: 2, output: 3 },
    } } })
    expect(view.models).toMatchObject([
      { model: 'm', requests: 2, steps: 1 }, { model: 'recovered', requests: 1, steps: 0 },
    ])
    expect(view.estimatedCost).toBeCloseTo(0.0006)
    expect(view.cacheBreaks.routeChanged).toBe(1)
  })

  it('does not guess omitted cache buckets without exact reconciliation', () => {
    const noCaches = { inputTokens: 10, outputTokens: 5 }
    expect(run([start(), message(2, noCaches)]).view.models[0]?.incompleteRequests).toBe(1)
    expect(run([start(), message(2, noCaches)]).view.estimatedCost).toBeUndefined()
    expect(run([start(), message(2, { ...noCaches, totalTokens: 15 })]).view.estimatedCost).toBeDefined()
    expect(run([start(), message(2, { ...noCaches, totalTokens: 20 })]).view.models[0]?.incompleteRequests).toBe(1)
    expect(run([start(), message(2, { ...noCaches, cacheReadTokens: 0, cacheWriteTokens: 0 })]).view.estimatedCost).toBeDefined()
  })

  it.each([
    { ...USAGE, inputTokens: -1 }, { ...USAGE, inputTokens: 0.5 },
    { ...USAGE, reasoningTokens: 30 }, { ...USAGE, totalTokens: 1 },
    { ...USAGE, totalTokens: Infinity }, { ...USAGE, outputTokens: Number.MAX_SAFE_INTEGER },
  ])('hides complete totals for invalid or contradictory usage %#', (usage) => {
    const { view } = run([start(), message(2, usage)])
    expect(view.unreportedAttempts).toBe(1)
    expect(view.estimatedCost).toBeUndefined()
  })

  it('includes reported compaction traffic without inventing a logical agent step', () => {
    const summary = (seq: number, extra: Record<string, unknown>) => at(seq, 'compaction/summary', {
      provider: 'test', model: 'm', ...extra,
    })
    const { view } = run([summary(1, { usage: USAGE })])
    expect(view.models[0]).toMatchObject({ requests: 1, steps: 0, uncachedInputTokens: 100 })
    expect(view.estimatedCost).toBeCloseTo(0.0002)
    expect(run([summary(1, {})]).view.models).toEqual([])
    expect(run([summary(1, { llmStreamCall: true })]).view.unreportedAttempts).toBe(1)
    expect(run([summary(1, { usage: USAGE })], CONFIG, 2).view.models).toEqual([])
  })

  it('excludes inherited history from spend, steps, tools and retries but retains route context', () => {
    const inherited = [header(), start(), message(2), end(3), retry(4)]
    const { view } = run([...inherited, start(5, 2), message(6, USAGE, 'm', 2), end(7, 2)], CONFIG, 5)
    expect(view.models).toMatchObject([{ requests: 1, steps: 1, uncachedInputTokens: 100 }])
    expect(view.activity).toMatchObject({ steps: 1, turns: 1, retries: 0 })
    expect(view.estimatedCost).toBeCloseTo(0.0002)
    expect(run(inherited, CONFIG, 5).view.models).toEqual([])
  })

  it('compares effective system, tool schema and route once per observed request', () => {
    const system = (seq: number, text: string, replaced?: number) => at(seq, 'system/message', {
      turn: 1, step: 1, message: createSystemMessage(text, 'test'),
    }, replaced === undefined ? { surfaceOp: 'append' } : {
      surfaceOp: { op: 'replace', startSeq: replaced, endSeq: replaced }, sourceEventSeqs: [replaced],
    })
    const { view, state } = run([
      header(), start(), system(2, 'private instructions'), message(3), end(4),
      start(5, 2), system(6, 'different private instructions'),
      header(7, 'm', { tools: [{ name: 'new tool', description: 'private schema', parameters: {} }] }),
      message(8, USAGE, 'm', 2), end(9, 2),
      start(10, 3), system(11, '', 6), system(12, 'private instructions', 2), message(13, USAGE, 'm', 3),
    ])
    expect(view.cacheBreaks).toEqual({ total: 2, systemChanged: 2, toolsChanged: 1, routeChanged: 0 })
    expect(JSON.stringify(state)).not.toContain('private')
    expect(JSON.stringify(view)).not.toContain('schema')
  })

  it('uses per-attempt first-token/decode timing, excluding scheduled backoff', () => {
    const sample = message(4)
    if (sample.type !== 'assistant/message') throw new Error('fixture')
    sample.data.stream = [{ type: 'text-chunks', time0: TIME + 3000, index: 0, texts: ['ok'], dt: [] }]
    const { view } = run([header(), start(), sample, end(5)])
    expect(view.activity).toMatchObject({ llmMs: 3000, ttftRequests: 1, ttftMs: 2000, decodeMs: 1000, decodeTokens: 20 })
  })

  it('pairs tool errors and wall times while ignoring orphan and post-turn results', () => {
    const result = (seq: number, callId: string, error = false) => at(seq, 'tool/result', { turn: 1, step: 1,
      message: { source: { kind: 'tool', callId }, content: [{ type: 'tool-result', isError: error }] },
    })
    const { view } = run([
      result(0, 'constructor'), at(1, 'tool/call', { callId: 'constructor', name: '__proto__' }), result(3, 'constructor', true),
      result(4, 'constructor'), at(5, 'tool/call', { callId: 'pending', name: '__proto__' }),
      at(6, 'turn/end', { turn: 1, reason: { kind: 'error' } }), result(7, 'pending'),
    ])
    expect(view.tools).toEqual([{ name: '__proto__', calls: 2, results: 1, errors: 1, toolMs: 2000 }])
    expect(view.activity.turnErrors).toBe(1)
  })

  it('re-evaluates restored hour buckets under new prices and preserves state JSON', () => {
    const { state, view } = run([header(), start(), message(2)])
    const next = createUsageLedgerProjection({ pricing: { currency: 'EUR', routes: { 'test/m': { input: 2, cacheRead: 0.2, cacheWrite: 4, output: 6 } } } })
    const restored = next.stateSchema.parse(JSON.parse(JSON.stringify(state)))
    expect(next.wire.view(restored).estimatedCost).toBeCloseTo((view.estimatedCost ?? 0) * 2)
    expect(next.wire.view(restored).currency).toBe('EUR')
  })

  it('retains observed reasoning when another request omits that subdivision', () => {
    const { reasoningTokens: _reasoning, ...withoutReasoning } = USAGE
    const { view } = run([start(), message(2), end(3), start(4, 2), message(5, withoutReasoning, 'm', 2)])
    expect(view.models[0]?.reasoningTokens).toBe(5)
  })

  it('discloses unavailable routes and accepts headerless assembled attribution', () => {
    const unknown = run([attempt(1, USAGE)])
    expect(unknown.view.models[0]).toMatchObject({ provider: '', model: '', requests: 1 })
    expect(unknown.view.estimatedCost).toBeUndefined()
    expect(run([message(1)]).view.estimatedCost).toBeDefined()
    const { definition, state } = run([])
    expect(definition.apply(state, restarted(1))).toBe(state)
  })

  it('tracks first-token latency even when the attempt omits its usage report', () => {
    const sample = attempt(3)
    if (sample.type !== 'assistant/attempt') throw new Error('fixture')
    sample.data.stream = [{ type: 'text-chunks', time0: TIME + 2000, index: 0, texts: ['partial'], dt: [] }]
    expect(run([start(), sample]).view.activity).toMatchObject({ ttftRequests: 1, ttftMs: 1000, decodeTokens: 0 })
  })

  it('forgets system nodes removed by a non-system surface replacement', () => {
    const system = at(1, 'system/message', { message: createSystemMessage('prompt', 'test') }, { surfaceOp: 'append' })
    const replacement = message(4, USAGE, 'm', 2)
    if (replacement.type !== 'assistant/message') throw new Error('fixture')
    replacement.surfaceOp = { op: 'replace', startSeq: system.seq, endSeq: system.seq }
    const { view } = run([start(0), system, message(2), end(3), start(4, 2), replacement])
    expect(view.cacheBreaks.systemChanged).toBe(1)
  })

  it('ignores orphaned pending-tool cache entries and exposes configured policy without prices', () => {
    const { definition, state } = run([], { governance: { waste: { minUsageSteps: 5, minToolCalls: 5 } } })
    const restored = definition.stateSchema.parse({ ...state, pendingCalls: { orphan: { key: 'missing', time: TIME } } })
    expect(definition.apply(restored, at(1, 'tool/result', {
      message: { source: { callId: 'orphan' }, content: [{ isError: false }] },
    }))).toBe(restored)
    expect(definition.wire.view(restored).governance?.waste?.minUsageSteps).toBe(5)
  })

  it('rejects incomplete totals and costs without currency at the wire parser', () => {
    const { view } = run([start(), message(2)])
    const { currency: _currency, ...withoutCurrency } = view
    expect(usageLedgerViewSchema.safeParse(withoutCurrency).success).toBe(false)
    expect(usageLedgerViewSchema.safeParse({ ...view, unreportedAttempts: 1 }).success).toBe(false)
    expect(usageLedgerViewSchema.safeParse({ ...view, models: [{ ...view.models[0], estimatedCost: undefined }] }).success).toBe(false)
    expect(usageLedgerViewSchema.safeParse({ ...view, models: [{ ...view.models[0], incompleteRequests: 1 }] }).success).toBe(false)
  })
})

describe('usage price and governance configuration', () => {
  it('applies UTC half-open windows including weekends and keeps reasoning free of double billing', () => {
    const buckets = {
      uncachedInputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000,
      outputTokens: 1_000_000, reasoningTokens: 1_000_000,
    }
    const price = { input: 1, cacheRead: 0.1, cacheWrite: 2, output: 3,
      tiers: [{ multiplier: 0.5, windows: [{ weekdaysUtc: [0], hoursUtc: [1, 4] as [number, number] }] }],
    }
    expect(priceUsage(buckets, price, 0)).toBeCloseTo(6.1)
    expect(priceUsage(buckets, price, 1)).toBeCloseTo(3.05)
    expect(priceUsage(buckets, price, 4)).toBeCloseTo(6.1)
    expect(priceUsage(buckets, price, 25)).toBeCloseTo(6.1)
  })

  it.each([
    { pricing: { currency: 'usd', routes: {} } },
    { pricing: { currency: 'USD', routes: { m: {} } } },
    { pricing: { currency: 'USD', routes: { 'test/m': { input: -1, cacheRead: 0, cacheWrite: 0, output: 0 } } } },
    { pricing: { currency: 'USD', routes: { 'test/m': { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, tiers: [{ multiplier: 0.5, windows: [{ hoursUtc: [4, 1] }] }] } } } },
    { pricing: { currency: 'USD', routes: { 'test/m': { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, tiers: [{ multiplier: 0.5, windows: [{ hoursUtc: [0, 24] }, { hoursUtc: [0, 1] }] }] } } } },
    { governance: { budgets: { session: 10, warningRatio: 0.8 } } },
    { ...CONFIG, governance: { budgets: { warningRatio: 0.8 } } },
    { ...CONFIG, governance: { budgets: { session: -1, warningRatio: 2 } } },
    { governance: { waste: { minUsageSteps: 0, minToolCalls: 1, cacheHitRatio: 2 } } },
    { typo: true },
  ])('rejects invalid deployment input %#', (config) => {
    expect(usageConfigSchema.safeParse(config).success).toBe(false)
  })

  it('resolves exact model routes before uniquely matching tracker-style effort suffixes', () => {
    const pricing = { currency: 'USD', routes: {
      'anthropic/claude-fable-5-1': { input: 10, cacheRead: 1, cacheWrite: 12.5, output: 50 },
      'openai/gpt-5.6-sol': { input: 4, cacheRead: 0.4, cacheWrite: 5, output: 20 },
    } }
    expect(resolveRoutePrice(pricing, 'anthropic', 'claude-fable-5-1')).toBe(pricing.routes['anthropic/claude-fable-5-1'])
    expect(resolveRoutePrice(pricing, 'openai', 'gpt-5.6-sol-high')).toBe(pricing.routes['openai/gpt-5.6-sol'])
    expect(resolveRoutePrice(pricing, 'other', 'gpt-5.6-sol-high')).toBe(pricing.routes['openai/gpt-5.6-sol'])
    expect(resolveRoutePrice(pricing, 'other', 'unknown-model')).toBeUndefined()
    expect(resolveRoutePrice(undefined, 'openai', 'gpt-5.6-sol')).toBeUndefined()
  })

  it('can treat absent optional cache buckets as zero for tracker-style pricing', () => {
    const pricing: UsageStatsConfig = { pricing: { ...CONFIG.pricing!, assumeMissingCacheBucketsZero: true } }
    const { view } = run([start(), message(2, { inputTokens: 10, outputTokens: 5 })], pricing)
    expect(view.models[0]?.incompleteRequests).toBe(0)
    expect(view.estimatedCost).toBeDefined()
  })

  it('accepts explicit cumulative budgets and configurable diagnostic floors', () => {
    expect(usageConfigSchema.safeParse({ ...CONFIG, governance: {
      budgets: { session: 5, tree: 20, all: 100, warningRatio: 0.8 },
      waste: { minUsageSteps: 5, minToolCalls: 5, averageInputTokens: 50000, cacheHitRatio: 0.5,
        ttftShare: 0.6, toolErrorRatio: 0.2, retryRatio: 0.2, cacheBreakRatio: 0.5 },
    } }).success).toBe(true)
  })
})
