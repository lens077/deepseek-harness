import { useEffect, useMemo, useRef, useState } from 'react'
import type { UserMessageNode } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconChevronDownOutline14, IconChevronUpOutline14, IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './ChatView.module.css'

export interface QuestionEntry {
  key: string
  node: UserMessageNode
  text: string
}

function questionText(node: UserMessageNode, imageLabel: string): string {
  const text = node.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
  if (text !== '') return text
  return node.content.some(block => block.type === 'image') ? imageLabel : '—'
}

export function questionEntries(
  order: readonly string[],
  nodeStore: { get: (key: string) => unknown },
  imageLabel: string,
): QuestionEntry[] {
  const entries: QuestionEntry[] = []
  for (const key of order) {
    const candidate = nodeStore.get(key) as { kind?: string; data?: unknown } | undefined
    if (candidate?.kind !== 'user') continue
    const node = candidate.data as UserMessageNode
    entries.push({ key, node, text: questionText(node, imageLabel) })
  }
  return entries
}

function formatTime(time: number): string {
  const date = new Date(time)
  const today = new Date()
  const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  if (date.toDateString() === today.toDateString()) return clock
  const day = new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit' }).format(date).replace('/', '-')
  return `${day} ${clock}`
}

function compactIndexes(current: number, length: number): number[] {
  const start = Math.max(0, Math.min(current - 3, length - 7))
  return Array.from({ length: Math.min(7, length) }, (_, index) => start + index)
}

export function QuestionNavigator({
  questions, current, loadingOlder, hasMore, onPrevious, onNext, onSelect, onLoadAll, t,
}: {
  questions: readonly QuestionEntry[]
  current: number
  loadingOlder: boolean
  hasMore: boolean
  onPrevious: () => void
  onNext: () => void
  onSelect: (index: number) => void
  onLoadAll: () => void
  t: ChatViewSlotProps['t']
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const panelRef = useRef<HTMLDivElement | null>(null)
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (normalized === '') return questions.map((question, index) => ({ question, index }))
    return questions
      .map((question, index) => ({ question, index }))
      .filter(({ question }) => question.text.toLocaleLowerCase().includes(normalized))
  }, [query, questions])

  useEffect(() => {
    if (!open) return
    onLoadAll()
    const onPointer = (event: PointerEvent): void => {
      if (panelRef.current?.contains(event.target as Node) !== true) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => { document.removeEventListener('pointerdown', onPointer) }
  }, [onLoadAll, open])

  if (questions.length === 0) return null
  const compact = compactIndexes(current, questions.length)
  return (
    <div className={css.questionNavigator} ref={panelRef}>
      {open && (
        <div className={css.questionPanel} role="dialog" aria-label={t('chat.questions.history')}>
          <label className={css.questionSearch}>
            <IconSearchOutline16 aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value) }}
              placeholder={t('chat.questions.search')}
              aria-label={t('chat.questions.search')}
            />
          </label>
          {hasMore && (
            <button className={css.questionLoadAll} type="button" disabled={loadingOlder} onClick={onLoadAll}>
              {loadingOlder ? t('loading') : t('chat.questions.loadAll')}
            </button>
          )}
          <div className={css.questionList}>
            {filtered.map(({ question, index }) => (
              <button
                key={question.key}
                type="button"
                className={css.questionRow}
                data-current={index === current || undefined}
                title={question.text}
                onClick={() => { onSelect(index) }}
              >
                <span className={css.questionNumber}>{index + 1}</span>
                <span className={css.questionCopy}>
                  <span>{question.text}</span>
                  <time dateTime={new Date(question.node.time).toISOString()}>{formatTime(question.node.time)}</time>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        className={css.questionCompact}
        data-panel-open={open || undefined}
        aria-label={t('chat.questions.history')}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        {compact.map(index => (
          <span key={index} className={css.questionMark} data-current={index === current || undefined}>
            <span className={css.questionTick} />
            <span className={css.questionDetail} title={questions[index]?.text}>
              {index + 1} · {questions[index]?.text}
            </span>
          </span>
        ))}
      </button>
      {questions.length > 1 && (
        <>
          <button type="button" className={css.questionArrow} disabled={current <= 0 && !hasMore} aria-label={t('chat.questions.previous')} onClick={onPrevious}>
            <IconChevronUpOutline14 />
          </button>
          <button type="button" className={css.questionArrow} disabled={current >= questions.length - 1} aria-label={t('chat.questions.next')} onClick={onNext}>
            <IconChevronDownOutline14 />
          </button>
        </>
      )}
    </div>
  )
}
