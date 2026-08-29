import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationKey } from '../locales.ts'
import type { QuestionNavigationSettings } from '../../submission-settings.ts'
import css from './QuestionShortcutRow.module.css'

export interface QuestionShortcutRowInjected {
  hooks: { questionNavigation: SnapshotStore<QuestionNavigationSettings> }
  setQuestionNavigation: (settings: QuestionNavigationSettings) => void
  resetQuestionNavigation: () => void
}

export type QuestionShortcutRowProps = PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'> & InjectFace<QuestionShortcutRowInjected>

function shortcutLabel(shortcut: string): string {
  return shortcut.replace('Meta+', '⌘').replace('Ctrl+', 'Ctrl+').replace('Shift+', 'Shift+').replace('Alt+', 'Alt+')
}

function recordedShortcut(event: React.KeyboardEvent<HTMLInputElement>): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return null
  const modifiers = [event.metaKey && 'Meta', event.ctrlKey && 'Ctrl', event.shiftKey && 'Shift', event.altKey && 'Alt'].filter(Boolean)
  const key = event.key.length === 1 ? event.key.toLocaleUpperCase() : event.key
  return [...modifiers, key].join('+')
}

export function QuestionShortcutRow({
  useQuestionNavigation, setQuestionNavigation, resetQuestionNavigation, t,
}: QuestionShortcutRowProps) {
  const settings = useQuestionNavigation(value => value)
  const [pending, setPending] = useState<{ field: 'previousShortcut' | 'nextShortcut'; shortcut: string } | null>(null)
  const capture = (field: 'previousShortcut' | 'nextShortcut') => (event: React.KeyboardEvent<HTMLInputElement>): void => {
    event.preventDefault()
    const shortcut = recordedShortcut(event)
    if (shortcut === null) return
    const other = field === 'previousShortcut' ? settings.nextShortcut : settings.previousShortcut
    if (shortcut === other) return
    if (!shortcut.includes('+')) setPending({ field, shortcut })
    else setQuestionNavigation({ ...settings, [field]: shortcut })
  }
  const focusOptions: readonly { value: QuestionNavigationSettings['focusPolicy']; label: ConversationKey }[] = [
    { value: 'editable', label: 'settings.questions.focus.editable' },
    { value: 'text', label: 'settings.questions.focus.text' },
    { value: 'always', label: 'settings.questions.focus.always' },
  ]
  return (
    <div className={css.row}>
      <div className={css.heading}>
        <div><strong>{t('settings.questions.title')}</strong><p>{t('settings.questions.description')}</p></div>
        <Button variant="outline" onClick={resetQuestionNavigation}>{t('settings.questions.reset')}</Button>
      </div>
      <div className={css.shortcuts}>
        <label>{t('settings.questions.previous')}<input readOnly value={shortcutLabel(settings.previousShortcut)} onKeyDown={capture('previousShortcut')} /></label>
        <label>{t('settings.questions.next')}<input readOnly value={shortcutLabel(settings.nextShortcut)} onKeyDown={capture('nextShortcut')} /></label>
      </div>
      <fieldset>
        <legend>{t('settings.questions.focus.title')}</legend>
        {focusOptions.map(option => (
          <label key={option.value} className={css.radio}>
            <input type="radio" checked={settings.focusPolicy === option.value} onChange={() => { setQuestionNavigation({ ...settings, focusPolicy: option.value }) }} />
            {t(option.label)}
          </label>
        ))}
      </fieldset>
      <Modal
        open={pending !== null}
        onClose={() => { setPending(null) }}
        title={t('settings.questions.single.title')}
        description={t('settings.questions.single.description')}
        footer={<><Button variant="outline" onClick={() => { setPending(null) }}>{t('cancel')}</Button><Button variant="primary" onClick={() => { if (pending !== null) setQuestionNavigation({ ...settings, [pending.field]: pending.shortcut }); setPending(null) }}>{t('settings.questions.single.confirm')}</Button></>}
      />
    </div>
  )
}
