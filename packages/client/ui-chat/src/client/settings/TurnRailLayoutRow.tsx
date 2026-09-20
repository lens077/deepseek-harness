/** General Settings row choosing where the transcript's turn rail stands. */

import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DEFAULT_TURN_RAIL_ALIGNMENT, type TurnRailAlignment } from '../../chat-settings.ts'
import type { TurnRailLayout } from '../turn-rail-layout.ts'
import type { ChatKey } from '../locale.ts'
import css from './TurnRailLayoutRow.module.css'

/** List id for the placement that shares the action controls' column. */
const STACKED_ID = 'stacked'

/** Prefix every own-column list id carries before its alignment. */
const COLUMN_PREFIX = 'column-'

/** Registration-side rail-layout face. */
export interface TurnRailLayoutRowInjected {
  hooks: {
    /** Persisted rail placement and column alignment bound as useTurnRailLayout. */
    turnRailLayout: SnapshotStore<TurnRailLayout>
  }
  /** Move the rail to one placement, with the column alignment it carries. */
  setTurnRailLayout: (layout: TurnRailLayout) => void
}

/** Full Settings-row props. */
export type TurnRailLayoutRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<TurnRailLayoutRowInjected>

/**
 * The rail's destinations as one list: stacking has no alignment of its own,
 * and each column entry names the end the ladder starts from. Ids carry their
 * destination, so selection needs no lookup that could miss.
 */
const OPTIONS: readonly { id: string; label: ChatKey }[] = [
  { id: STACKED_ID, label: 'settings.turnRail.stacked' },
  { id: 'column-top', label: 'settings.turnRail.columnTop' },
  { id: 'column-center', label: 'settings.turnRail.columnCenter' },
  { id: 'column-bottom', label: 'settings.turnRail.columnBottom' },
]

/** The list entry one layout selects; a stacked rail ignores its alignment. */
function optionIdOf(layout: TurnRailLayout): string {
  return layout.placement === 'stacked' ? STACKED_ID : `column-${layout.alignment}`
}

/** The destination one list id names; the inverse of {@link optionIdOf}. */
function layoutOf(id: string): TurnRailLayout {
  return id === STACKED_ID
    ? { placement: 'stacked', alignment: DEFAULT_TURN_RAIL_ALIGNMENT }
    : { placement: 'column', alignment: id.slice(COLUMN_PREFIX.length) as TurnRailAlignment }
}

/**
 * Render the turn-rail placement selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function TurnRailLayoutRow({ useTurnRailLayout, setTurnRailLayout, t }: TurnRailLayoutRowProps) {
  const layout = useTurnRailLayout(value => value)
  const [open, setOpen] = useState(false)
  const selectedId = optionIdOf(layout)
  // `optionIdOf` only mints ids this list declares, so the lookup always lands.
  const selected = OPTIONS.find(option => option.id === selectedId) as typeof OPTIONS[number]
  const closeMenu = () => { setOpen(false) }
  const selector = (
    <button
      type="button"
      className={css.selector}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => { setOpen(value => !value) }}
    >
      {t(selected.label)}
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
  )

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.turnRail.title')}</div>
        <div className={css.desc}>{t('settings.turnRail.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={selectedId}
        onSelect={(id) => {
          closeMenu()
          setTurnRailLayout(layoutOf(id))
        }}
        align="end"
        portal
        anchor={selector}
      />
    </div>
  )
}
