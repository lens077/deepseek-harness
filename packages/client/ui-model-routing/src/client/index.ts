/**
 * Model-routing switch plugin, browser half: one controller over the
 * `model-routing` settings namespace that any mounted `dsh-model-router`
 * provider serves, rendered twice — as a row after the provider rows on the
 * Models settings page and as a chip in the composer tool row beside the
 * model seat. Both write `enabled` on toggle; both render nothing while the
 * namespace is not served, which means no router is mounted.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (the composer tool row).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the Models page's SlotMap merge (the 'settings.models.footer' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ModelRoutingChip } from './ModelRoutingChip.tsx'
import { ModelRoutingRow } from './ModelRoutingRow.tsx'
import { MODEL_ROUTING_NS, ModelRoutingController } from './controller.ts'
import { en, zh, type ModelRoutingLocaleKey } from './locales.ts'

export type { ModelRoutingFace, ModelRoutingSettings, ModelRoutingState } from './controller.ts'
export type { ModelRoutingChipProps } from './ModelRoutingChip.tsx'
export type { ModelRoutingRowProps } from './ModelRoutingRow.tsx'
export type { ModelRoutingLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The model-routing switch's copy. */
    modelRouting: ModelRoutingLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'modelRouting'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Mount the switch on both surfaces.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-model-routing: dictionaries')
  const controller = new ModelRoutingController(ctx.settingsScope.bind({ namespace: MODEL_ROUTING_NS }))

  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer',
    id: MODEL_ROUTING_NS,
    order: 0,
    locale: NS,
    inject: () => controller.inject(),
  }, ModelRoutingRow))

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: MODEL_ROUTING_NS,
    // Where the agent-preset label used to sit: routing state leads the trailing composer controls.
    order: -10,
    locale: NS,
    inject: () => controller.inject(),
  }, ModelRoutingChip))
}
