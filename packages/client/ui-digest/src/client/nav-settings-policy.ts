/**
 * The digest entry's badge preferences as the browser sees them: the durable
 * `ui-digest` section mirrored into one reactive view the sidebar entry reads
 * and the settings page writes through. The view exists before any settings
 * scope does, carrying the defaults, so the entry renders the same whether or
 * not this composition serves settings.
 * @module @deepseek-ai/dsh-client-ui-digest/client/nav-settings-policy
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_DIGEST_SETTINGS, normalizeBadgeOrder, type DigestSettings, type NavBadgeState,
} from '../nav-settings.ts'

/** What the sidebar entry and the settings page render. */
export interface NavSettingsView {
  /** `loading` before the first accepted section, `unavailable` when no scope serves it. */
  status: 'loading' | 'ready' | 'unavailable'
  navBadges: boolean
  navFinishedBadge: boolean
  /** Every state exactly once, in display order. */
  navBadgeOrder: readonly NavBadgeState[]
  /** Whether writes reach the Host document. */
  writable: boolean
}

const INITIAL: NavSettingsView = Object.freeze({
  status: 'unavailable',
  navBadges: DEFAULT_DIGEST_SETTINGS.navBadges,
  navFinishedBadge: DEFAULT_DIGEST_SETTINGS.navFinishedBadge,
  navBadgeOrder: Object.freeze([...DEFAULT_DIGEST_SETTINGS.navBadgeOrder]),
  writable: false,
})

/**
 * Owns the live badge-preference view and routes edits to the durable
 * scope. Constructed once in `apply`; {@link bind} attaches the scope when
 * the settings capability exists.
 */
export class NavSettingsPolicy {
  /** Reactive view read by the sidebar entry and the settings page. */
  readonly view: SnapshotStore<NavSettingsView>
  private host: SettingsScope<DigestSettings> | undefined

  constructor() {
    this.view = createSnapshotStore<NavSettingsView>(INITIAL)
  }

  /**
   * Attach the `ui-digest` settings scope; the view follows it until the
   * returned disposer runs, after which the defaults stand again.
   * @param host - the bound scope.
   * @returns the disposer that detaches the scope.
   */
  bind(host: SettingsScope<DigestSettings>): () => void {
    this.host = host
    const unsubscribe = host.subscribe(() => { this.adopt() })
    this.adopt()
    return () => {
      unsubscribe()
      this.host = undefined
      this.view.set(INITIAL)
    }
  }

  /**
   * Show or hide the state badges.
   * @param show - the desired state.
   * @returns settlement of the durable write.
   */
  setNavBadges(show: boolean): Promise<void> {
    return this.write('navBadges', show)
  }

  /**
   * Add or drop the grey finished badge.
   * @param show - the desired state.
   * @returns settlement of the durable write.
   */
  setNavFinishedBadge(show: boolean): Promise<void> {
    return this.write('navFinishedBadge', show)
  }

  /**
   * Replace the badge order.
   * @param order - the states in display order; omissions and repeats are repaired.
   * @returns settlement of the durable write.
   */
  setNavBadgeOrder(order: readonly NavBadgeState[]): Promise<void> {
    return this.write('navBadgeOrder', normalizeBadgeOrder(order))
  }

  private write(field: keyof DigestSettings, value: unknown): Promise<void> {
    if (this.host === undefined) return Promise.reject(new Error('digest settings are unavailable'))
    return this.host.set(field, value)
  }

  private adopt(): void {
    // `bind` installs the host before the first adopt and the disposer removes the subscription with it.
    const snapshot = (this.host as SettingsScope<DigestSettings>).getSnapshot()
    const section = snapshot.value
    const status = snapshot.status === 'unavailable' ? 'unavailable' : section === undefined ? 'loading' : 'ready'
    const current = this.view.getSnapshot()
    this.view.set(Object.freeze({
      status,
      navBadges: section?.navBadges ?? current.navBadges,
      navFinishedBadge: section?.navFinishedBadge ?? current.navFinishedBadge,
      navBadgeOrder: section === undefined ? current.navBadgeOrder : Object.freeze(normalizeBadgeOrder(section.navBadgeOrder)),
      writable: snapshot.writable,
    }))
  }
}
