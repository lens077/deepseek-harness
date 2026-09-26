/** Companion plugin: localized sidebar contribution with no Session or model effects. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { Companion } from './Companion.tsx'
import { createCompanionStore } from './store.ts'
import { en, zh, type CompanionKey } from './locales.ts'
import awake from './assets/awake.webp'
import sleeping from './assets/sleeping.webp'

/** Usage audience requested by a companion menu item. */
export type CompanionUsageScope = 'today' | 'week' | 'month' | 'session' | 'tree' | 'all'

/** The usage provider owns accounting and the dialog; the companion owns dismissal state. */
export interface CompanionUsageOwnerProps {
  initialScope: CompanionUsageScope
  onScope: (scope: CompanionUsageScope) => void
  onClose: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Optional usage dialog supplied by the existing accounting UI. */
    'companion.usage.panel': { kind: 'single'; scope: 'session-maybe'; owner: CompanionUsageOwnerProps }
  }
  interface LocaleNamespaceMap {
    /** Quiet companion controls and status. */
    companion: CompanionKey
  }
}

/** Only the slot and locale services are required. */
export const inject = ['slots', 'locale']

/** Register one companion; all registrations and browser listeners leave with its fiber.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: Context): void {
  const store = createCompanionStore()
  const pageVisible = createSnapshotStore(!document.hidden)
  ctx.effect(() => ctx.locale.register('companion', { zh, en }), 'companion: dictionaries')
  ctx.effect(() => {
    const update = () => { pageVisible.set(!document.hidden) }
    document.addEventListener('visibilitychange', update)
    return () => { document.removeEventListener('visibilitychange', update) }
  }, 'companion: page visibility')
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'rest-companion',
    order: 100,
    locale: 'companion',
    children: { 'companion.usage.panel': { kind: 'single', scope: 'session-maybe' } },
    store,
    inject: () => ({ hooks: { pageVisible }, artwork: { awake, sleeping } }),
  }, Companion))
}
