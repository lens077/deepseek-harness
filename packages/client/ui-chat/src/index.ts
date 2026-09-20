/** Host registration for browser Chat preferences. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { CHAT_SETTINGS_NAMESPACE, ChatSettingsSchema } from './chat-settings.ts'

export {
  ACTION_CONTROL_SIZE_FIELD, ACTION_CONTROL_SIZE_MAX, ACTION_CONTROL_SIZE_MIN,
  ACTION_CONTROL_SIZE_STEP, CHAT_SETTINGS_NAMESPACE, DEFAULT_ACTION_CONTROL_SIZE,
  DEFAULT_TRANSCRIPT_VIEW_MODE, DEFAULT_TURN_RAIL_ALIGNMENT, DEFAULT_TURN_RAIL_PLACEMENT,
  TRANSCRIPT_VIEW_FIELD, TRANSCRIPT_VIEW_MODES,
  TURN_RAIL_ALIGNMENTS, TURN_RAIL_ALIGNMENT_FIELD, TURN_RAIL_PLACEMENTS, TURN_RAIL_PLACEMENT_FIELD,
  clampActionControlSize,
  type ChatSettings, type TranscriptViewMode, type TurnRailAlignment, type TurnRailPlacement,
} from './chat-settings.ts'

/** Register the durable Chat settings section when a provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      CHAT_SETTINGS_NAMESPACE,
      ChatSettingsSchema,
    )
  })
}
