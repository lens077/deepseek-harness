/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

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

/** Phone layouts accepted by the persisted appearance settings. */
export const MOBILE_LAYOUTS = ['large', 'medium', 'small'] as const

/** Phone layout density; independent of the selected phone font size. */
export type MobileLayout = typeof MOBILE_LAYOUTS[number]

/** Default phone density. */
export const DEFAULT_MOBILE_LAYOUT: MobileLayout = 'medium'

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
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<Partial<ThemeSettings>, ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [FONT_SIZE_FIELD]: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(DEFAULT_FONT_SIZE),
  [MOBILE_FONT_SIZE_FIELD]: z.number().step(1).min(MOBILE_FONT_SIZE_MIN).max(MOBILE_FONT_SIZE_MAX).default(DEFAULT_MOBILE_FONT_SIZE),
  [MOBILE_LAYOUT_FIELD]: z.union([...MOBILE_LAYOUTS]).default(DEFAULT_MOBILE_LAYOUT),
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}
