/** General Settings selectors and keyboard recorder for composer sending. */
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BusyEnterBehavior } from '../contract/composer-submission.ts'
import type { SendShortcut } from '../../submission-settings.ts'
import { recordSendShortcut } from '../../send-shortcut.ts'
import type { ConversationKey } from '../locales.ts'
import css from './EnterBehaviorRow.module.css'

/** Registration-side preference face. */
export interface EnterBehaviorRowInjected {
  hooks: {
    busyEnter: SnapshotStore<BusyEnterBehavior>
    sendShortcut: SnapshotStore<SendShortcut>
  }
  /** Change the busy-state delivery preference. */
  setBusyEnter: (behavior: BusyEnterBehavior) => void
  /** Change the keyboard gesture required to send. */
  setSendShortcut: (shortcut: SendShortcut) => void
}

/** Full Settings-row props. */
export type EnterBehaviorRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<EnterBehaviorRowInjected>

const DELIVERY_OPTIONS: readonly { id: BusyEnterBehavior; label: ConversationKey }[] = [
  { id: 'queue', label: 'settings.enter.queue' },
  { id: 'steer', label: 'settings.enter.steer' },
]
const SHORTCUT_OPTIONS: readonly { id: SendShortcut; label: ConversationKey }[] = [
  { id: 'enter', label: 'settings.send.enter' },
  { id: 'mod-enter', label: 'settings.send.modEnter' },
  { id: 'Alt+Enter', label: 'settings.send.altEnter' },
  { id: 'Ctrl+Shift+Enter', label: 'settings.send.ctrlShiftEnter' },
  { id: 'Meta+Shift+Enter', label: 'settings.send.metaShiftEnter' },
]

function shortcutLabel(shortcut: string): string {
  return shortcut.split('+').map(key => key === 'Meta' ? 'Cmd' : key).join(' + ')
}

function PreferenceRow<T extends string>({ title, description, value, options, onSelect, buttonRef }: {
  title: string
  description: string
  value: T
  options: readonly { id: T; label: string }[]
  onSelect: (value: T) => void
  buttonRef?: RefObject<HTMLButtonElement>
}) {
  const [open, setOpen] = useState(false)
  const selectedLabel = options.find(option => option.id === value)?.label
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{title}</div>
        <div className={css.desc}>{description}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={options}
        selectedId={value}
        onSelect={(id) => {
          setOpen(false)
          const option = options.find(item => item.id === id)
          if (option !== undefined) onSelect(option.id)
        }}
        align="end"
        portal
        anchor={(
          <button
            ref={buttonRef}
            type="button"
            className={css.selector}
            aria-label={`${title}: ${selectedLabel}`}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(current => !current) }}
          >
            {selectedLabel}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}

/**
 * Render sending and delivery selectors, with explicit-save custom recording.
 * @param props - composed Settings slot props.
 * @returns the preference rows.
 */
export function EnterBehaviorRow({ useBusyEnter, useSendShortcut, setBusyEnter, setSendShortcut, t }: EnterBehaviorRowProps) {
  const behavior = useBusyEnter(value => value)
  const shortcut = useSendShortcut(value => value)
  const [recording, setRecording] = useState(false)
  const [candidate, setCandidate] = useState<string | null>(null)
  const [error, setError] = useState<ConversationKey | null>(null)
  const recorder = useRef<HTMLInputElement>(null)
  const shortcutButton = useRef<HTMLButtonElement>(null)
  const helpId = useId()
  const errorId = useId()
  useEffect(() => { if (recording) recorder.current?.focus() }, [recording])
  const preset = SHORTCUT_OPTIONS.some(option => option.id === shortcut)
  const customLabel = preset ? t('settings.send.custom') : t('settings.send.customValue', { shortcut: shortcutLabel(shortcut) })
  const description = shortcut === 'enter'
    ? t('settings.send.enterDescription')
    : shortcut === 'mod-enter'
      ? t('settings.send.modEnterDescription')
      : t('settings.send.customDescription', { shortcut: shortcutLabel(shortcut) })

  const cancel = (): void => {
    setRecording(false)
    setCandidate(null)
    setError(null)
    shortcutButton.current?.focus()
  }
  const capture = (event: KeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation()
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) return
    event.preventDefault()
    if (event.key === 'Escape') { cancel(); return }
    const result = recordSendShortcut({
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
      repeat: event.repeat,
      altGraph: event.getModifierState('AltGraph'),
      // oxlint-disable-next-line typescript/no-deprecated
      keyCode: event.nativeEvent.keyCode,
    })
    if (result.kind === 'ignored') return
    if (result.kind === 'invalid') {
      setCandidate(null)
      setError(result.reason === 'modifier'
        ? 'settings.send.errorModifier'
        : result.reason === 'reserved' ? 'settings.send.errorReserved' : 'settings.send.errorUnsupported')
      return
    }
    setCandidate(result.shortcut)
    setError(null)
  }
  return (
    <>
      <div className={css.shortcutGroup} data-send-shortcut-settings="">
        <PreferenceRow
          title={t('settings.send.title')}
          buttonRef={shortcutButton}
          description={description}
          value={preset ? shortcut : 'custom'}
          options={[...SHORTCUT_OPTIONS.map(option => ({ id: option.id, label: t(option.label) })), { id: 'custom', label: customLabel }]}
          onSelect={(value) => {
            if (value === 'custom') {
              setCandidate(null)
              setError(null)
              setRecording(true)
              recorder.current?.focus()
            } else {
              cancel()
              setSendShortcut(value)
            }
          }}
        />
        {recording && (
          <div className={css.recorder}>
            <label className={css.title}>
              {t('settings.send.recordLabel')}
              <input
                ref={recorder}
                className={css.recordInput}
                readOnly
                value={candidate === null ? '' : shortcutLabel(candidate)}
                placeholder={t('settings.send.pressKeys')}
                aria-describedby={`${helpId}${error === null ? '' : ` ${errorId}`}`}
                aria-invalid={error !== null}
                onKeyDown={capture}
              />
            </label>
            <p id={helpId} className={css.desc}>{t('settings.send.recordHelp')}</p>
            {error !== null && <p id={errorId} className={css.error} role="alert">{t(error)}</p>}
            <div className={css.recordActions}>
              <Button variant="outline" onClick={cancel}>{t('cancel')}</Button>
              <Button variant="primary" disabled={candidate === null} onClick={() => {
                if (candidate !== null) setSendShortcut(candidate)
                cancel()
              }}>{t('settings.send.save')}</Button>
            </div>
          </div>
        )}
        {shortcut !== 'enter' && (
          <button className={css.reset} type="button" onClick={() => { cancel(); setSendShortcut('enter') }}>
            {t('settings.send.reset')}
          </button>
        )}
      </div>
      <PreferenceRow
        title={t('settings.enter.title')}
        description={t(shortcut === 'enter'
          ? 'settings.enter.description'
          : shortcut === 'mod-enter' ? 'settings.enter.modDescription' : 'settings.enter.customDescription')}
        value={behavior}
        options={DELIVERY_OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        onSelect={setBusyEnter}
      />
    </>
  )
}
