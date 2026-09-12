/** General Settings rows for the strip and canvas variants. */
import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { FLOW_VARIANTS, type FlowVariant } from '../settings.ts'
import type { FlowStyle } from './style-policy.ts'
import type { TaskFlowKey } from './locales.ts'
import css from './FlowStyleRow.module.css'

/** Registration-side preference face. */
export interface FlowStyleRowInjected {
  hooks: {
    /** Live variant preferences, bound as useFlowStyle. */
    flowStyle: SnapshotStore<FlowStyle>
  }
  /** Which preference this row edits. */
  target: 'dock' | 'canvas'
  /** Change the row's preference. */
  setVariant: (variant: FlowVariant) => void
}

/** Full Settings-row props. */
export type FlowStyleRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'taskFlow'>
  & InjectFace<FlowStyleRowInjected>

const LABELS: Record<FlowVariant, TaskFlowKey> = {
  cards: 'variant.cards',
  rail: 'variant.rail',
  lanes: 'variant.lanes',
}

/**
 * Render one variant selector row.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function FlowStyleRow({ useFlowStyle, target, setVariant, t }: FlowStyleRowProps) {
  const value = useFlowStyle(style => style[target])
  const [open, setOpen] = useState(false)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t(target === 'dock' ? 'settings.dock.title' : 'settings.canvas.title')}</div>
        <div className={css.desc}>{t(target === 'dock' ? 'settings.dock.description' : 'settings.canvas.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={FLOW_VARIANTS.map(variant => ({ id: variant, label: t(LABELS[variant]) }))}
        selectedId={value}
        onSelect={(id) => {
          setOpen(false)
          setVariant(id as FlowVariant)
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
            {t(LABELS[value])}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
