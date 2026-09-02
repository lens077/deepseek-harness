/** Conversation-layout row for whether the Files control and rail render at all. */
import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RailVisibility } from './rail-visibility.ts'
import type { NS, SessionFilesKey } from './locales.ts'
import css from './SettingsRow.module.css'

/** Registration-side preference face. */
export interface FilesVisibilityRowInjected {
  hooks: {
    /** Persisted visibility preference, bound as useFilesVisibility. */
    filesVisibility: SnapshotStore<RailVisibility>
  }
  /** Change whether the Files control and rail render at all. */
  setFilesVisibility: (visibility: RailVisibility) => void
}

/** Full Settings-row props. */
export type FilesVisibilityRowProps =
  PropsRuntime<'settings.conversation-layout.item'>
  & PropsLocale<typeof NS>
  & InjectFace<FilesVisibilityRowInjected>

const OPTIONS: readonly { id: RailVisibility; label: SessionFilesKey }[] = [
  { id: 'show', label: 'settings.visibility.show' },
  { id: 'hide', label: 'settings.visibility.hide' },
]

/** The label of the mode in force, falling back to the shipped default's. */
function selectedLabel(visibility: RailVisibility): SessionFilesKey {
  return OPTIONS.find(option => option.id === visibility)?.label ?? 'settings.visibility.show'
}

/**
 * Render the Files-surface visibility selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function FilesVisibilityRow({ useFilesVisibility, setFilesVisibility, t }: FilesVisibilityRowProps) {
  const visibility = useFilesVisibility(value => value)
  const [open, setOpen] = useState(false)

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.visibility.title')}</div>
        <div className={css.desc}>{t('settings.visibility.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={visibility}
        onSelect={(id) => {
          setOpen(false)
          setFilesVisibility(id as RailVisibility)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            {t(selectedLabel(visibility))}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
