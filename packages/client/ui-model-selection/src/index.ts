/**
 * Model selection plugin, node half: registers the durable model selection
 * preferences (the quick-switch toggle and the recent-model list) when a
 * settings provider exists. The browser half ships via exports["./client"],
 * discovered through the package.json dsh.client declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { MODEL_SELECTION_SETTINGS_NAMESPACE, ModelSelectionSettingsSchema } from './model-selection-settings.ts'

export {
  DEFAULT_QUICK_SWITCH, MODEL_SELECTION_SETTINGS_NAMESPACE, QUICK_SWITCH_FIELD,
  RECENT_MODELS_FIELD, RECENT_MODELS_LIMIT, rememberRecentModel,
  type ModelSelectionSettings, type RecentModel,
} from './model-selection-settings.ts'

/**
 * Host plugin body: register the durable model selection settings section.
 * @param ctx - Host root context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      MODEL_SELECTION_SETTINGS_NAMESPACE,
      ModelSelectionSettingsSchema,
    )
  })
}
