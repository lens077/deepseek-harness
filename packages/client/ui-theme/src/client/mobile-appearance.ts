/** Presentation preferences kept separate from the desktop theme snapshot: phone density, phone font size, and the pure-UI switch. */
import { createSnapshotStore, type ObservableSnapshot, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_MOBILE_FONT_SIZE, DEFAULT_MOBILE_LAYOUT, DEFAULT_PURE_UI, MOBILE_FONT_SIZE_FIELD, MOBILE_LAYOUT_FIELD,
  PURE_UI_FIELD, ThemeSettingsSchema, type MobileLayout, type ThemeSettings,
} from '../theme-settings.ts'

/**
 * Presentation values consumed by the root frame and the settings rows.
 * `mobileFontSize` and `mobileLayout` apply below the phone breakpoint only;
 * `pureUi` applies to every viewport.
 */
export type MobileAppearance = Pick<ThemeSettings, 'mobileFontSize' | 'mobileLayout' | 'pureUi'>

const INITIAL: MobileAppearance = {
  mobileFontSize: DEFAULT_MOBILE_FONT_SIZE, mobileLayout: DEFAULT_MOBILE_LAYOUT, pureUi: DEFAULT_PURE_UI,
}

function pick(section: ThemeSettings): MobileAppearance {
  return { mobileFontSize: section.mobileFontSize, mobileLayout: section.mobileLayout, pureUi: section.pureUi }
}

function same(left: MobileAppearance, right: MobileAppearance): boolean {
  return left.mobileFontSize === right.mobileFontSize
    && left.mobileLayout === right.mobileLayout
    && left.pureUi === right.pureUi
}

/** Theme-owned presentation settings; remote browsers persist only these values locally. */
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
      this.source.set(pick(stored))
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
   * Switch the pure-UI presentation on every viewport.
   * @param enabled - whether the Session header and composer fold away.
   */
  setPureUi(enabled: boolean): void {
    const current = this.source.getSnapshot()
    if (current.pureUi === enabled) return
    this.source.set({ ...current, pureUi: enabled })
    if (this.host.getSnapshot().mode === 'host') void this.host.set(PURE_UI_FIELD, enabled)
  }

  /**
   * Adopt the theme owner's accepted Host settings without writing them back.
   * @param value - schema-resolved theme section from the existing scope listener.
   */
  adopt(value: ThemeSettings): void {
    const next = pick(ThemeSettingsSchema(value))
    if (same(this.source.getSnapshot(), next)) return
    this.source.set(next)
  }
}
