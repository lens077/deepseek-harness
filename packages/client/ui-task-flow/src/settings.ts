/** Task-flow style preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the task-flow plugin. */
export const TASK_FLOW_SETTINGS_NAMESPACE = 'ui-task-flow'

/**
 * Visual variants accepted for both the resident strip and the canvas view:
 * `cards` draws card nodes with fan-out curves, `rail` draws one pill track with
 * branch rows, and `lanes` draws one row per route.
 */
export const FLOW_VARIANTS = ['cards', 'rail', 'lanes'] as const

/** One task-flow drawing variant. */
export type FlowVariant = typeof FLOW_VARIANTS[number]

/** Field carrying the resident strip's variant. */
export const DOCK_VARIANT_FIELD = 'dockVariant'

/** Field carrying the canvas view's variant. */
export const CANVAS_VARIANT_FIELD = 'canvasVariant'

/** The strip defaults to the compact pill rail. */
export const DEFAULT_DOCK_VARIANT: FlowVariant = 'rail'

/** The canvas defaults to the card graph. */
export const DEFAULT_CANVAS_VARIANT: FlowVariant = 'cards'

/** Task-flow text size preference, independent of conversation typography. */
export const FONT_SIZE_FIELD = 'fontSize'
/** Default task-flow text size in CSS pixels. */
export const DEFAULT_FONT_SIZE = 11
/** Smallest supported task-flow text size in CSS pixels. */
export const FONT_SIZE_MIN = 10
/** Largest supported task-flow text size in CSS pixels. */
export const FONT_SIZE_MAX = 16

/** Field controlling the optional resident strip on phones. */
export const MOBILE_DOCK_FIELD = 'mobileDock'

/** Durable task-flow section shared by the Host schema and the browser scope. */
export interface TaskFlowSettings {
  /** Variant drawn by the strip above the composer. */
  dockVariant: FlowVariant
  /** Variant drawn by the canvas view. */
  canvasVariant: FlowVariant
  /** Text size in CSS pixels for both task-flow views. */
  fontSize: number
  /** Show the resident strip on phones; the explicit Flow view stays available. */
  mobileDock: boolean
}

/** Durable task-flow schema; also the wire envelope the browser scope validates against. */
export const TaskFlowSettingsSchema: z<Partial<TaskFlowSettings>, TaskFlowSettings> = z.object({
  [DOCK_VARIANT_FIELD]: z.union([...FLOW_VARIANTS]).default(DEFAULT_DOCK_VARIANT),
  [CANVAS_VARIANT_FIELD]: z.union([...FLOW_VARIANTS]).default(DEFAULT_CANVAS_VARIANT),
  [FONT_SIZE_FIELD]: z.number().min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).step(1).default(DEFAULT_FONT_SIZE),
  [MOBILE_DOCK_FIELD]: z.boolean().default(false),
})
