/**
 * Settings row for the Session-row status perimeter: animated (default),
 * static track only, or no perimeter at all. Status dots and accessible labels
 * stay in every mode. Reuses the session-count row's stylesheet and Menu
 * selector so the general section keeps one control idiom.
 */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { createWorkspaceViewStore, SessionStatusIndicatorMode } from './stores.ts'
import type { WorkspaceKey } from './locales.ts'
import css from './SessionCountSettingsRow.module.css'

export type SessionStatusSettingsRowProps = PropsRuntime<'settings.general.item'>
  & PropsStore<ReturnType<typeof createWorkspaceViewStore>>
  & PropsLocale<'workspace'>

const MODES: readonly SessionStatusIndicatorMode[] = ['animated', 'static', 'hidden']

const MODE_LABEL: Record<SessionStatusIndicatorMode, WorkspaceKey> = {
  animated: 'sessionStatus.animated',
  static: 'sessionStatus.static',
  hidden: 'sessionStatus.hidden',
}

export function SessionStatusSettingsRow({ useStore, actions, t }: SessionStatusSettingsRowProps) {
  const mode = useStore(state => state.sessionStatusIndicatorMode)
  const [open, setOpen] = useState(false)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('sessionStatus.settings.title')}</div>
        <div className={css.desc}>{t('sessionStatus.settings.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={MODES.map(id => ({ id, label: t(MODE_LABEL[id]) }))}
        selectedId={mode}
        onSelect={(id) => {
          // Menu reports a string id; the items above are exactly MODES.
          const next = MODES.find(candidate => candidate === id)
          if (next !== undefined) actions.setSessionStatusIndicatorMode(next)
          setOpen(false)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(current => !current) }}
          >
            {t(MODE_LABEL[mode])}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
