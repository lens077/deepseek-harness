/**
 * Public types of the `sessionDigest` projection: the latest human question,
 * the assistant's closing answer to it, how that turn ended, the files it
 * changed, and a bounded history of the questions before it.
 *
 * This module also declares the client-visible `SessionProjectionMap` key. It
 * imports only the projection package's pure-type outlet, so a browser program
 * can merge the key without pulling the host `Context` chain behind the
 * package root.
 *
 * @module @deepseek-ai/dsh-session-digest/types
 */

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Newest human question, the closing assistant answer, that turn's
     * outcome, and the bounded question history. Present on `session.history`
     * tail pages, `session/projection` frames, and every `session.list` row
     * (cold rows through the persisted projection cache), which is what lets a
     * cross-workspace digest surface finished work without opening each
     * session.
     */
    sessionDigest: SessionDigestView
  }
}

/**
 * How the turn carrying a question ended, mirroring the core
 * `TurnEndReason` discriminants. `null` means no `turn/end` has closed the
 * question yet — the work is still open, or the question is the newest event
 * in the log.
 */
export type SessionDigestOutcome =
  | 'completed'
  | 'error'
  | 'aborted'
  | 'blocked'
  | 'max-tokens'
  | 'interrupted'

/**
 * One earlier question of the session, kept so a timeline can place the
 * session's work on the days it happened. Carries no answer text: the answer
 * of an earlier question is read through `session.history` on demand.
 */
export interface SessionDigestQuestion {
  /** Log seq of the `user/message` that asked it; the address a todo or jump uses. */
  seq: number
  /** Event time of the question, Unix epoch ms. */
  at: number
  /** Question text cut to the configured budget. */
  text: string
  /** Whether {@link SessionDigestQuestion.text} was cut. */
  truncated: boolean
  /** Terminal reason of the answering turn; `null` when a later question opened before it closed. */
  outcome: SessionDigestOutcome | null
  /** Event time of the last assistant message answering it; `null` without one. */
  repliedAt: number | null
  /** Number of distinct files the answering turn changed. */
  changedFileCount: number
}

/**
 * One session's digest value: the newest direct human prompt, the closing
 * assistant message of the same turn, and the questions before it.
 *
 * Both texts are capped by the plugin's configured character budgets because
 * this value rides every `session.list` row; the matching `*Truncated` flag
 * tells a consumer that the durable log holds more, which it reads through
 * `session.history` when the user expands the entry.
 */
export interface SessionDigestView {
  /** Newest `source.kind === 'user'` prompt text; `null` before the first one. */
  question: string | null
  /** Whether {@link SessionDigestView.question} was cut to the configured budget. */
  questionTruncated: boolean
  /** Log seq of the newest question's `user/message`; `null` before the first one. */
  questionSeq: number | null
  /** Event time of the newest question, Unix epoch ms; `null` before the first one. */
  questionAt: number | null
  /**
   * Closing assistant message of the turn answering {@link SessionDigestView.question}:
   * last write wins within the turn, so a multi-step turn keeps the summary the
   * model wrote after its tool work rather than an intermediate step.
   */
  reply: string | null
  /** Whether {@link SessionDigestView.reply} was cut to the configured budget. */
  replyTruncated: boolean
  /** Terminal reason of the current question's turn; `null` while it is still open. */
  outcome: SessionDigestOutcome | null
  /** Log seq of the retained assistant message, for an exact on-demand full read; `null` without one. */
  replySeq: number | null
  /** Event time of the retained assistant message; `null` without one. */
  repliedAt: number | null
  /**
   * Distinct file paths the current question's turn changed, as the mutation
   * tools recorded them, cut to the configured list budget with
   * {@link SessionDigestView.changedFileCount} carrying the full count.
   */
  changedFiles: string[]
  /** Number of distinct files the current question's turn changed. */
  changedFileCount: number
  /** Earlier questions, oldest first, bounded by the configured history budget. */
  history: SessionDigestQuestion[]
}
