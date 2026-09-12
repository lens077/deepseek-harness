/** Phone appearance preferences, separate from the desktop theme snapshot. */
import { createSnapshotStore, type ObservableSnapshot, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_MOBILE_FONT_SIZE, DEFAULT_MOBILE_LAYOUT, MOBILE_FONT_SIZE_FIELD, MOBILE_LAYOUT_FIELD,
  ThemeSettingsSchema, type MobileLayout, type ThemeSettings,
} from '../theme-settings.ts'

/** Phone presentation values consumed by the root and the mobile settings rows. */
export type MobileAppearance = Pick<ThemeSettings, 'mobileFontSize' | 'mobileLayout'>

const INITIAL: MobileAppearance = { mobileFontSize: DEFAULT_MOBILE_FONT_SIZE, mobileLayout: DEFAULT_MOBILE_LAYOUT }

/** Theme-owned phone settings; remote browsers persist only these values locally. */
export class MobileAppearancePolicy {
  private readonly source: SnapshotStore<MobileAppearance>
  /** Stable observable consumed through framework-bound hooks. */
  readonly appearance: ObservableSnapshot<MobileAppearance>

  /** @param host - theme settings scope, whose mode selects Host or browser-local persistence. */
  constructor(private readonly host: SettingsScope<ThemeSettings>) {
    this.source = createSnapshotStore<MobileAppearance>(INITIAL, host.getSnapshot().mode === 'memory'
      ? { persist: { name: 'dsh.mobile.appearance' } }
      : undefined)
    if (host.getSnapshot().mode === 'memory') {
      let stored: ThemeSettings
      try { stored = ThemeSettingsSchema(this.source.getSnapshot()) }
      catch { stored = ThemeSettingsSchema({}) } // Invalid browser-stored preferences reset to schema defaults.
      this.source.set({ mobileFontSize: stored.mobileFontSize, mobileLayout: stored.mobileLayout })
    }
    this.appearance = this.source
  }

  /**
   * Change phone font size without changing either layout or desktop typography.
   * @param fontSize - phone text size in CSS pixels within the schema bounds.
   */
  setFontSize(fontSize: number): void {
    const current = this.source.getSnapshot()
    if (current.mobileFontSize === fontSize) return
    this.source.set({ ...current, mobileFontSize: fontSize })
    if (this.host.getSnapshot().mode === 'host') void this.host.set(MOBILE_FONT_SIZE_FIELD, fontSize)
  }

  /**
   * Change phone density without changing the independently chosen font size.
   * @param layout - phone layout density.
   */
  setLayout(layout: MobileLayout): void {
    const current = this.source.getSnapshot()
    if (current.mobileLayout === layout) return
    this.source.set({ ...current, mobileLayout: layout })
    if (this.host.getSnapshot().mode === 'host') void this.host.set(MOBILE_LAYOUT_FIELD, layout)
  }

  /**
   * Adopt the theme owner's accepted Host settings without writing them back.
   * @param value - schema-resolved theme section from the existing scope listener.
   */
  adopt(value: ThemeSettings): void {
    const section = ThemeSettingsSchema(value)
    const current = this.source.getSnapshot()
    if (current.mobileFontSize === section.mobileFontSize && current.mobileLayout === section.mobileLayout) return
    this.source.set({ mobileFontSize: section.mobileFontSize, mobileLayout: section.mobileLayout })
  }
}
