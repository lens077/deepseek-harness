import { IconChevronDownOutline14, IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { QuestionEntry } from './turn-summary.ts'
import css from './ChatView.module.css'

export function QuestionNavigator({
  questions, current, hasMore, onPrevious, onNext, t,
}: {
  questions: readonly QuestionEntry[]
  current: number
  hasMore: boolean
  onPrevious: () => void
  onNext: () => void
  t: ChatViewSlotProps['t']
}) {
  // A lone question has nowhere to step, so the rail stays empty rather than
  // showing two permanently disabled arrows.
  if (questions.length <= 1) return null
  return (
    <div className={css.questionNavigator}>
      <button type="button" className={css.questionArrow} disabled={current <= 0 && !hasMore} aria-label={t('chat.questions.previous')} onClick={onPrevious}>
        <IconChevronUpOutline14 />
      </button>
      <button type="button" className={css.questionArrow} disabled={current >= questions.length - 1} aria-label={t('chat.questions.next')} onClick={onNext}>
        <IconChevronDownOutline14 />
      </button>
    </div>
  )
}
