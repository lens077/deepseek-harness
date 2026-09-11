/** Settings page for enabling Session pins and choosing their two UI locations. */

import { useEffect, useState } from 'react'
import type { PinsSettingsSectionProps } from './contract/slots.ts'
import { SIDEBAR_ROWS_MAX, SIDEBAR_ROWS_MIN } from '../pins-settings.ts'
import css from './ProjectSettingsSection.module.css'

/**
 * Render the Session pin settings page.
 * @param props - composed settings view, writers, and localized copy.
 * @returns the settings page element.
 */
export function PinsSettingsSection(props: PinsSettingsSectionProps) {
  const { usePinsSettings, setEnabled, setSidebarArea, setSidebarRows, setDigestSection, t } = props
  const view = usePinsSettings(value => value)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (error === null) return
    const timer = globalThis.setTimeout(() => { setError(null) }, 4_000)
    return () => { globalThis.clearTimeout(timer) }
  }, [error])
  const disabled = view.status !== 'ready' || !view.writable
  const failed = (cause: unknown): void => {
    setError(t('settings.saveFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
  }
  const commitRows = (raw: string, valueAsNumber: number): void => {
    if (raw.trim() === '' || !Number.isFinite(valueAsNumber)) return
    const rows = Math.min(SIDEBAR_ROWS_MAX, Math.max(SIDEBAR_ROWS_MIN, Math.round(valueAsNumber)))
    void setSidebarRows(rows).catch(failed)
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
        <input
          id="session-pins-sidebar-rows"
          className={css.input}
          type="number"
          min={SIDEBAR_ROWS_MIN}
          max={SIDEBAR_ROWS_MAX}
          step={1}
          inputMode="numeric"
          value={view.sidebarRows}
          disabled={disabled || !view.enabled || !view.sidebarArea}
          onChange={(event) => { commitRows(event.currentTarget.value, event.currentTarget.valueAsNumber) }}
        />
      </div>

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
