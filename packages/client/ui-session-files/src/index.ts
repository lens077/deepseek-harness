/**
 * Session file rail, node half. It registers the durable section holding the
 * file-surface preferences (inline-diff expansion, Files visibility) and
 * nothing else: every fact the rail and the inline diff show is already in
 * the session log, so this package adds no host behavior, no prompt section,
 * and no tool. The browser half ships via exports["./client"], discovered
 * through the package.json dsh.client declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { SESSION_FILES_SETTINGS_NAMESPACE, SessionFilesSettingsSchema } from './diff-settings.ts'

export {
  DEFAULT_DIFF_EXPANSION, DEFAULT_RAIL_VISIBILITY, DIFF_EXPANSION_FIELD, DIFF_EXPANSIONS,
  RAIL_VISIBILITIES, RAIL_VISIBILITY_FIELD, SESSION_FILES_SETTINGS_NAMESPACE,
  type DiffExpansion, type RailVisibility, type SessionFilesSettings,
} from './diff-settings.ts'

/**
 * Register the durable session-files section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(SESSION_FILES_SETTINGS_NAMESPACE),
      SessionFilesSettingsSchema,
    )
  })
}
