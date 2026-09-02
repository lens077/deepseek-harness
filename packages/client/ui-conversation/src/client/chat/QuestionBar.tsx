// The two surfaces that restate a question beside its answer, so a reader who
// has scrolled past the opening message still knows what is being answered.
// The navigator beside the transcript answers "take me somewhere else"; these
// answer "what am I reading", which is what a long turn takes away.
//
// QuestionBar follows the reader continuously and renders in a zero-height
// sticky dock, so it costs the flow no height: the chat view's follow and
// paging logic measures `scrollHeight`, and a bar in the flow would move that
// number every time it appeared. TurnRecapRow is ordinary flow content at the
// end of a long completed turn, where the reader's eye already is when the
// answer lands.

import { useEffect, useState } from 'react'
import { IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatTurnFileChange, ChatViewSlotProps } from '../contract/slots.ts'
import type { TurnOutcome, TurnRecap, TurnSummary } from './turn-summary.ts'
import { formatRunDuration } from './message-chrome.ts'
import css from './ChatView.module.css'

/** Locale key carrying each outcome's badge word. */
const OUTCOME_KEY = {
  running: 'chat.questionBar.outcome.running',
  completed: 'chat.questionBar.outcome.completed',
  stopped: 'chat.questionBar.outcome.stopped',
  failed: 'chat.questionBar.outcome.failed',
  other: 'chat.questionBar.outcome.other',
} as const satisfies Record<TurnOutcome, string>

/** Live clock for an open turn; a settled turn reports its recorded span once. */
function useElapsedMs(summary: TurnSummary | null): number | null {
  const running = summary?.outcome === 'running'
  const start = summary?.startTime ?? null
  const end = summary?.endTime ?? null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(id) }
  }, [running])
  if (start === null) return null
  return Math.max(0, (end ?? now) - start)
}

/** Full file list for the chip's tooltip, one path and its line totals per line. */
function fileTitle(files: readonly ChatTurnFileChange[]): string {
  return files.map(file => `${file.path}  +${file.additions} -${file.deletions}`).join('\n')
}

/**
 * Render the current question's summary bar.
 * @param props - the current question, its turn summary, that turn's changed files, and the jump action.
 * @returns the bar, or null when there is no question to report.
 */
export function QuestionBar({
  text, number, summary, files, filesKnown, onSelect, t,
}: {
  /** The current question's display text. */
  text: string
  /** 1-based position in the loaded question index, matching the navigator's numbering. */
  number: number
  /** The turn that answered it, or null when no turn has started for it yet. */
  summary: TurnSummary | null
  /** Files that turn changed, empty when it changed none or no provider is composed in. */
  files: readonly ChatTurnFileChange[]
  /** Whether a file provider answered at all; false suppresses the chip rather than claiming zero. */
  filesKnown: boolean
  /** Scroll the transcript to this question. */
  onSelect: () => void
  /** The owning view's locale seat. */
  t: ChatViewSlotProps['t']
}) {
  const elapsedMs = useElapsedMs(summary)
  const outcome = summary?.outcome ?? null
  return (
    // Not a live region: the transcript already carries this question, and the
    // turn-status row owns the session's one `role="status"`. The bar is a
    // visual shortcut whose semantics live on its button.
    <div className={css.questionBar} data-question-bar="">
      <button
        type="button"
        className={css.questionBarMain}
        title={text}
        aria-label={`${t('chat.questionBar.label')}: ${text} — ${t('chat.questionBar.jump')}`}
        onClick={onSelect}
      >
        <span className={css.questionBarNumber}>#{number}</span>
        <span className={css.questionBarText}>{text}</span>
      </button>
      <span className={css.questionBarMeta}>
        {filesKnown && files.length > 0 && (
          <span className={css.questionBarFiles} title={fileTitle(files)}>
            {t('chat.questionBar.files', { count: String(files.length) })}
          </span>
        )}
        {outcome !== null && (
          <span className={css.questionBarOutcome} data-outcome={outcome}>
            {t(OUTCOME_KEY[outcome])}
          </span>
        )}
        {elapsedMs !== null && (
          <span className={css.questionBarClock}>{formatRunDuration(elapsedMs, t)}</span>
        )}
      </span>
    </div>
  )
}

/**
 * Render one completed long turn's restatement of the question it answered.
 * @param props - the recap text and the jump back to its question.
 * @returns the recap row.
 */
export function TurnRecapRow({ recap, onSelect, t }: {
  /** The question this turn answered, as the chat view resolved it. */
  recap: TurnRecap
  /** Scroll the transcript to that question. */
  onSelect: () => void
  /** The owning view's locale seat. */
  t: ChatViewSlotProps['t']
}) {
  return (
    <button
      type="button"
      className={css.turnRecap}
      data-turn-recap=""
      title={recap.text}
      aria-label={`${t('chat.turnRecap.label')}: ${recap.text} — ${t('chat.questionBar.jump')}`}
      onClick={onSelect}
    >
      <IconChevronUpOutline14 className={css.turnRecapIcon} aria-hidden="true" />
      <span className={css.turnRecapLabel}>{t('chat.turnRecap.label')}</span>
      <span className={css.questionBarNumber}>#{recap.number}</span>
      <span className={css.turnRecapText}>{recap.text}</span>
    </button>
  )
}
