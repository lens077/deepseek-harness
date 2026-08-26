/** General Settings row for how much of a turn's inline diffs opens by default. */
import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DiffExpansion } from './diff-expansion.ts'
import type { NS, SessionFilesKey } from './locales.ts'
import css from './DiffExpansionRow.module.css'

/** Registration-side preference face. */
export interface DiffExpansionRowInjected {
  hooks: {
    /** Persisted expansion preference, bound as useDiffExpansion. */
    diffExpansion: SnapshotStore<DiffExpansion>
  }
  /** Change how much of a turn's diffs opens by default. */
  setDiffExpansion: (expansion: DiffExpansion) => void
}

/** Full Settings-row props. */
export type DiffExpansionRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<typeof NS>
  & InjectFace<DiffExpansionRowInjected>

const OPTIONS: readonly { id: DiffExpansion; label: SessionFilesKey }[] = [
  { id: 'all', label: 'settings.expansion.all' },
  { id: 'single', label: 'settings.expansion.single' },
  { id: 'none', label: 'settings.expansion.none' },
]

/** The label of the mode in force, falling back to the shipped default's. */
function selectedLabel(expansion: DiffExpansion): SessionFilesKey {
  return OPTIONS.find(option => option.id === expansion)?.label ?? 'settings.expansion.all'
}

/**
 * Render the inline-diff expansion selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function DiffExpansionRow({ useDiffExpansion, setDiffExpansion, t }: DiffExpansionRowProps) {
  const expansion = useDiffExpansion(value => value)
  const [open, setOpen] = useState(false)

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.expansion.title')}</div>
        <div className={css.desc}>{t('settings.expansion.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={expansion}
        onSelect={(id) => {
          setOpen(false)
          setDiffExpansion(id as DiffExpansion)
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
            {t(selectedLabel(expansion))}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
