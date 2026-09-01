/**
 * Question-search result state: what the navigator is allowed to tell the reader.
 *
 * The rule this module exists to enforce: an empty result list is only ever
 * shown as "nothing matches" when something actually searched the whole
 * session and reported no match. Every other empty list — no host search
 * composed in, a search still running, a search that failed — is a different
 * state with different copy, because presenting them alike is the view
 * claiming knowledge it does not have.
 *
 * @module
 */

import type { QuestionSearchHit, QuestionSearchPage } from '../contract/question-search.ts'
import type { QuestionEntry } from './turn-summary.ts'

/**
 * What the navigator knows about the current query.
 *
 * `scope` separates the two ways a list can be produced, and it is the field
 * the view must consult before it words an empty list.
 */
export type QuestionSearchState =
  | {
    /** No query typed: the navigator lists the loaded questions as usual. */
    readonly kind: 'idle'
  }
  | {
    /** A whole-session search is in flight; results so far are not an answer. */
    readonly kind: 'searching'
  }
  | {
    /** A whole-session search returned. */
    readonly kind: 'resolved'
    /** Matches to display. */
    readonly hits: readonly QuestionSearchResultRow[]
    /** Whether `hits` is every match in the session. */
    readonly complete: boolean
  }
  | {
    /** The whole-session search failed; the reader is told, never shown an empty list. */
    readonly kind: 'failed'
  }
  | {
    /**
     * No whole-session search is composed in, so only the loaded window was
     * filtered. The displayed matches are real, but their absence proves
     * nothing about the rest of the session, and the view says so.
     */
    readonly kind: 'window-only'
  }

/**
 * One displayable row: a hit resolved against the loaded window where possible.
 *
 * `index` is present when the question is already loaded, which lets the view
 * jump immediately; its absence is what makes the jump a paging operation.
 */
export interface QuestionSearchResultRow {
  /** Seq of the matching user message: the stable address for a jump. */
  readonly seq: number
  /** Unix epoch milliseconds of the matching user message. */
  readonly time: number
  /** Text to display for the match. */
  readonly text: string
  /** Index into the loaded questions, when the question is inside the window. */
  readonly index?: number
}

/**
 * Filter the already-loaded questions.
 *
 * This is the honest half of the old behavior: the same literal,
 * case-insensitive match, but labeled as covering only the loaded window
 * instead of passing for a session-wide answer.
 * @param questions - questions currently in the event window.
 * @param query - raw user text.
 * @returns rows for the loaded questions whose text contains `query`.
 */
export function filterLoadedQuestions(
  questions: readonly QuestionEntry[],
  query: string,
): readonly QuestionSearchResultRow[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized === '') {
    return questions.map((question, index) => rowOf(question, index))
  }
  const rows: QuestionSearchResultRow[] = []
  questions.forEach((question, index) => {
    if (question.text.toLocaleLowerCase().includes(normalized)) rows.push(rowOf(question, index))
  })
  return rows
}

function rowOf(question: QuestionEntry, index: number): QuestionSearchResultRow {
  return { seq: question.node.seq, time: question.node.time, text: question.text, index }
}

/**
 * Resolve host hits against the loaded window.
 *
 * Hits inside the window adopt that question's own display text and index, so
 * an already-visible question reads identically whether it was found locally
 * or remotely; hits outside it keep the host snippet and stay index-less.
 * @param page - one page of host hits.
 * @param questions - questions currently in the event window.
 * @returns display rows in the host's order.
 */
export function resolveHits(
  page: QuestionSearchPage,
  questions: readonly QuestionEntry[],
): readonly QuestionSearchResultRow[] {
  const indexOfSeq = new Map<number, number>()
  questions.forEach((question, index) => { indexOfSeq.set(question.node.seq, index) })
  return page.hits.map((hit: QuestionSearchHit): QuestionSearchResultRow => {
    const index = indexOfSeq.get(hit.seq)
    if (index === undefined) return { seq: hit.seq, time: hit.time, text: hit.snippet }
    return { seq: hit.seq, time: hit.time, text: questions[index]?.text ?? hit.snippet, index }
  })
}
