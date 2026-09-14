/** Validation and recurring price evaluation for deployment-owned usage diagnostics. */

import { z } from 'zod'
import type { UsageBuckets, UsageRoutePrice, UsageStatsConfig } from './types.ts'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const rate = z.number().nonnegative()
const ratio = z.number().min(0).max(1)
const windowSchema = z.object({
  weekdaysUtc: z.array(z.number().int().min(0).max(6)).min(1).optional(),
  hoursUtc: z.tuple([z.number().int().min(0).max(23), z.number().int().min(1).max(24)])
    .refine(([start, end]) => start < end, 'UTC window must have start < end'),
}).strict()

const routePriceSchema = z.object({
  input: rate,
  cacheRead: rate,
  cacheWrite: rate,
  output: rate,
  tiers: z.array(z.object({
    multiplier: rate,
    windows: z.array(windowSchema).min(1),
  }).strict()).optional(),
}).strict().superRefine((price, ctx) => {
  const occupied = new Set<number>()
  for (const tier of price.tiers ?? []) {
    for (const window of tier.windows) {
      for (const day of window.weekdaysUtc ?? [0, 1, 2, 3, 4, 5, 6]) {
        for (let hour = window.hoursUtc[0]; hour < window.hoursUtc[1]; hour++) {
          const key = day * 24 + hour
          if (occupied.has(key)) ctx.addIssue({ code: 'custom', message: 'Pricing windows must not overlap' })
          occupied.add(key)
        }
      }
    }
  }
})

/** Validated advisory policy also carried on the wire for scope evaluation. */
export const usageGovernanceSchema = z.object({
  budgets: z.object({
    session: z.number().positive().optional(),
    tree: z.number().positive().optional(),
    all: z.number().positive().optional(),
    warningRatio: z.number().positive().max(1),
  }).strict().refine(value => value.session !== undefined || value.tree !== undefined || value.all !== undefined,
    'At least one budget scope is required').optional(),
  waste: z.object({
    minUsageSteps: count.positive(),
    minToolCalls: count.positive(),
    averageInputTokens: z.number().positive().optional(),
    cacheHitRatio: ratio.optional(),
    ttftShare: ratio.optional(),
    toolErrorRatio: ratio.optional(),
    retryRatio: rate.optional(),
    cacheBreakRatio: rate.optional(),
  }).strict().optional(),
}).strict()

/** Strict load-time validation; unknown routes never acquire inferred prices. */
export const usageConfigSchema = z.object({
  pricing: z.object({
    currency: z.string().regex(/^[A-Z]{3}$/, 'Currency must be an uppercase ISO 4217 code'),
    routes: z.record(z.string().regex(/^[^/]+\/.+$/, 'Price key must be provider/model'), routePriceSchema),
    assumeMissingCacheBucketsZero: z.boolean().optional(),
  }).strict().optional(),
  governance: usageGovernanceSchema.optional(),
}).strict().refine(value => value.governance?.budgets === undefined || value.pricing !== undefined,
  'Budgets require a pricing table and currency')

/**
 * Evaluate a route price for a recorded UTC hour of the week.
 * @param buckets - disjoint prompt buckets and inclusive output count.
 * @param price - the route's configured per-million prices.
 * @param hourOfWeek - Sunday 00:00 is 0; Saturday 23:00 is 167.
 * @returns estimated cost in the configured currency, without separately pricing reasoning.
 */
export function priceUsage(buckets: UsageBuckets, price: UsageRoutePrice, hourOfWeek: number): number {
  const day = Math.floor(hourOfWeek / 24)
  const hour = hourOfWeek % 24
  const multiplier = price.tiers?.find(tier => tier.windows.some(window =>
    (window.weekdaysUtc === undefined || window.weekdaysUtc.includes(day))
    && hour >= window.hoursUtc[0] && hour < window.hoursUtc[1]))?.multiplier ?? 1
  return (buckets.uncachedInputTokens * price.input
    + buckets.cacheReadTokens * price.cacheRead
    + buckets.cacheWriteTokens * price.cacheWrite
    + buckets.outputTokens * price.output) / 1_000_000 * multiplier
}

function normalizeModel(model: string): string {
  return model.trim().toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '')
}

function modelCandidates(model: string): string[] {
  const current = normalizeModel(model)
  const candidates = [current]
  let candidate = current
  for (const suffix of ['-xhigh-fast', '-high-fast', '-medium-fast', '-low-fast', '-xhigh', '-high', '-medium', '-low', '-fast', '-thinking', '-reasoning']) {
    if (candidate.endsWith(suffix)) {
      candidate = candidate.slice(0, -suffix.length)
      candidates.push(candidate)
      break
    }
  }
  return candidates
}

/**
 * Resolve a configured route using exact identity first and a unique model
 * suffix alias second. The stored provider/model identity is never changed.
 * @param pricing - configured route table.
 * @param provider - recorded provider name.
 * @param model - recorded model id.
 * @returns a price when exact or uniquely aliased, otherwise undefined.
 */
export function resolveRoutePrice(
  pricing: UsageStatsConfig['pricing'], provider: string, model: string,
): UsageRoutePrice | undefined {
  if (pricing === undefined) return undefined
  const exactKey = `${provider}/${model}`
  const exact = pricing.routes[exactKey]
  if (exact !== undefined) return exact
  const candidates = modelCandidates(model)
  const matches = Object.entries(pricing.routes).filter(([key]) => {
    const routeModel = key.slice(key.lastIndexOf('/') + 1)
    return candidates.includes(normalizeModel(routeModel))
  })
  return matches.length === 1 ? matches[0]?.[1] : undefined
}
