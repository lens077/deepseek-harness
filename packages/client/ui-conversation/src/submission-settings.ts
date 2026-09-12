/** Composer keyboard preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'
import { SEND_SHORTCUT_PATTERN } from './send-shortcut.ts'
import type { SendShortcut } from './send-shortcut.ts'

export type { SendShortcut } from './send-shortcut.ts'

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

/** Where a question-navigation shortcut is suppressed: editable regions, text inputs only, or nowhere. */
export type QuestionShortcutFocusPolicy = 'editable' | 'text' | 'always'

/** Which end of the sticky question bar carries the full-text expand toggle. */
export type QuestionBarExpandSide = 'left' | 'right'

/** Expand-toggle placements accepted at settings and input boundaries. */
export const QUESTION_BAR_EXPAND_SIDES = ['left', 'right'] as const satisfies readonly QuestionBarExpandSide[]

/** Durable question-navigation preference: one binding per direction, the focus policy, and the bar's expand-toggle side. */
export interface QuestionNavigationSettings {
  /** Shortcut string for the previous question, in `Modifier+Key` form. */
  previousShortcut: string
  /** Shortcut string for the next question, in `Modifier+Key` form. */
  nextShortcut: string
  /** Focus condition under which both bindings are ignored. */
  focusPolicy: QuestionShortcutFocusPolicy
  /** End of the sticky question bar that carries the full-text expand toggle. */
  expandButtonSide: QuestionBarExpandSide
}

/** Non-macOS defaults; the policy substitutes Meta for Ctrl when the platform is a Mac. */
export const DEFAULT_QUESTION_NAVIGATION_SETTINGS: QuestionNavigationSettings = {
  previousShortcut: 'Ctrl+ArrowUp',
  nextShortcut: 'Ctrl+ArrowDown',
  focusPolicy: 'editable',
  expandButtonSide: 'right',
}

/** Field carrying the conversation content-width mode. */
export const CONTENT_WIDTH_FIELD = 'contentWidth'

/** Content-width modes accepted at settings boundaries: fill the whole
 * content area, or the draggable adaptive width with its side handles. */
export const CONTENT_WIDTH_MODES = ['fill', 'adaptive'] as const

/** How the conversation content column sizes itself. */
export type ContentWidthMode = typeof CONTENT_WIDTH_MODES[number]

/** Default keeps the conversation filling the whole content area. */
export const DEFAULT_CONTENT_WIDTH_MODE: ContentWidthMode = 'fill'

/** Durable conversation section shared by the Host schema and the browser scope. */
export interface ConversationSettings {
  /** Delivery mode for plain Enter while the addressed agent is busy. */
  busyEnter: BusyEnterBehavior
  /** Keyboard gesture required to send a message. */
  sendShortcut: SendShortcut
  /** Conversation content-column sizing mode. */
  contentWidth: ContentWidthMode
  questionNavigation: QuestionNavigationSettings
}

/** Durable conversation schema; also the wire envelope the browser scope validates against. */
export const ConversationSettingsSchema: z<ConversationSettings> = z.object({
  [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR),
  sendShortcut: z.string().pattern(SEND_SHORTCUT_PATTERN).default('enter'),
  [CONTENT_WIDTH_FIELD]: z.union([...CONTENT_WIDTH_MODES]).default(DEFAULT_CONTENT_WIDTH_MODE),
  questionNavigation: z.object({
    previousShortcut: z.string().default(DEFAULT_QUESTION_NAVIGATION_SETTINGS.previousShortcut),
    nextShortcut: z.string().default(DEFAULT_QUESTION_NAVIGATION_SETTINGS.nextShortcut),
    focusPolicy: z.union(['editable', 'text', 'always']).default('editable'),
    expandButtonSide: z.union([...QUESTION_BAR_EXPAND_SIDES]).default(DEFAULT_QUESTION_NAVIGATION_SETTINGS.expandButtonSide),
  }).default(DEFAULT_QUESTION_NAVIGATION_SETTINGS),
})
