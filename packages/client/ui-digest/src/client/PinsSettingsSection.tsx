/** Settings page for enabling Session pins, choosing their two UI locations, and sizing the sidebar area. */

import { useEffect, useState } from 'react'
import type { SessionAutoPinStatus } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { PinsSettingsSectionProps } from './contract/slots.ts'
import { AUTO_PIN_STATUSES, SIDEBAR_ROWS_MAX, SIDEBAR_ROWS_MIN } from '../pins-settings.ts'
import css from './ProjectSettingsSection.module.css'

/** Select values: `auto` plus every integer in the schema range. */
const ROW_CHOICES: readonly string[] = [
  'auto',
  ...Array.from({ length: SIDEBAR_ROWS_MAX - SIDEBAR_ROWS_MIN + 1 }, (_, index) => String(SIDEBAR_ROWS_MIN + index)),
]

/**
 * Render the Session pin settings page.
 * @param props - composed settings view, writers, and localized copy.
 * @returns the settings page element.
 */
export function PinsSettingsSection(props: PinsSettingsSectionProps) {
  const { usePinsSettings, setEnabled, setSidebarArea, setSidebarRows, setAutoPinStatuses, setDigestSection, t } = props
  const view = usePinsSettings(value => value)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (error === null) return
    const timer = globalThis.setTimeout(() => { setError(null) }, 4_000)
    return () => { globalThis.clearTimeout(timer) }
  }, [error])
  const disabled = view.status !== 'ready' || !view.writable
  const sidebarDisabled = disabled || !view.enabled || !view.sidebarArea
  const failed = (cause: unknown): void => {
    setError(t('settings.saveFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
  }
  const commitRows = (raw: string): void => {
    void setSidebarRows(raw === 'auto' ? 'auto' : Number(raw)).catch(failed)
  }
  // The selection keeps the canonical status order whichever box was flipped.
  const toggleStatus = (status: SessionAutoPinStatus, checked: boolean): void => {
    const next = AUTO_PIN_STATUSES.filter(item => item === status ? checked : view.autoPinStatuses.includes(item))
    void setAutoPinStatuses(next).catch(failed)
  }

  return (
    <div className={css.section}>
      <h3 className={css.title}>{t('pinsSettings.title')}</h3>
      <p className={css.desc}>{t('pinsSettings.description')}</p>
      {view.status === 'loading' && <p className={css.desc}>{t('settings.loading')}</p>}
      {view.status !== 'loading' && disabled && <p className={css.warn}>{t('settings.unavailable')}</p>}
      {error !== null && <p className={css.error} role="alert">{error}</p>}

      <div className={css.field}>
        <label className={css.check}>
          <input
            type="checkbox"
            checked={view.enabled}
            disabled={disabled}
            onChange={(event) => { void setEnabled(event.target.checked).catch(failed) }}
          />
          <span>
            <span className={css.label}>{t('pinsSettings.enabled')}</span>
            <span className={css.hint}>{t('pinsSettings.enabled.hint')}</span>
          </span>
        </label>
      </div>

      <div className={css.field}>
        <label className={css.check}>
          <input
            type="checkbox"
            checked={view.sidebarArea}
            disabled={disabled || !view.enabled}
            onChange={(event) => { void setSidebarArea(event.target.checked).catch(failed) }}
          />
          <span>
            <span className={css.label}>{t('pinsSettings.sidebarArea')}</span>
            <span className={css.hint}>{t('pinsSettings.sidebarArea.hint')}</span>
          </span>
        </label>
      </div>

      <div className={css.field}>
        <label className={css.label} htmlFor="session-pins-sidebar-rows">{t('pinsSettings.sidebarRows')}</label>
        <p className={css.hint}>{t('pinsSettings.sidebarRows.hint')}</p>
        <select
          id="session-pins-sidebar-rows"
          className={css.input}
          value={String(view.sidebarRows)}
          disabled={sidebarDisabled}
          onChange={(event) => { commitRows(event.currentTarget.value) }}
        >
          {ROW_CHOICES.map(choice => (
            <option key={choice} value={choice}>
              {choice === 'auto' ? t('pinsSettings.sidebarRows.auto') : choice}
            </option>
          ))}
        </select>
      </div>

      <fieldset className={css.field}>
        <legend className={css.label}>{t('pinsSettings.autoPin')}</legend>
        <p className={css.hint}>{t('pinsSettings.autoPin.hint')}</p>
        {AUTO_PIN_STATUSES.map(status => (
          <label key={status} className={css.check}>
            <input
              type="checkbox"
              checked={view.autoPinStatuses.includes(status)}
              disabled={sidebarDisabled}
              onChange={(event) => { toggleStatus(status, event.target.checked) }}
            />
            <span className={css.label}>{t(`pinsSettings.autoPin.${status}`)}</span>
          </label>
        ))}
      </fieldset>

      <div className={css.field}>
        <label className={css.check}>
          <input
            type="checkbox"
            checked={view.digestSection}
            disabled={disabled || !view.enabled}
            onChange={(event) => { void setDigestSection(event.target.checked).catch(failed) }}
          />
          <span>
            <span className={css.label}>{t('pinsSettings.digestSection')}</span>
            <span className={css.hint}>{t('pinsSettings.digestSection.hint')}</span>
          </span>
        </label>
      </div>
    </div>
  )
}
