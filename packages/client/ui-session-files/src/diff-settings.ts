/** Inline-diff expansion preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the session-files plugin. */
export const SESSION_FILES_SETTINGS_NAMESPACE = 'ui-session-files'

/** Field carrying how much of a turn's changed files open without being asked. */
export const DIFF_EXPANSION_FIELD = 'diffExpansion'

/**
 * Expansion modes accepted at settings and render boundaries.
 *
 * `all` opens every changed file of a turn, `single` opens only a turn that
 * changed exactly one file, and `none` leaves every diff closed. Reads are
 * absent from this vocabulary on purpose: a read has no diff to open.
 */
export const DIFF_EXPANSIONS = ['all', 'single', 'none'] as const

/** Configurable amount of a turn's inline diffs that opens by default. */
export type DiffExpansion = typeof DIFF_EXPANSIONS[number]

/** Default shows the change: a written file's diff is what the reader came for. */
export const DEFAULT_DIFF_EXPANSION: DiffExpansion = 'all'

/** Durable session-files section shared by the Host schema and the browser scope. */
export interface SessionFilesSettings {
  /** How much of a turn's changed files opens without being asked. */
  diffExpansion: DiffExpansion
}

/** Durable session-files schema; also the wire envelope the browser scope validates against. */
export const SessionFilesSettingsSchema: z<SessionFilesSettings> = z.object({
  [DIFF_EXPANSION_FIELD]: z.union([...DIFF_EXPANSIONS]).default(DEFAULT_DIFF_EXPANSION),
})
