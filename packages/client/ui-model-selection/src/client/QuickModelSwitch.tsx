/**
 * QuickModelSwitch: the composer-context strip of recently used models, one
 * pill per remembered route, rendered right above the composer card so a
 * switch between the models a user alternates among is one press instead of
 * the seat menu's three. Pills submit through the SAME per-session
 * ModelDirectory as the seat and the /model popup; a refused selection
 * announces through the transient Toast anchored to the strip.
 */
import { useRef, useState } from 'react'
import clsx from 'clsx'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconWarningOutline16, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelDirectoryState } from './directory.ts'
import { quickModelChips, type QuickModelChip, type QuickSwitchState } from './quick-switch.ts'
import css from './QuickModelSwitch.module.css'

/** Outcome of one pill press: accepted, or refused with the directory's failure text. */
export type QuickSwitchResult = { accepted: true } | { accepted: false; message: string }

/** Injected business face of the strip. */
export interface QuickModelSwitchInjected {
  hooks: {
    /** The session's shared directory (same instance the seat and popup read). */
    modelDirectory: SnapshotStore<ModelDirectoryState>
    /** The durable toggle and recent list. */
    quickSwitch: SnapshotStore<QuickSwitchState>
  }
  /** Whether this session supports Agent-bound model selection. */
  available: boolean
  /**
   * Select a complete remembered selection.
   * @param selection - model selection and optional adapter-owned effort.
   * @returns whether the host accepted it, with the failure text otherwise.
   */
  select: (selection: ModelSelection) => Promise<QuickSwitchResult>
}

/** Props of the pure strip. */
export interface QuickModelSwitchProps {
  chips: readonly QuickModelChip[]
  /** No session to select for: pills render inert. */
  locked: boolean
  /** A selection is crossing the wire: pills wait for it. */
  busy: boolean
  onSelect: (selection: ModelSelection) => Promise<QuickSwitchResult>
  t: TranslateNS<'model'>
}

/**
 * Render the strip. Nothing renders while every pill is the current route:
 * a strip that offers no switch is noise above the composer.
 * @param props - resolved pills, lock/busy state, the select verb, and copy.
 * @returns the pill strip, or null.
 */
export function QuickModelSwitch({ chips, locked, busy, onSelect, t }: QuickModelSwitchProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  if (!chips.some(chip => !chip.active)) return null

  const press = (chip: QuickModelChip): void => {
    if (chip.active) return
    void onSelect(chip.selection).then((result) => {
      if (result.accepted) return
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('error.action', { message: result.message }) })
    })
  }

  return (
    <div ref={rootRef} className={css.dock} role="group" aria-label={t('quick.aria')}>
      <div className={css.strip}>
        {chips.map(chip => (
          <button
            key={chip.key}
            type="button"
            className={clsx(css.chip, chip.active && css.chipActive)}
            aria-pressed={chip.active}
            aria-label={chip.effort === undefined
              ? t('quick.chipAria', { model: chip.name })
              : t('quick.chipAriaEffort', { model: chip.name, effort: chip.effort })}
            title={chip.effort === undefined ? chip.name : `${chip.name} · ${chip.effort}`}
            disabled={locked || busy}
            onClick={() => { press(chip) }}
          >
            <span className={css.chipName}>{chip.name}</span>
            {chip.effort !== undefined && <span className={css.chipEffort}>{chip.effort}</span>}
          </button>
        ))}
      </div>
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}

/** Full props of the dock entry: InputZone owner share + injected face + the locale seat. */
export type QuickModelDockProps =
  PropsRuntime<'conversation.input.dock'>
  & InjectFace<QuickModelSwitchInjected>
  & PropsLocale<'model'>

/**
 * Dock adapter: resolves the remembered routes against the session's live
 * directory and hides the strip when the preference is off, the session
 * cannot select, or nothing is remembered.
 * @param props - composed dock-entry props.
 * @returns the strip, or null.
 */
export function QuickModelDock({
  session, useModelDirectory, useQuickSwitch, available, select, t,
}: QuickModelDockProps) {
  const enabled = useQuickSwitch(state => state.enabled)
  const recent = useQuickSwitch(state => state.recent)
  const directory = useModelDirectory(state => state)
  if (!enabled || !available) return null
  return (
    <QuickModelSwitch
      chips={quickModelChips(directory, recent)}
      locked={session.removed}
      busy={directory.status === 'selecting'}
      onSelect={select}
      t={t}
    />
  )
}
