/** General Settings row for Home/End in text fields outside the composer. */
import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './EnterBehaviorRow.module.css'

/** Registration-side preference face. */
export interface HomeEndCaretRowInjected {
  hooks: {
    /** Persisted preference bound as useHomeEndCaret. */
    homeEndCaret: SnapshotStore<boolean>
  }
  /** Change whether Home/End move the caret in other text fields. */
  setHomeEndCaret: (enabled: boolean) => void
}

/** Full Settings-row props. */
export type HomeEndCaretRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<HomeEndCaretRowInjected>

const ON = 'on'
const OFF = 'off'

/**
 * Render the text-field Home/End selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function HomeEndCaretRow({ useHomeEndCaret, setHomeEndCaret, t }: HomeEndCaretRowProps) {
  const enabled = useHomeEndCaret(value => value)
  const [open, setOpen] = useState(false)

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.homeEnd.title')}</div>
        <div className={css.desc}>{t('settings.homeEnd.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={[
          { id: ON, label: t('settings.homeEnd.on') },
          { id: OFF, label: t('settings.homeEnd.off') },
        ]}
        selectedId={enabled ? ON : OFF}
        onSelect={(id) => {
          setOpen(false)
          setHomeEndCaret(id === ON)
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
            {t(enabled ? 'settings.homeEnd.on' : 'settings.homeEnd.off')}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
