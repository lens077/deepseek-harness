/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
/** Built-in visual themes available in General Settings. */
export const THEME_PREFERENCES = [
  'light', 'dark', 'system', 'glass', 'rainbow', 'deepseek-muse', 'forest', 'sunset',
] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Field carrying the conversation content font size. */
export const FONT_SIZE_FIELD = 'fontSize'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Smallest accepted content font size (px). */
export const FONT_SIZE_MIN = 12

/** Largest accepted content font size (px). */
export const FONT_SIZE_MAX = 17

/** Content font size when the user-settings document has no override (px). */
export const DEFAULT_FONT_SIZE = 14

/** Layout densities accepted by desktop and phone presentation settings. */
export const LAYOUT_DENSITIES = ['large', 'medium', 'small'] as const
/** Phone layout densities, retained as the public name for existing consumers. */
export const MOBILE_LAYOUTS = LAYOUT_DENSITIES

/** Layout density used independently by desktop and phone presentation. */
export type MobileLayout = typeof LAYOUT_DENSITIES[number]
/** Desktop layout density. */
export type DesktopLayout = MobileLayout

/** Default phone density. */
export const DEFAULT_MOBILE_LAYOUT: MobileLayout = 'medium'
/** Default desktop density. */
export const DEFAULT_DESKTOP_LAYOUT: DesktopLayout = 'medium'

/** Phone font-size preference bounds and default, in CSS pixels. */
export const MOBILE_FONT_SIZE_MIN = 12
/** Largest supported phone font size, in CSS pixels. */
export const MOBILE_FONT_SIZE_MAX = 22
/** Phone font size when no override is stored, in CSS pixels. */
export const DEFAULT_MOBILE_FONT_SIZE = 16

/** Field carrying the phone font size independently of desktop typography. */
export const MOBILE_FONT_SIZE_FIELD = 'mobileFontSize'
/** Field carrying the phone layout density. */
export const MOBILE_LAYOUT_FIELD = 'mobileLayout'
/** Field carrying the desktop layout density. */
export const DESKTOP_LAYOUT_FIELD = 'desktopLayout'
/** Field carrying the pure-UI (reading) presentation switch. */
export const PURE_UI_FIELD = 'pureUi'
/** Pure UI is off when the user-settings document has no override. */
export const DEFAULT_PURE_UI = false

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Conversation content font size in px (integer within {@link FONT_SIZE_MIN}..{@link FONT_SIZE_MAX}). */
  fontSize: number
  /** Phone typography in CSS pixels, independent of desktop fontSize. */
  mobileFontSize: number
  /** Phone controls and information density; switching it preserves mobileFontSize. */
  mobileLayout: MobileLayout
  /** Desktop spacing and information density; independent of the phone density. */
  desktopLayout: DesktopLayout
  /**
   * Pure UI: every viewport hides the Session header, shows the current
   * question as plain text, and folds the composer behind a floating button
   * so the transcript takes the whole column.
   */
  pureUi: boolean
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<Partial<ThemeSettings>, ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [FONT_SIZE_FIELD]: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(DEFAULT_FONT_SIZE),
  [MOBILE_FONT_SIZE_FIELD]: z.number().step(1).min(MOBILE_FONT_SIZE_MIN).max(MOBILE_FONT_SIZE_MAX).default(DEFAULT_MOBILE_FONT_SIZE),
  [MOBILE_LAYOUT_FIELD]: z.union([...MOBILE_LAYOUTS]).default(DEFAULT_MOBILE_LAYOUT),
  [DESKTOP_LAYOUT_FIELD]: z.union([...LAYOUT_DENSITIES]).default(DEFAULT_DESKTOP_LAYOUT),
  [PURE_UI_FIELD]: z.boolean().default(DEFAULT_PURE_UI),
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}
