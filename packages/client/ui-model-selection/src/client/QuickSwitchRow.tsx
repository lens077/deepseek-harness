/**
 * Quick-switch preference row registered into the General section item slot:
 * title + description + Switch. The switch echoes the persisted value, never
 * the click.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { QuickSwitchState } from './quick-switch.ts'
import css from './QuickSwitchRow.module.css'

/** Registration-side quick-switch preference face. */
export interface QuickSwitchRowInjected {
  hooks: {
    /** Persisted quick-switch preference bound as useQuickSwitch. */
    quickSwitch: SnapshotStore<QuickSwitchState>
  }
  /** Show or hide the strip above the composer. */
  setQuickSwitch: (enabled: boolean) => void
}

/** Full Settings-row props. */
export type QuickSwitchRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'model'>
  & InjectFace<QuickSwitchRowInjected>

/**
 * Render the quick-switch row.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function QuickSwitchRow({ useQuickSwitch, setQuickSwitch, t }: QuickSwitchRowProps) {
  const enabled = useQuickSwitch(state => state.enabled)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.quickSwitch.title')}</div>
        <div className={css.desc}>{t('settings.quickSwitch.description')}</div>
      </div>
      <Switch checked={enabled} label={t('settings.quickSwitch.title')} onChange={setQuickSwitch} />
    </div>
  )
}
