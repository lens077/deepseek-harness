/**
 * Function plugin registering the `sessionDigest` projection unit: the newest
 * direct human question, the closing assistant answer to it, and that turn's
 * terminal reason, the files it changed, and the bounded question history,
 * served through the session-projection seam so a client can
 * summarize finished work across every workspace without opening a session or
 * spending a model call. The plugin owns only the fold; delivery is the seam's.
 *
 * @module @deepseek-ai/dsh-session-digest
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createSessionDigestProjectionDefinition } from './projection.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'session-digest'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Retained-text budgets. The value rides every `session.list` row, so these
 * bound the listing payload rather than the durable log: a consumer reads the
 * complete message through `session.history` when the user expands an entry.
 * Invalid values fail plugin load.
 */
export interface Config {
  /** Maximum retained question characters. Omit for 400. */
  questionChars?: number
  /** Maximum retained answer characters. Omit for 1200. */
  replyChars?: number
  /** Maximum retained changed-file paths of the current question. Omit for 8. */
  changedFilePaths?: number
  /** Maximum retained earlier questions. Omit for 30. */
  historyQuestions?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  questionChars: z.number(),
  replyChars: z.number(),
  changedFilePaths: z.number(),
  historyQuestions: z.number(),
})

/** Retained question characters when the deployment sets none. */
const DEFAULT_QUESTION_CHARS = 400
/** Retained answer characters when the deployment sets none. */
const DEFAULT_REPLY_CHARS = 1200
/** Retained changed-file paths when the deployment sets none. */
const DEFAULT_CHANGED_FILE_PATHS = 8
/** Retained earlier questions when the deployment sets none. */
const DEFAULT_HISTORY_QUESTIONS = 30

/**
 * Register the `sessionDigest` unit; the registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 * @param config - retained-text budgets.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const budgets = {
    questionChars: config.questionChars ?? DEFAULT_QUESTION_CHARS,
    replyChars: config.replyChars ?? DEFAULT_REPLY_CHARS,
    changedFilePaths: config.changedFilePaths ?? DEFAULT_CHANGED_FILE_PATHS,
    historyQuestions: config.historyQuestions ?? DEFAULT_HISTORY_QUESTIONS,
  }
  for (const key of ['questionChars', 'replyChars', 'changedFilePaths', 'historyQuestions'] as const) {
    if (!Number.isInteger(budgets[key]) || budgets[key] < 1) {
      throw new Error(`session-digest: ${key} must be a positive integer, got ${String(config[key])}`)
    }
  }
  ctx.sessionProjections.register(createSessionDigestProjectionDefinition(budgets))
}
