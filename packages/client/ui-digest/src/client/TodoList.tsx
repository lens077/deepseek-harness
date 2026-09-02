/**
 * The todo tab: the user's own todos joined with the sessions they point at,
 * plus the automatic group of sessions whose last turn did not finish. A todo
 * addressed to a question can jump straight to it; every todo can hand the
 * user back into the session with a prefilled composer.
 */
import { useState } from 'react'
import clsx from 'clsx'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InboxTodoId } from '@deepseek-ai/dsh-session-inbox/types'
import type { DigestPanelProps } from './contract/slots.ts'
import type { InboxItem, TodoRow } from './select.ts'
import css from './DigestPanel.module.css'

/** Callbacks the todo tab needs from the panel. */
export interface TodoListActions {
  openSession: (id: SessionId) => void
  openQuestion: (id: SessionId, seq: number) => void
  continueWork: (id: SessionId, hint: string | null) => void
  add: (sessionId: SessionId, text: string) => Promise<boolean>
  setStatus: (id: InboxTodoId, done: boolean) => void
  remove: (id: InboxTodoId) => void
  markHandled: (id: SessionId) => void
}

/**
 * Render the todo tab.
 * @param props - joined todo rows, the automatic failed items, the current session, copy, and actions.
 * @returns the tab element.
 */
export function TodoList({ rows, auto, currentSessionId, t, actions }: {
  rows: readonly TodoRow[]
  auto: readonly InboxItem[]
  currentSessionId: SessionId | undefined
  t: DigestPanelProps['t']
  actions: TodoListActions
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '' || currentSessionId === undefined) return
    const ok = await actions.add(currentSessionId, text)
    if (ok) {
      setDraft('')
      setError(null)
    } else {
      setError(t('panel.copyFailed'))
    }
  }
  return (
    <div className={css.todoTab}>
      <form
        className={css.todoAdd}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <input
          className={css.todoInput}
          value={draft}
          placeholder={currentSessionId === undefined ? t('todos.add.noSession') : t('todos.add.placeholder')}
          disabled={currentSessionId === undefined}
          aria-label={t('todos.add')}
          onChange={(event) => { setDraft(event.target.value) }}
        />
        <button type="submit" className={css.action} disabled={currentSessionId === undefined || draft.trim() === ''}>
          {t('todos.add')}
        </button>
        {error !== null && <span className={css.inlineError}>{error}</span>}
      </form>

      {rows.length === 0 && auto.length === 0 && (
        <div className={css.empty}>
          <p className={css.emptyBody}>{t('todos.empty')}</p>
        </div>
      )}

      {rows.length > 0 && (
        <ul className={css.todoList} aria-label={t('todos.title')}>
          {rows.map(row => (
            <li key={row.todo.id} className={clsx(css.todoRow, row.todo.status === 'done' && css.todoDone)}>
              <label className={css.todoCheck}>
                <input
                  type="checkbox"
                  checked={row.todo.status === 'done'}
                  aria-label={row.todo.status === 'done' ? t('todos.reopen') : t('todos.done')}
                  onChange={(event) => { actions.setStatus(row.todo.id, event.target.checked) }}
                />
              </label>
              <span className={css.todoBody}>
                <span className={css.todoText}>{row.todo.text}</span>
                <span className={css.todoMeta}>
                  {row.title === null
                    ? <span className={css.todoMissing}>{t('todos.missingSession')}</span>
                    : (
                      <>
                        <span className={css.todoWorkspace}>{row.workspaceTitle}</span>
                        <span className={css.todoSession}>{row.title}</span>
                        {row.questionText !== null && (
                          <span className={css.todoQuestion} title={row.questionText}>{row.questionText}</span>
                        )}
                      </>
                    )}
                </span>
              </span>
              <span className={css.todoActions}>
                {row.title !== null && row.todo.questionSeq !== null && (
                  <button type="button" className={css.action} onClick={() => { actions.openQuestion(row.todo.sessionId, row.todo.questionSeq as number) }}>
                    {t('todos.jump')}
                  </button>
                )}
                {row.title !== null && row.todo.questionSeq === null && (
                  <button type="button" className={css.action} onClick={() => { actions.openSession(row.todo.sessionId) }}>
                    {t('card.open')}
                  </button>
                )}
                {row.title !== null && row.todo.status === 'open' && (
                  <button type="button" className={css.action} onClick={() => { actions.continueWork(row.todo.sessionId, row.todo.text) }}>
                    {t('todos.continue')}
                  </button>
                )}
                <button type="button" className={css.action} onClick={() => { actions.remove(row.todo.id) }}>
                  {t('todos.remove')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {auto.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionLabel}>
            {t('todos.auto.title')}
            <span className={css.sectionCount}>{auto.length}</span>
          </h3>
          <p className={css.sectionHint}>{t('todos.auto.hint')}</p>
          <ul className={css.todoList}>
            {auto.map(item => (
              <li key={item.sessionId} className={css.todoRow}>
                <span className={clsx(css.badge, css.badgeFailure)}>{t(`outcome.${item.outcome ?? 'open'}`)}</span>
                <span className={css.todoBody}>
                  <span className={css.todoText}>{item.question}</span>
                  <span className={css.todoMeta}>
                    <span className={css.todoWorkspace}>{item.workspaceTitle}</span>
                    <span className={css.todoSession}>{item.title}</span>
                  </span>
                </span>
                <span className={css.todoActions}>
                  <button type="button" className={css.action} onClick={() => { actions.openSession(item.sessionId) }}>
                    {t('card.open')}
                  </button>
                  <button type="button" className={css.action} onClick={() => { actions.continueWork(item.sessionId, null) }}>
                    {t('todos.continue')}
                  </button>
                  <button type="button" className={css.action} onClick={() => { actions.markHandled(item.sessionId) }}>
                    {t('card.handled')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
