/** Durable settings for the Session pin feature. */

import z from '@deepseek-ai/schemastery'
import type { SessionAutoPinStatus, SessionPinsSidebarRows } from '@deepseek-ai/dsh-client-ui-workspace/client'

/** Settings namespace owned by the Session pin feature. */
export const SESSION_PINS_SETTINGS_NAMESPACE = 'session-pins'

/** Smallest accepted number of rows in the sidebar pinned area. */
export const SIDEBAR_ROWS_MIN = 1

/** Largest accepted number of rows in the sidebar pinned area. */
export const SIDEBAR_ROWS_MAX = 20

/** Every Session status the sidebar pinned area can list automatically, in menu order. */
export const AUTO_PIN_STATUSES = ['running', 'completed', 'failed'] as const satisfies readonly SessionAutoPinStatus[]

/** Durable Session pin settings shared by the Host schema and browser scope. */
export interface SessionPinsSettings {
  /** Whether Session pinning and its UI are available. */
  enabled: boolean
  /** Whether the sidebar renders a pinned area. */
  sidebarArea: boolean
  /** Session rows reserved for the sidebar pinned area, or `auto` to size it to its rows. */
  sidebarRows: SessionPinsSidebarRows
  /** Session statuses the sidebar pinned area lists beside the pin marks. */
  autoPinStatuses: SessionAutoPinStatus[]
  /** Whether the digest panel renders a pinned section. */
  digestSection: boolean
}

/** Defaults applied when the settings document omits fields. */
export const DEFAULT_SESSION_PINS_SETTINGS: SessionPinsSettings = {
  enabled: true,
  sidebarArea: true,
  sidebarRows: 5,
  autoPinStatuses: ['running', 'completed'],
  digestSection: true,
}

/** Durable Session pin schema: `sidebarRows` is `auto` or an integer in range; `autoPinStatuses` holds known statuses only. */
export const SessionPinsSettingsSchema: z<Partial<SessionPinsSettings>, SessionPinsSettings> = z.object({
  enabled: z.boolean().default(DEFAULT_SESSION_PINS_SETTINGS.enabled),
  sidebarArea: z.boolean().default(DEFAULT_SESSION_PINS_SETTINGS.sidebarArea),
  sidebarRows: z.union([
    z.const('auto' as const),
    z.number().step(1).min(SIDEBAR_ROWS_MIN).max(SIDEBAR_ROWS_MAX),
  ]).default(DEFAULT_SESSION_PINS_SETTINGS.sidebarRows),
  autoPinStatuses: z.array(z.union([...AUTO_PIN_STATUSES])).default([...DEFAULT_SESSION_PINS_SETTINGS.autoPinStatuses]),
  digestSection: z.boolean().default(DEFAULT_SESSION_PINS_SETTINGS.digestSection),
})
