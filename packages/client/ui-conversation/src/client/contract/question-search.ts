/**
 * Within-session question search: the presentation-side view of the host's
 * lightweight question index.
 *
 * The conversation view can only filter the questions its event window has
 * already loaded. That window is a suffix of the session, so a filter over it
 * answers "no match" for text that exists earlier in the same session — a
 * wrong answer that looks exactly like a right one. This contract exists so
 * the view can instead ask the host, which searches the whole session.
 *
 * The types carry question text and a jump target, never message bodies, tool
 * calls, or images: a hit is a bounded snippet plus the `seq` that addresses
 * its user message.
 *
 * @module
 */

/**
 * One question that matched, addressed by the seq of its user message.
 *
 * `seq` is the same coordinate the conversation window pages on, so a hit
 * outside the loaded window names exactly how far back the view must page to
 * reach it.
 */
export interface QuestionSearchHit {
  /** Seq of the matching `user/message` event within its session. */
  readonly seq: number
  /** Unix epoch milliseconds of the matching user message. */
  readonly time: number
  /** Bounded plain-text excerpt of the question, never a full message body. */
  readonly snippet: string
}

/**
 * One page of question hits.
 *
 * `complete` is the honesty bit. The view may only report "no earlier
 * question matches" when the host searched the whole session and said so;
 * when the host truncated the result, the view must say the list is partial
 * rather than present it as everything.
 */
export interface QuestionSearchPage {
  /** Matching questions, newest-relevant order as returned by the host. */
  readonly hits: readonly QuestionSearchHit[]
  /**
   * Whether these hits are every match in the session.
   *
   * False when the host stopped at its page limit and more matches exist.
   */
  readonly complete: boolean
}

/**
 * Search the whole session's questions, not just the loaded window.
 *
 * Implementations reject on transport and host failure; the view distinguishes
 * a failed search from an empty one, because only the second means "no match".
 * @param query - non-empty user text, interpreted as data and never as query syntax.
 * @param signal - aborts a superseded search when the user keeps typing.
 * @returns one bounded page of hits with its completeness flag.
 */
export type SearchQuestions = (query: string, signal?: AbortSignal) => Promise<QuestionSearchPage>
