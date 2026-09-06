/**
 * Digest plugin, node half: registers the durable `ui-digest` settings
 * section (the sidebar entry's badge preferences) when a settings provider
 * exists. Everything else ships in the browser half via exports["./client"],
 * discovered through the package.json dsh.client declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { DIGEST_SETTINGS_NAMESPACE, DigestSettingsSchema } from './nav-settings.ts'

export {
  DEFAULT_DIGEST_SETTINGS, DIGEST_SETTINGS_NAMESPACE, NAV_BADGE_STATES,
  type DigestSettings, type NavBadgeState,
} from './nav-settings.ts'

/**
 * Register the durable digest section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(DIGEST_SETTINGS_NAMESPACE, DigestSettingsSchema)
  })
}
