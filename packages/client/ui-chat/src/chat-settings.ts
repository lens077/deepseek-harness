/** Chat transcript preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the Chat target. */
export const CHAT_SETTINGS_NAMESPACE = 'ui-chat'

/** Field carrying the completed-Turn transcript presentation mode. */
export const TRANSCRIPT_VIEW_FIELD = 'transcriptView'

/** Transcript presentation modes accepted at settings boundaries. */
export const TRANSCRIPT_VIEW_MODES = ['normal', 'compact'] as const

/** Completed-Turn transcript presentation. */
export type TranscriptViewMode = typeof TRANSCRIPT_VIEW_MODES[number]

/** Default preserves the compact process disclosure introduced by Chat. */
export const DEFAULT_TRANSCRIPT_VIEW_MODE: TranscriptViewMode = 'compact'

/** Field carrying the edge length of the transcript's right-hand action controls. */
export const ACTION_CONTROL_SIZE_FIELD = 'actionControlSize'

/** Smallest accepted control edge in CSS pixels; smaller icons stop being reliable pointer targets. */
export const ACTION_CONTROL_SIZE_MIN = 26

/** Largest accepted control edge in CSS pixels; larger controls eat the transcript's reading width. */
export const ACTION_CONTROL_SIZE_MAX = 58

/** Edge-length increment one zoom step applies. */
export const ACTION_CONTROL_SIZE_STEP = 4

/** Default edge length: the size the column carried before it became adjustable. */
export const DEFAULT_ACTION_CONTROL_SIZE = 34

/** Field carrying where the turn rail stands relative to the action controls. */
export const TURN_RAIL_PLACEMENT_FIELD = 'turnRailPlacement'

/**
 * Turn-rail placements. `stacked` shares the action controls' column and ends
 * just above them, so the newest Turn sits beside the controls the reader is
 * using; `column` gives the rail its own column, which fits more Turns at the
 * cost of transcript width.
 */
export const TURN_RAIL_PLACEMENTS = ['stacked', 'column'] as const

/** Where the turn rail stands relative to the action controls. */
export type TurnRailPlacement = typeof TURN_RAIL_PLACEMENTS[number]

/** Default keeps the rail in one column with the controls: most sessions hold few Turns. */
export const DEFAULT_TURN_RAIL_PLACEMENT: TurnRailPlacement = 'stacked'

/** Field carrying the rail's vertical alignment in its own column. */
export const TURN_RAIL_ALIGNMENT_FIELD = 'turnRailAlignment'

/** Vertical alignments available to a rail in its own column. */
export const TURN_RAIL_ALIGNMENTS = ['top', 'center', 'bottom'] as const

/** Vertical alignment of a rail in its own column; ignored while the rail is stacked. */
export type TurnRailAlignment = typeof TURN_RAIL_ALIGNMENTS[number]

/** Default for the column placement: the ladder starts where its oldest Turn is. */
export const DEFAULT_TURN_RAIL_ALIGNMENT: TurnRailAlignment = 'top'

/** One adjustable pixel preference: its accepted range, zoom step, and default. */
export interface PixelRange {
  /** Smallest accepted value in CSS pixels. */
  readonly min: number
  /** Largest accepted value in CSS pixels. */
  readonly max: number
  /** Increment one zoom step applies. */
  readonly step: number
  /** Value the preference carries until the reader moves it. */
  readonly fallback: number
}

/** Edge length of the transcript's right-hand action controls. */
export const ACTION_CONTROL_SIZE_RANGE: PixelRange = {
  min: ACTION_CONTROL_SIZE_MIN,
  max: ACTION_CONTROL_SIZE_MAX,
  step: ACTION_CONTROL_SIZE_STEP,
  fallback: DEFAULT_ACTION_CONTROL_SIZE,
}

/** Field carrying the transcript's leading-side gutter. */
export const TRANSCRIPT_LEADING_PAD_FIELD = 'transcriptLeadingPad'

/** Default leading gutter: the transcript starts close to its pane's edge. */
export const DEFAULT_TRANSCRIPT_LEADING_PAD = 5

/**
 * Leading gutter of the transcript. Nothing floats on that side, so the range
 * reaches zero; the 5px step keeps whole multiples of five reachable from the
 * default in one press each.
 */
export const TRANSCRIPT_LEADING_PAD_RANGE: PixelRange = {
  min: 0,
  max: 60,
  step: 5,
  fallback: DEFAULT_TRANSCRIPT_LEADING_PAD,
}

/**
 * Snap an arbitrary value onto one range and its zoom step. The grid is
 * anchored on the range's default rather than on zero, so the value a
 * preference shipped with and every step away from it stay reachable. The
 * schema rejects an out-of-range durable value; this keeps zoom arithmetic on
 * one accepted answer at the ends.
 * @param range - accepted range, step, and default.
 * @param value - requested value in CSS pixels.
 * @returns the nearest accepted value.
 */
export function clampPixelPreference(range: PixelRange, value: number): number {
  const steps = Math.round((value - range.fallback) / range.step)
  const snapped = range.fallback + steps * range.step
  return Math.min(range.max, Math.max(range.min, snapped))
}

/**
 * Snap an arbitrary control edge length onto its accepted range.
 * @param size - requested edge length in CSS pixels.
 * @returns the nearest accepted edge length.
 */
export function clampActionControlSize(size: number): number {
  return clampPixelPreference(ACTION_CONTROL_SIZE_RANGE, size)
}

/** Durable Chat section shared by the Host schema and browser scope. */
export interface ChatSettings {
  /** Presentation mode for completed Turn process content. */
  transcriptView: TranscriptViewMode
  /** Edge length in CSS pixels of the transcript's right-hand action controls. */
  actionControlSize: number
  /** Where the turn rail stands relative to those controls. */
  turnRailPlacement: TurnRailPlacement
  /** The rail's vertical alignment while it has its own column. */
  turnRailAlignment: TurnRailAlignment
  /** Leading-side gutter of the transcript in CSS pixels. */
  transcriptLeadingPad: number
}

/** Durable Chat schema; also the wire envelope the browser scope validates against. */
export const ChatSettingsSchema: z<ChatSettings> = z.object({
  [TRANSCRIPT_VIEW_FIELD]: z.union([...TRANSCRIPT_VIEW_MODES]).default(DEFAULT_TRANSCRIPT_VIEW_MODE),
  [ACTION_CONTROL_SIZE_FIELD]: z.number().step(1)
    .min(ACTION_CONTROL_SIZE_MIN)
    .max(ACTION_CONTROL_SIZE_MAX)
    .default(DEFAULT_ACTION_CONTROL_SIZE),
  [TURN_RAIL_PLACEMENT_FIELD]: z.union([...TURN_RAIL_PLACEMENTS]).default(DEFAULT_TURN_RAIL_PLACEMENT),
  [TURN_RAIL_ALIGNMENT_FIELD]: z.union([...TURN_RAIL_ALIGNMENTS]).default(DEFAULT_TURN_RAIL_ALIGNMENT),
  [TRANSCRIPT_LEADING_PAD_FIELD]: z.number().step(1)
    .min(TRANSCRIPT_LEADING_PAD_RANGE.min)
    .max(TRANSCRIPT_LEADING_PAD_RANGE.max)
    .default(DEFAULT_TRANSCRIPT_LEADING_PAD),
})
