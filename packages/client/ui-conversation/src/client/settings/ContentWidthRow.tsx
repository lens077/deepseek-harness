/** General Settings row for the conversation content-width mode. */
import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContentWidthMode } from '../../submission-settings.ts'
import type { ConversationKey } from '../locales.ts'
import css from './EnterBehaviorRow.module.css'

/** Registration-side preference face. */
export interface ContentWidthRowInjected {
  hooks: {
    /** Persisted width-mode preference bound as useContentWidthMode. */
    contentWidthMode: SnapshotStore<ContentWidthMode>
  }
  /** Change the conversation content-width mode. */
  setContentWidthMode: (mode: ContentWidthMode) => void
}

/** Full Settings-row props. */
export type ContentWidthRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<ContentWidthRowInjected>

const OPTIONS: readonly {
  id: ContentWidthMode
  label: ConversationKey
}[] = [
  { id: 'fill', label: 'settings.width.fill' },
  { id: 'adaptive', label: 'settings.width.adaptive' },
]

/**
 * Render the content-width mode selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function ContentWidthRow({ useContentWidthMode, setContentWidthMode, t }: ContentWidthRowProps) {
  const mode = useContentWidthMode(value => value)
  const [open, setOpen] = useState(false)
  const selectedLabel = mode === 'fill' ? 'settings.width.fill' : 'settings.width.adaptive'

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.width.title')}</div>
        <div className={css.desc}>{t('settings.width.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={mode}
        onSelect={(id) => {
          setOpen(false)
          setContentWidthMode(id as ContentWidthMode)
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
            {t(selectedLabel)}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
