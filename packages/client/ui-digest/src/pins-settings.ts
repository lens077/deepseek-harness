/** Durable settings for the Session pin feature. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the Session pin feature. */
export const SESSION_PINS_SETTINGS_NAMESPACE = 'session-pins'

/** Smallest accepted number of rows in the sidebar pinned area. */
export const SIDEBAR_ROWS_MIN = 1

/** Largest accepted number of rows in the sidebar pinned area. */
export const SIDEBAR_ROWS_MAX = 20

/** Durable Session pin settings shared by the Host schema and browser scope. */
export interface SessionPinsSettings {
  /** Whether Session pinning and its UI are available. */
  enabled: boolean
  /** Whether the sidebar renders a pinned area. */
  sidebarArea: boolean
  /** Number of Session rows reserved for the sidebar pinned area. */
  sidebarRows: number
  /** Whether the digest panel renders a pinned section. */
  digestSection: boolean
}

/** Defaults applied when the settings document omits fields. */
export const DEFAULT_SESSION_PINS_SETTINGS: SessionPinsSettings = {
  enabled: true,
  sidebarArea: true,
  sidebarRows: 5,
  digestSection: true,
}

/** Durable Session pin schema with integer and range validation for sidebarRows. */
export const SessionPinsSettingsSchema: z<Partial<SessionPinsSettings>, SessionPinsSettings> = z.object({
  enabled: z.boolean().default(DEFAULT_SESSION_PINS_SETTINGS.enabled),
  sidebarArea: z.boolean().default(DEFAULT_SESSION_PINS_SETTINGS.sidebarArea),
  sidebarRows: z.number().step(1).min(SIDEBAR_ROWS_MIN).max(SIDEBAR_ROWS_MAX).default(DEFAULT_SESSION_PINS_SETTINGS.sidebarRows),
  digestSection: z.boolean().default(DEFAULT_SESSION_PINS_SETTINGS.digestSection),
})
