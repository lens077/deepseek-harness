/** File-surface preferences stored in the Host user-settings document. */

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

/** Field carrying whether the Files control and rail render at all. */
export const RAIL_VISIBILITY_FIELD = 'railVisibility'

/**
 * Visibility modes accepted at settings and seat-registration boundaries.
 *
 * `show` keeps the Files control in the view-tab row and its side rail;
 * `hide` releases both seats, leaving the conversation with the view tabs
 * (Chat, Trajectory) only. The transcript's own produced-file chips are
 * conversation content and stay either way.
 */
export const RAIL_VISIBILITIES = ['show', 'hide'] as const

/** Configurable visibility of the Files surface. */
export type RailVisibility = typeof RAIL_VISIBILITIES[number]

/** Default keeps the surface: the file panel is this package's reason to exist. */
export const DEFAULT_RAIL_VISIBILITY: RailVisibility = 'show'

/** Durable session-files section shared by the Host schema and the browser scope. */
export interface SessionFilesSettings {
  /** How much of a turn's changed files opens without being asked. */
  diffExpansion: DiffExpansion
  /** Whether the Files control and rail render at all. */
  railVisibility: RailVisibility
}

/** Durable session-files schema; also the wire envelope the browser scope validates against. */
export const SessionFilesSettingsSchema: z<SessionFilesSettings> = z.object({
  [DIFF_EXPANSION_FIELD]: z.union([...DIFF_EXPANSIONS]).default(DEFAULT_DIFF_EXPANSION),
  [RAIL_VISIBILITY_FIELD]: z.union([...RAIL_VISIBILITIES]).default(DEFAULT_RAIL_VISIBILITY),
})
