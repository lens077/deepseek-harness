/**
 * The Project todos settings page: which roots the Host scans, which file
 * patterns count as todo documents, and whether registered workspaces join
 * the scan. Roots are a list with a directory chooser; patterns are edited
 * as lines and saved as one list.
 */
import { useEffect, useState } from 'react'
import type { ProjectSettingsSectionProps } from './contract/slots.ts'
import { cleanList } from './project-settings.ts'
import css from './ProjectSettingsSection.module.css'

/**
 * Render the scan settings page.
 * @param props - composed slot props (settings view hook, writers, chooser, copy).
 * @returns the page element.
 */
export function ProjectSettingsSection(props: ProjectSettingsSectionProps) {
  const { useProjectSettings, setRoots, setFiles, setIncludeWorkspaces, pickDirectory, t } = props
  const view = useProjectSettings(value => value)
  const [rootDraft, setRootDraft] = useState('')
  const [filesDraft, setFilesDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (error === null) return
    const timer = globalThis.setTimeout(() => { setError(null) }, 4_000)
    return () => { globalThis.clearTimeout(timer) }
  }, [error])
  const disabled = view.status !== 'ready' || !view.writable
  const failed = (key: 'settings.saveFailed' | 'settings.pickFailed') => (cause: unknown): void => {
    setError(t(key, { message: cause instanceof Error ? cause.message : String(cause) }))
  }
  const addRoot = (path: string): void => {
    const value = path.trim()
    if (value.length === 0) return
    void setRoots([...view.roots, value]).then(() => { setRootDraft('') }, failed('settings.saveFailed'))
  }
  const filesText = filesDraft ?? view.files.join('\n')
  const filesDirty = filesDraft !== null && cleanList(filesDraft.split('\n')).join('\n') !== view.files.join('\n')

  return (
    <div className={css.section}>
      <h3 className={css.title}>{t('settings.title')}</h3>
      <p className={css.desc}>{t('settings.description')}</p>
      {view.status === 'loading' && <p className={css.desc}>{t('settings.loading')}</p>}
      {view.status !== 'loading' && disabled && <p className={css.warn}>{t('settings.unavailable')}</p>}
      {error !== null && <p className={css.error} role="alert">{error}</p>}

      <div className={css.field}>
        <div className={css.label}>{t('settings.roots')}</div>
        <p className={css.hint}>{t('settings.roots.hint')}</p>
        {view.roots.length === 0
          ? <p className={css.hint}>{t('settings.roots.empty')}</p>
          : (
            <ul className={css.list} aria-label={t('settings.roots')}>
              {view.roots.map(root => (
                <li key={root} className={css.listRow}>
                  <span className={css.listText}>{root}</span>
                  <button
                    type="button"
                    className={css.action}
                    disabled={disabled}
                    onClick={() => { void setRoots(view.roots.filter(other => other !== root)).catch(failed('settings.saveFailed')) }}
                  >
                    {t('settings.roots.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        <form
          className={css.addRow}
          onSubmit={(event) => {
            event.preventDefault()
            addRoot(rootDraft)
          }}
        >
          <input
            className={css.input}
            value={rootDraft}
            placeholder={t('settings.roots.placeholder')}
            disabled={disabled}
            aria-label={t('settings.roots.placeholder')}
            onChange={(event) => { setRootDraft(event.target.value) }}
          />
          <button type="submit" className={css.action} disabled={disabled || rootDraft.trim() === ''}>{t('settings.roots.submit')}</button>
          <button
            type="button"
            className={css.action}
            disabled={disabled}
            onClick={() => {
              void pickDirectory().then((path) => { if (path !== null) addRoot(path) }, failed('settings.pickFailed'))
            }}
          >
            {t('settings.roots.add')}
          </button>
        </form>
      </div>

      <div className={css.field}>
        <div className={css.label}>{t('settings.files')}</div>
        <p className={css.hint}>{t('settings.files.hint')}</p>
        <textarea
          className={css.textarea}
          rows={5}
          value={filesText}
          disabled={disabled}
          aria-label={t('settings.files')}
          onChange={(event) => { setFilesDraft(event.target.value) }}
        />
        <div className={css.addRow}>
          <button
            type="button"
            className={css.action}
            disabled={disabled || !filesDirty}
            onClick={() => {
              void setFiles(filesText.split('\n')).then(() => { setFilesDraft(null) }, failed('settings.saveFailed'))
            }}
          >
            {t('settings.files.save')}
          </button>
        </div>
      </div>

      <div className={css.field}>
        <label className={css.check}>
          <input
            type="checkbox"
            checked={view.includeWorkspaces}
            disabled={disabled}
            onChange={(event) => { void setIncludeWorkspaces(event.target.checked).catch(failed('settings.saveFailed')) }}
          />
          <span>
            <span className={css.label}>{t('settings.includeWorkspaces')}</span>
            <span className={css.hint}>{t('settings.includeWorkspaces.hint')}</span>
          </span>
        </label>
      </div>
    </div>
  )
}
