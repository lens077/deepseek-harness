/**
 * Public request, value, failure, and event vocabulary of the session inbox.
 * This module contains types only so generated Remote clients and browser
 * plugins consume it without importing Host runtime code.
 * @module @deepseek-ai/dsh-session-inbox/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Opaque identity of one todo item, minted by the Host on creation. */
export type InboxTodoId = Branded<'InboxTodoId'>

/**
 * The user's durable marks on one Session. Every field is a human decision
 * or observation, never a fact about the Session log: the log says what the
 * agent did, this record says what the user has done about it.
 */
export interface InboxSessionState {
  readonly sessionId: SessionId
  /**
   * Highest log seq the user had on screen. A reply whose seq is above this
   * mark is unread; `null` means the Session was never opened through the
   * inbox-aware client.
   */
  readonly lastSeenSeq: number | null
  /** When the user marked the Session's current outcome as dealt with; `null` when open. */
  readonly handledAt: number | null
  /** Hide the Session from the inbox until this epoch-ms time; `null` when not snoozed. */
  readonly snoozedUntil: number | null
  /** Keep the Session at the top of the inbox regardless of state. */
  readonly pinned: boolean
  /** Host-assigned time of the most recent change to this record. */
  readonly updatedAt: number
}

/** Lifecycle of one todo item. */
export type InboxTodoStatus = 'open' | 'done'

/** One todo item pointing at a Session and, optionally, one question inside it. */
export interface InboxTodo {
  readonly id: InboxTodoId
  /** Session the todo is about. */
  readonly sessionId: SessionId
  /** `user/message` seq of the question the todo refers to; `null` for the whole Session. */
  readonly questionSeq: number | null
  /** Todo text, preserved verbatim after validation. */
  readonly text: string
  readonly status: InboxTodoStatus
  /** Host-assigned creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Host-assigned time of the most recent change. */
  readonly updatedAt: number
  /** When the todo was marked done; `null` while open. */
  readonly doneAt: number | null
}

/** The complete inbox state, served whole after every read and mutation. */
export interface InboxSnapshot {
  /** When the user last reviewed the inbox; the default "since you left" boundary. `null` before the first review. */
  readonly reviewedAt: number | null
  /** Every Session carrying at least one mark, in no particular order. */
  readonly sessions: readonly InboxSessionState[]
  /** Every todo, oldest first. */
  readonly todos: readonly InboxTodo[]
}

/** Record that the user had `seq` on screen for a Session. Lower seqs never move the mark down. */
export interface InboxMarkSeenRequest {
  readonly sessionId: SessionId
  readonly seq: number
}

/** Mark or unmark a Session's current outcome as dealt with. */
export interface InboxSetHandledRequest {
  readonly sessionId: SessionId
  readonly handled: boolean
}

/** Hide a Session until `until`, or clear the snooze with `null`. */
export interface InboxSnoozeRequest {
  readonly sessionId: SessionId
  readonly until: number | null
}

/** Pin or unpin a Session. */
export interface InboxSetPinnedRequest {
  readonly sessionId: SessionId
  readonly pinned: boolean
}

/** Create one todo. */
export interface InboxAddTodoRequest {
  readonly sessionId: SessionId
  readonly questionSeq: number | null
  readonly text: string
}

/** Change a todo's text, status, or both. Absent fields keep their value. */
export interface InboxUpdateTodoRequest {
  readonly id: InboxTodoId
  readonly text?: string
  readonly status?: InboxTodoStatus
}

/** Delete one todo; an absent id is a successful no-op. */
export interface InboxRemoveTodoRequest {
  readonly id: InboxTodoId
}

/** The todo text is empty or whitespace. */
export interface InboxTextBlank {
  readonly code: 'text-blank'
}

/** The todo text exceeds the deployment's byte budget. */
export interface InboxTextTooLarge {
  readonly code: 'text-too-large'
  readonly maxBytes: number
  readonly actualBytes: number
}

/** No todo exists with the requested id. */
export interface InboxTodoNotFound {
  readonly code: 'todo-not-found'
  readonly id: InboxTodoId
}

/** The snooze time is not in the future. */
export interface InboxSnoozeInPast {
  readonly code: 'snooze-in-past'
  readonly until: number
}

/** Every business failure the inbox reports. */
export type InboxFailure = InboxTextBlank | InboxTextTooLarge | InboxTodoNotFound | InboxSnoozeInPast

/** Successful branch carrying the value. */
export interface InboxSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejected branch carrying one explicit business failure. */
export interface InboxRejected<E extends InboxFailure> {
  readonly ok: false
  readonly error: E
}

/** Result of a todo creation or update. */
export type InboxTodoResult =
  | InboxSuccess<InboxSnapshot>
  | InboxRejected<InboxTextBlank | InboxTextTooLarge | InboxTodoNotFound>

/** Result of a snooze request. */
export type InboxSnoozeResult =
  | InboxSuccess<InboxSnapshot>
  | InboxRejected<InboxSnoozeInPast>

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The durable inbox state changed through any mutation. Carries the
     * complete snapshot so a consumer replaces its copy instead of merging.
     * @mode emit
     * @param snapshot - the complete inbox state after the change.
     */
    'session-inbox/changed'(snapshot: InboxSnapshot): void
  }
}
