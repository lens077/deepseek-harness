/**
 * The digest entry's preferences, stored in the Host user-settings document:
 * whether the sidebar entry shows the state badges at all, whether a grey
 * finished badge joins them, the order the state badges take, and the chord
 * that toggles the panel. Shared by the Host schema registration and the
 * browser scope, so both validate one declaration.
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_TOGGLE_SHORTCUT, TOGGLE_SHORTCUT_PATTERN, type ToggleShortcut } from './toggle-shortcut.ts'

/** Settings namespace owned by the digest plugin. */
export const DIGEST_SETTINGS_NAMESPACE = 'ui-digest'

/**
 * The orderable badge states, in the default order: sessions waiting on a
 * question or approval, finished and unread, running, and failed.
 */
export const NAV_BADGE_STATES = ['waiting', 'unread', 'running', 'failed'] as const

/** One orderable badge state. */
export type NavBadgeState = typeof NAV_BADGE_STATES[number]

/** Durable digest section shared by the Host schema and the browser scope. */
export interface DigestSettings {
  /** Whether the sidebar entry shows the state badges. */
  navBadges: boolean
  /** Whether a grey badge counting finished, seen, unhandled sessions follows the state badges. */
  navFinishedBadge: boolean
  /** The state badges in display order; every state appears once. */
  navBadgeOrder: NavBadgeState[]
  /** Canonical chord that toggles the panel from anywhere; see `toggle-shortcut.ts`. */
  toggleShortcut: ToggleShortcut
}

/** Defaults applied to an absent or partial section. */
export const DEFAULT_DIGEST_SETTINGS: DigestSettings = {
  navBadges: true,
  navFinishedBadge: false,
  navBadgeOrder: [...NAV_BADGE_STATES],
  toggleShortcut: DEFAULT_TOGGLE_SHORTCUT,
}

/** Durable digest schema; also the wire envelope the browser scope validates against. */
export const DigestSettingsSchema: z<DigestSettings> = z.object({
  navBadges: z.boolean().default(DEFAULT_DIGEST_SETTINGS.navBadges),
  navFinishedBadge: z.boolean().default(DEFAULT_DIGEST_SETTINGS.navFinishedBadge),
  navBadgeOrder: z.array(z.union([...NAV_BADGE_STATES])).default([...NAV_BADGE_STATES]),
  toggleShortcut: z.string().pattern(TOGGLE_SHORTCUT_PATTERN).default(DEFAULT_TOGGLE_SHORTCUT),
})

/**
 * Repair a stored order into a permutation of every state: duplicates keep
 * their first position and states the document omits trail in default order,
 * so an edit from an older or hand-written document never hides a badge.
 * @param order - the stored order.
 * @returns every state exactly once.
 */
export function normalizeBadgeOrder(order: readonly NavBadgeState[]): NavBadgeState[] {
  const seen = new Set<NavBadgeState>()
  const result: NavBadgeState[] = []
  for (const state of [...order, ...NAV_BADGE_STATES]) {
    if (seen.has(state)) continue
    seen.add(state)
    result.push(state)
  }
  return result
}
