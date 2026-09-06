/**
 * Task-flow plugin, node half: registers the durable style-preference section
 * when a settings provider exists. The browser half ships via
 * exports["./client"], discovered through the package.json dsh.client declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { TASK_FLOW_SETTINGS_NAMESPACE, TaskFlowSettingsSchema } from './settings.ts'

export {
  CANVAS_VARIANT_FIELD, DEFAULT_CANVAS_VARIANT, DEFAULT_DOCK_VARIANT, DOCK_VARIANT_FIELD,
  FLOW_VARIANTS, TASK_FLOW_SETTINGS_NAMESPACE, TaskFlowSettingsSchema,
  type FlowVariant, type TaskFlowSettings,
} from './settings.ts'

/**
 * Register the durable task-flow section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(TASK_FLOW_SETTINGS_NAMESPACE, TaskFlowSettingsSchema)
  })
}
