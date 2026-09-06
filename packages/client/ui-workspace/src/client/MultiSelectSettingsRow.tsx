/**
 * Settings row for Shift/Ctrl session-row multi-selection. Reuses the sibling
 * session-count row's stylesheet and Menu selector so the general section
 * keeps one control idiom.
 */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { createWorkspaceViewStore } from './stores.ts'
import css from './SessionCountSettingsRow.module.css'

export type MultiSelectSettingsRowProps = PropsRuntime<'settings.general.item'>
  & PropsStore<ReturnType<typeof createWorkspaceViewStore>>
  & PropsLocale<'workspace'>

export function MultiSelectSettingsRow({ useStore, actions, t }: MultiSelectSettingsRowProps) {
  const enabled = useStore(state => state.multiSelect)
  const [open, setOpen] = useState(false)
  const label = enabled ? t('multiSelect.on') : t('multiSelect.off')
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('multiSelect.settings.title')}</div>
        <div className={css.desc}>{t('multiSelect.settings.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={[
          { id: 'on', label: t('multiSelect.on') },
          { id: 'off', label: t('multiSelect.off') },
        ]}
        selectedId={enabled ? 'on' : 'off'}
        onSelect={(id) => {
          actions.setMultiSelect(id === 'on')
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
            {label}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
