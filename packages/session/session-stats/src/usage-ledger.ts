/** Own-session request accounting, pricing inputs, and content-free operational diagnostics. */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { assistantStreamFirstTokenTime, lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type {} from '@deepseek-ai/dsh-compaction/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { priceUsage, resolveRoutePrice, usageGovernanceSchema } from './usage-config.ts'
import type { UsageActivity, UsageBuckets, UsageLedgerProjection, UsageStatsConfig } from './types.ts'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const duration = z.number().nonnegative()
const bucketsSchema = z.object({
  uncachedInputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
  outputTokens: count,
  reasoningTokens: count.optional(),
}).strict()
const rowSchema = bucketsSchema.extend({
  provider: z.string(), model: z.string(), steps: count, requests: count, incompleteRequests: count,
  estimatedCost: duration.optional(),
})
const toolSchema = z.object({ name: z.string(), calls: count, results: count, errors: count, toolMs: duration }).strict()
const activitySchema = z.object({
  turns: count, steps: count, turnMs: duration, llmMs: duration,
  ttftMs: duration, ttftRequests: count, decodeMs: duration, decodeTokens: count,
  retries: count, retryDelayMs: duration, turnErrors: count, interruptions: count,
}).strict()
const cacheSchema = z.object({ total: count, systemChanged: count, toolsChanged: count, routeChanged: count }).strict()

/** Wire completeness prevents unknown traffic or unpriced rows masquerading as a complete total. */
export const usageLedgerViewSchema = z.object({
  models: z.array(rowSchema), tools: z.array(toolSchema), activity: activitySchema,
  cacheBreaks: cacheSchema, unreportedAttempts: count,
  currency: z.string().regex(/^[A-Z]{3}$/).optional(), estimatedCost: duration.optional(),
  governance: usageGovernanceSchema.optional(),
}).strict().superRefine((view, ctx) => {
  const costs = view.models.some(row => row.estimatedCost !== undefined) || view.estimatedCost !== undefined
  if (costs && view.currency === undefined) ctx.addIssue({ code: 'custom', message: 'Cost requires currency' })
  if (view.models.some(row => row.incompleteRequests > 0 && row.estimatedCost !== undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Incomplete route usage cannot carry cost' })
  }
  if (view.estimatedCost !== undefined && (view.unreportedAttempts > 0
    || view.models.some(row => row.estimatedCost === undefined || row.incompleteRequests > 0))) {
    ctx.addIssue({ code: 'custom', message: 'Total requires complete priced usage from every observed attempt' })
  }
})

const prefixSchema = z.object({ system: z.string(), tools: z.string(), route: z.string() }).strict()
const dataSchema = z.object({
  models: z.record(z.string(), rowSchema.omit({ estimatedCost: true }).extend({
    hours: z.record(z.string(), bucketsSchema),
  })),
  tools: z.record(z.string(), toolSchema),
  activity: activitySchema, cacheBreaks: cacheSchema, unreportedAttempts: count,
}).strict()
const stateSchema = z.object({
  inheritedEventCount: count,
  data: dataSchema,
  route: z.object({ provider: z.string(), model: z.string(), tools: z.string() }).strict().nullable(),
  systems: z.array(z.object({ seq: count, hash: z.string().nullable() }).strict()),
  prefix: prefixSchema.nullable(),
  step: z.object({
    turn: count, step: count, attemptStart: duration, settled: z.boolean(), countedUsage: z.boolean(),
  }).strict().nullable(),
  turnStart: z.object({ turn: count, time: duration }).strict().nullable(),
  lastCountedTurn: count.nullable(),
  pendingCalls: z.record(z.string(), z.object({ key: z.string(), time: duration }).strict()),
}).strict()
type LedgerState = z.infer<typeof stateSchema>
type UsageLedgerDefinition = ProjectionDefinition<'usageLedger'> & {
  wire: NonNullable<ProjectionDefinition<'usageLedger'>['wire']>
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    usageLedger: LedgerState
  }
}

const emptyBuckets = (): UsageBuckets => ({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })
const emptyActivity = (): UsageActivity => ({
  turns: 0, steps: 0, turnMs: 0, llmMs: 0, ttftMs: 0, ttftRequests: 0,
  decodeMs: 0, decodeTokens: 0, retries: 0, retryDelayMs: 0, turnErrors: 0, interruptions: 0,
})
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const routeKey = (provider: string, model: string): string => JSON.stringify([provider, model])
const isCount = (value: number): boolean => Number.isSafeInteger(value) && value >= 0

function addBuckets(left: UsageBuckets, right: UsageBuckets): UsageBuckets {
  return {
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    ...(left.reasoningTokens === undefined && right.reasoningTokens === undefined ? {} : {
      reasoningTokens: (left.reasoningTokens ?? 0) + (right.reasoningTokens ?? 0),
    }),
  }
}

function normalizeUsage(
  usage: TokenUsage | undefined,
  assumeMissingCacheBucketsZero = false,
): { buckets: UsageBuckets; complete: boolean } | null {
  if (usage === undefined) return null
  const buckets: UsageBuckets = {
    uncachedInputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0, cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
  }
  if (!Object.values(buckets).every(isCount) || (usage.reasoningTokens ?? 0) > usage.outputTokens) return null
  const knownTotal = buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens
  if (!isCount(knownTotal)) return null
  if (usage.totalTokens !== undefined && (!isCount(usage.totalTokens) || usage.totalTokens < knownTotal)) return null
  // An exact total can prove that omitted cache buckets are zero; absence alone cannot.
  const complete = usage.totalTokens === undefined
    ? assumeMissingCacheBucketsZero || usage.cacheReadTokens !== undefined && usage.cacheWriteTokens !== undefined
    : usage.totalTokens === knownTotal
  return { buckets, complete }
}

function updateSystems(state: LedgerState, event: SessionEvent): LedgerState['systems'] {
  if (event.surfaceOp === undefined) return state.systems
  const sources = event.surfaceOp === 'append' ? null
    : new Set<number>(event.sourceEventSeqs ?? [event.surfaceOp.startSeq, event.surfaceOp.endSeq])
  const index = sources === null ? -1 : state.systems.findIndex(node => sources.has(node.seq))
  const nodes = sources === null ? state.systems : state.systems.filter(node => !sources.has(node.seq))
  if (event.type !== 'system/message') return nodes.length === state.systems.length ? state.systems : nodes
  const content = event.data.message.content
  const active = content.some(block => block.type !== 'text' || block.text.length > 0)
  const node = { seq: event.seq, hash: active ? hash(content) : null }
  const insertion = index < 0 ? nodes.length : index
  return [...nodes.slice(0, insertion), node, ...nodes.slice(insertion)]
}

function recordUsage(
  data: LedgerState['data'],
  sample: ReturnType<typeof normalizeUsage>,
  provider: string,
  model: string,
  time: number,
  countStep: boolean,
): LedgerState['data'] {
  if (sample === null) return { ...data, unreportedAttempts: data.unreportedAttempts + 1 }
  const key = routeKey(provider, model)
  const prior = data.models[key]
  const date = new Date(time)
  const hour = String(date.getUTCDay() * 24 + date.getUTCHours())
  const hours = prior?.hours ?? {}
  return { ...data, models: { ...data.models, [key]: {
    provider, model,
    ...addBuckets(prior ?? emptyBuckets(), sample.buckets),
    steps: (prior?.steps ?? 0) + Number(countStep),
    requests: (prior?.requests ?? 0) + 1,
    incompleteRequests: (prior?.incompleteRequests ?? 0) + Number(!sample.complete),
    hours: { ...hours, [hour]: addBuckets(hours[hour] ?? emptyBuckets(), sample.buckets) },
  } } }
}

function settle(
  state: LedgerState,
  event: SessionEvent<'assistant/message' | 'assistant/attempt'>,
  assumeMissingCacheBucketsZero: boolean,
): LedgerState {
  const { turn, step } = event.data
  const matching = state.step?.turn === turn && state.step.step === step ? state.step : null
  const provider = event.type === 'assistant/message' ? event.data.message.source.provider : state.route?.provider ?? ''
  const model = event.type === 'assistant/message' ? event.data.message.source.model : state.route?.model ?? ''
  const key = routeKey(provider, model)
  const prefix = { system: state.systems.findLast(node => node.hash !== null)?.hash ?? '', tools: state.route?.tools ?? hash([]), route: key }
  if (event.seq < state.inheritedEventCount) return { ...state, prefix }
  let data = state.data
  if (state.prefix !== null) {
    const systemChanged = Number(prefix.system !== state.prefix.system)
    const toolsChanged = Number(prefix.tools !== state.prefix.tools)
    const routeChanged = Number(prefix.route !== state.prefix.route)
    data = { ...data, cacheBreaks: {
      total: data.cacheBreaks.total + Number(systemChanged + toolsChanged + routeChanged > 0),
      systemChanged: data.cacheBreaks.systemChanged + systemChanged,
      toolsChanged: data.cacheBreaks.toolsChanged + toolsChanged,
      routeChanged: data.cacheBreaks.routeChanged + routeChanged,
    } }
  }
  const usage = event.type === 'assistant/message'
    ? event.data.usage ?? lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
    : lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
  const normalized = normalizeUsage(usage, assumeMissingCacheBucketsZero)
  data = recordUsage(data, normalized, provider, model, event.time, matching?.countedUsage !== true)
  // Direct recovery retries have no recorded start; do not reuse a prior attempt's timing interval.
  if (matching !== null && !matching.settled) {
    const activity = { ...data.activity, llmMs: data.activity.llmMs + Math.max(0, event.time - matching.attemptStart) }
    const first = assistantStreamFirstTokenTime(event.data.stream)
    if (first !== undefined && first >= matching.attemptStart && first <= event.time) {
      activity.ttftMs += first - matching.attemptStart
      activity.ttftRequests += 1
      if (normalized !== null) {
        activity.decodeMs += event.time - first
        activity.decodeTokens += normalized.buckets.outputTokens
      }
    }
    data = { ...data, activity }
  }
  return { ...state, data, prefix, step: matching === null ? null : {
    ...matching, settled: true, countedUsage: matching.countedUsage || normalized !== null,
  } }
}

/**
 * Create the own-session ledger projection using deployment-configured prices.
 * @param config - validated prices and advisory thresholds; omitted configuration means no inference.
 * @returns a synchronous replayable projection; inherited events supply prefix context but no spend.
 */
export function createUsageLedgerProjection(config: UsageStatsConfig = {}): UsageLedgerDefinition {
  const views = new WeakMap<LedgerState['data'], UsageLedgerProjection>()
  return {
    key: 'usageLedger', stateVersion: 2, stateSchema,
    init: (_header, inheritedEventCount) => ({
      inheritedEventCount,
      data: { models: {}, tools: {}, activity: emptyActivity(),
        cacheBreaks: { total: 0, systemChanged: 0, toolsChanged: 0, routeChanged: 0 }, unreportedAttempts: 0 },
      route: null, systems: [], prefix: null, step: null, turnStart: null, lastCountedTurn: null, pendingCalls: {},
    }),
    apply: (state, event) => {
      const systems = updateSystems(state, event)
      if (systems !== state.systems) state = { ...state, systems }
      if (event.type === 'request/header') {
        const { config: route, tools } = event.data.header
        return { ...state, route: { provider: route.provider, model: route.model, tools: hash(tools ?? []) } }
      }
      if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
        return settle(state, event, config.pricing?.assumeMissingCacheBucketsZero === true)
      }
      if (event.seq < state.inheritedEventCount) return state
      const data = state.data
      switch (event.type) {
        case 'compaction/summary':
          return event.data.usage === undefined && event.data.llmStreamCall !== true ? state : { ...state,
            data: recordUsage(data, normalizeUsage(event.data.usage,
              config.pricing?.assumeMissingCacheBucketsZero === true), event.data.provider, event.data.model, event.time, false),
          }
        case 'turn/start':
          return { ...state, turnStart: { turn: event.data.turn, time: event.time } }
        case 'step/start':
          return { ...state, step: { ...event.data, attemptStart: event.time, settled: false, countedUsage: false } }
        case 'llm/retry':
          return { ...state, data: { ...data, activity: { ...data.activity,
            retries: data.activity.retries + 1, retryDelayMs: data.activity.retryDelayMs + event.data.delayMs } } }
        case 'llm/retry-started':
          return state.step === null ? state : { ...state, step: { ...state.step, attemptStart: event.time, settled: false } }
        case 'step/end':
          return { ...state, step: null, lastCountedTurn: event.data.turn, data: { ...data,
            unreportedAttempts: data.unreportedAttempts + Number(state.step?.settled === false),
            activity: { ...data.activity, steps: data.activity.steps + 1,
              turns: data.activity.turns + Number(state.lastCountedTurn !== event.data.turn) },
          } }
        case 'turn/end':
          return { ...state, turnStart: null, step: null, pendingCalls: {}, data: { ...data,
            unreportedAttempts: data.unreportedAttempts + Number(state.step?.settled === false),
            activity: { ...data.activity,
              turnMs: data.activity.turnMs
                + (state.turnStart?.turn === event.data.turn ? Math.max(0, event.time - state.turnStart.time) : 0),
              turnErrors: data.activity.turnErrors + Number(event.data.reason.kind === 'error'),
              interruptions: data.activity.interruptions + Number(event.data.reason.kind === 'aborted' || event.data.reason.kind === 'interrupted'),
            },
          } }
        case 'tool/call': {
          const key = JSON.stringify(event.data.name)
          const prior = data.tools[key] ?? { name: event.data.name, calls: 0, results: 0, errors: 0, toolMs: 0 }
          return { ...state,
            pendingCalls: { ...state.pendingCalls, [event.data.callId]: { key, time: event.time } },
            data: { ...data, tools: { ...data.tools, [key]: { ...prior, calls: prior.calls + 1 } } },
          }
        }
        case 'tool/result': {
          const callId = event.data.message.source.callId
          const pending = Object.hasOwn(state.pendingCalls, callId) ? state.pendingCalls[callId] : undefined
          if (pending === undefined) return state
          const prior = data.tools[pending.key]
          if (prior === undefined) return state
          return { ...state,
            pendingCalls: Object.fromEntries(Object.entries(state.pendingCalls).filter(([id]) => id !== callId)),
            data: { ...data, tools: { ...data.tools, [pending.key]: { ...prior,
              results: prior.results + 1, errors: prior.errors + Number(event.data.message.content[0].isError === true),
              toolMs: prior.toolMs + Math.max(0, event.time - pending.time),
            } } },
          }
        }
        default:
          // Other plugins' events do not contribute accounting or operational figures.
          return state
      }
    },
    wire: {
      viewSchema: usageLedgerViewSchema as z.ZodType<UsageLedgerProjection>,
      view: (state) => {
        const cached = views.get(state.data)
        if (cached !== undefined) return cached
        const { data } = state
        const models = Object.values(data.models).map(({ hours, reasoningTokens, ...row }) => {
          const price = resolveRoutePrice(config.pricing, row.provider, row.model)
          return { ...row,
            ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
            ...(price === undefined || row.incompleteRequests > 0 ? {} : {
              estimatedCost: Object.entries(hours).reduce((sum, [hour, buckets]) => sum + priceUsage(buckets, price, Number(hour)), 0),
            }),
          }
        })
        const total = models.reduce<number | undefined>((sum, row) =>
          sum === undefined || row.estimatedCost === undefined ? undefined : sum + row.estimatedCost, 0)
        const estimatedCost = config.pricing === undefined || data.unreportedAttempts > 0
          || Object.keys(data.models).length === 0 ? undefined : total
        const view: UsageLedgerProjection = {
          models, tools: Object.values(data.tools), activity: data.activity, cacheBreaks: data.cacheBreaks,
          unreportedAttempts: data.unreportedAttempts,
          ...(config.pricing === undefined ? {} : { currency: config.pricing.currency }),
          ...(estimatedCost === undefined ? {} : { estimatedCost }),
          ...(config.governance === undefined ? {} : { governance: config.governance }),
        }
        views.set(data, view)
        return view
      },
    },
  } satisfies ProjectionDefinition<'usageLedger'>
}
