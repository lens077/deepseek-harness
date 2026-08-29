/** Busy-Enter preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the conversation plugin. */
export const CONVERSATION_SETTINGS_NAMESPACE = 'ui-conversation'

/** Field carrying the delivery mode for plain Enter while an agent is busy. */
export const BUSY_ENTER_FIELD = 'busyEnter'

/** Busy-Enter behaviors accepted at settings and input boundaries. */
export const BUSY_ENTER_BEHAVIORS = ['queue', 'steer'] as const

/** Configurable meaning of plain Enter while the addressed agent is busy. */
export type BusyEnterBehavior = typeof BUSY_ENTER_BEHAVIORS[number]

/** Default preserves Enter-as-Queue for running conversations. */
export const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior = 'queue'

export type QuestionShortcutFocusPolicy = 'editable' | 'text' | 'always'

export interface QuestionNavigationSettings {
  previousShortcut: string
  nextShortcut: string
  focusPolicy: QuestionShortcutFocusPolicy
}

export const DEFAULT_QUESTION_NAVIGATION_SETTINGS: QuestionNavigationSettings = {
  previousShortcut: 'Ctrl+ArrowUp',
  nextShortcut: 'Ctrl+ArrowDown',
  focusPolicy: 'editable',
}

/** Durable conversation section shared by the Host schema and the browser scope. */
export interface ConversationSettings {
  /** Delivery mode for plain Enter while the addressed agent is busy. */
  busyEnter: BusyEnterBehavior
  questionNavigation: QuestionNavigationSettings
}

/** Durable conversation schema; also the wire envelope the browser scope validates against. */
export const ConversationSettingsSchema: z<ConversationSettings> = z.object({
  [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR),
  questionNavigation: z.object({
    previousShortcut: z.string().default(DEFAULT_QUESTION_NAVIGATION_SETTINGS.previousShortcut),
    nextShortcut: z.string().default(DEFAULT_QUESTION_NAVIGATION_SETTINGS.nextShortcut),
    focusPolicy: z.union(['editable', 'text', 'always']).default('editable'),
  }).default(DEFAULT_QUESTION_NAVIGATION_SETTINGS),
})
