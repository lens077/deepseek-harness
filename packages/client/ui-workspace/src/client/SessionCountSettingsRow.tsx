import { useState } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { createWorkspaceViewStore, CollapsedSessionCount } from './stores.ts'
import css from './SessionCountSettingsRow.module.css'

export type SessionCountSettingsRowProps = PropsRuntime<'settings.general.item'>
  & PropsStore<ReturnType<typeof createWorkspaceViewStore>>
  & PropsLocale<'workspace'>

const OPTIONS: readonly CollapsedSessionCount[] = [
  'auto', ...Array.from({ length: 16 }, (_, index) => index + 5),
]

export function SessionCountSettingsRow({ useStore, actions, t }: SessionCountSettingsRowProps) {
  const value = useStore(state => state.collapsedSessionCount)
  const [open, setOpen] = useState(false)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('sessionCount.settings.title')}</div>
        <div className={css.desc}>{t('sessionCount.settings.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={OPTIONS.map(option => ({
          id: String(option),
          label: option === 'auto' ? t('sessionCount.auto') : String(option),
        }))}
        selectedId={String(value)}
        onSelect={(id) => {
          actions.setCollapsedSessionCount(id === 'auto' ? 'auto' : Number(id))
          setOpen(false)
        }}
        align="end"
        portal
        anchor={(
          <button type="button" className={css.selector} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(current => !current) }}>
            {value === 'auto' ? t('sessionCount.auto') : value}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
