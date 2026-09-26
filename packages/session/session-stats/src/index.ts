/**
 * Function plugin registering the `sessionStats` projection unit: whole-log
 * turn/step counts and LLM/tool/first-token/decode wall times served through
 * the session-projection seam (registry snapshot, change feed, and every
 * projection carrier), so clients render full-session figures that paging and
 * compaction cannot change. The plugin owns only the fold; delivery is the
 * seam's.
 *
 * @module @deepseek-ai/dsh-session-stats
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { sessionStatsProjectionDefinition } from './projection.ts'
import { createUsageLedgerProjection } from './usage-ledger.ts'
import { usageConfigSchema } from './usage-config.ts'
import type { UsageStatsConfig } from './types.ts'

export type * from './types.ts'

/** Deployment prices and read-only budget/detector settings. Invalid configuration fails plugin load. */
export type Config = UsageStatsConfig

/** Loader configuration; detailed numeric and cross-field checks run before registration. */
export const Config: z<Config> = z.object({ pricing: z.any(), governance: z.any(), calendarTimeZone: z.string() })

/** Cordis plugin name. */
export const name = 'session-stats'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Register lifecycle figures and own-request accounting as fiber-owned effects.
 * @param ctx - registrant context carrying the projection registry.
 * @param config - deployment pricing and advisory policy; invalid values fail before either registration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  usageConfigSchema.parse(config)
  ctx.sessionProjections.register(sessionStatsProjectionDefinition)
  ctx.sessionProjections.register(createUsageLedgerProjection(config))
}
