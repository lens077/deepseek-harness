/**
 * Durable, cross-workspace inbox marks: which reply a user has seen, which
 * outcomes they have dealt with, what is snoozed or pinned, and their todos.
 * The Session log records what the agent did; this sidecar records what the
 * user decided about it, so the decision survives refresh, another browser,
 * and a Host restart.
 * @module @deepseek-ai/dsh-session-inbox
 */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { sessionInboxDomainSpec } from './spec.ts'
import type { InboxGlobal, InboxSessionRow, InboxTodoRow } from './spec.ts'
import type {
  InboxAddTodoRequest,
  InboxFailure,
  InboxMarkSeenRequest,
  InboxRejected,
  InboxRemoveTodoRequest,
  InboxSessionState,
  InboxSetHandledRequest,
  InboxSetPinnedRequest,
  InboxSnapshot,
  InboxSnoozeRequest,
  InboxSnoozeResult,
  InboxSuccess,
  InboxTextBlank,
  InboxTextTooLarge,
  InboxTodo,
  InboxTodoId,
  InboxTodoNotFound,
  InboxTodoResult,
  InboxUpdateTodoRequest,
} from './types.ts'

export type * from './types.ts'
export {
  inboxGlobalSchema,
  inboxSessionRowSchema,
  inboxTodoRowSchema,
  sessionInboxDomainSpec,
} from './spec.ts'
export type { InboxGlobal, InboxSessionRow, InboxTodoRow } from './spec.ts'

/** Required deployment policy for todo text. */
export interface Config {
  /** Maximum UTF-8 byte length accepted for one todo's text. */
  readonly maxTextBytes: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionInbox: SessionInboxService
  }
}

/** Validate the one deployment-varying limit at the configuration boundary. */
function resolveMaxTextBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(
      `session-inbox: maxTextBytes must be a positive safe integer, got ${String(value)}`,
    )
  }
  return value
}

/** A Session mark row with nothing marked; never stored, only compared against. */
const BLANK_ROW: Omit<InboxSessionRow, 'updatedAt'> = {
  lastSeenSeq: null,
  handledAt: null,
  snoozedUntil: null,
  pinned: false,
}

/** Whether a row carries no mark at all and can be deleted instead of stored. */
function isBlank(row: Omit<InboxSessionRow, 'updatedAt'>): boolean {
  return row.lastSeenSeq === null
    && row.handledAt === null
    && row.snoozedUntil === null
    && ! row.pinned
}

/** Build a frozen success branch. */
function success<T>(value: T): InboxSuccess<T> {
  return Object.freeze({ ok: true, value })
}

/** Build a frozen business-failure branch. */
function rejected<E extends InboxFailure>(error: E): InboxRejected<E> {
  return Object.freeze({ ok: false, error: Object.freeze(error) })
}

/** Validated text or one explicit request failure. */
type ResolvedText =
  | InboxSuccess<string>
  | InboxRejected<InboxTextBlank | InboxTextTooLarge>

/**
 * Storage-domain sidecar service. It never reads a Session log: a mark on a
 * Session that no longer exists is harmless and is filtered by the consumer
 * that joins marks with the live Session list.
 */
export class SessionInboxService extends TypertRemoteService {
  static inject = ['storageDomain']

  /** Loader validation for the required text-size policy. */
  static Config: s<Config> = s.object({
    maxTextBytes: s.number().step(1).min(1).required(),
  })

  private readonly maxTextBytes: number
  private global?: DomainGlobal<InboxGlobal>
  private sessions?: KvTable<SessionId, InboxSessionRow>
  private todos?: KvTable<InboxTodoId, InboxTodoRow>
  private tail: Promise<void> = Promise.resolve()
  private mutationAdmissionOpen = true

  /**
   * @param ctx - Host context carrying the storage-domain form.
   * @param config - Required text-size policy.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'sessionInbox')
    this.maxTextBytes = resolveMaxTextBytes(config.maxTextBytes)
  }

  /** Open and own the one inbox sidecar domain. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(sessionInboxDomainSpec)
    this.ctx.effect(() => async () => {
      this.mutationAdmissionOpen = false
      await this.tail
      await domain.close()
    }, 'session-inbox.domainClose')
    this.global = domain.global
    this.sessions = domain.table('sessions')
    this.todos = domain.table('todos')
  }

  /**
   * Read the complete inbox state.
   * @returns every Session mark and todo plus the review boundary.
   */
  @Remote('get')
  get(): InboxSnapshot {
    return this.snapshot()
  }

  /**
   * Raise a Session's seen mark to `seq`. A lower or equal seq changes
   * nothing and emits nothing.
   * @param request - Session and the highest seq the user had on screen.
   * @returns the complete state after the change.
   */
  @Remote('markSeen')
  markSeen(request: InboxMarkSeenRequest): Promise<InboxSnapshot> {
    return this.mutate(async () => {
      const current = this.rowOf(request.sessionId)
      if (current.lastSeenSeq !== null && current.lastSeenSeq >= request.seq) return false
      await this.writeRow(request.sessionId, { ...current, lastSeenSeq: request.seq })
      return true
    })
  }

  /**
   * Mark or clear a Session as dealt with.
   * @param request - Session and the desired handled state.
   * @returns the complete state after the change.
   */
  @Remote('setHandled')
  setHandled(request: InboxSetHandledRequest): Promise<InboxSnapshot> {
    return this.mutate(async () => {
      const current = this.rowOf(request.sessionId)
      if ((current.handledAt !== null) === request.handled) return false
      await this.writeRow(request.sessionId, {
        ...current,
        handledAt: request.handled ? Date.now() : null,
      })
      return true
    })
  }

  /**
   * Hide a Session until a future time, or clear its snooze.
   * @param request - Session and the epoch-ms time to resurface it, or `null`.
   * @returns the complete state, or `snooze-in-past` for a time not after now.
   */
  @Remote('snooze')
  snooze(request: InboxSnoozeRequest): Promise<InboxSnoozeResult> {
    if (request.until !== null && request.until <= Date.now()) {
      return Promise.resolve(rejected({ code: 'snooze-in-past', until: request.until }))
    }
    return this.mutate(async () => {
      const current = this.rowOf(request.sessionId)
      if (current.snoozedUntil === request.until) return false
      await this.writeRow(request.sessionId, { ...current, snoozedUntil: request.until })
      return true
    }).then(success)
  }

  /**
   * Pin or unpin a Session.
   * @param request - Session and the desired pinned state.
   * @returns the complete state after the change.
   */
  @Remote('setPinned')
  setPinned(request: InboxSetPinnedRequest): Promise<InboxSnapshot> {
    return this.mutate(async () => {
      const current = this.rowOf(request.sessionId)
      if (current.pinned === request.pinned) return false
      await this.writeRow(request.sessionId, { ...current, pinned: request.pinned })
      return true
    })
  }

  /**
   * Record that the user reviewed the inbox now. The next "since you left"
   * window starts here.
   * @returns the complete state after the change.
   */
  @Remote('markReviewed')
  markReviewed(): Promise<InboxSnapshot> {
    return this.mutate(async () => {
      await this.requireGlobal().set({ reviewedAt: Date.now() })
      return true
    })
  }

  /**
   * Create one todo.
   * @param request - target Session, optional question seq, and text.
   * @returns the complete state, or an explicit text failure.
   */
  @Remote('addTodo')
  addTodo(request: InboxAddTodoRequest): Promise<InboxTodoResult> {
    const text = this.resolveText(request.text)
    if (!text.ok) return Promise.resolve(text)
    return this.mutate(async () => {
      const now = Date.now()
      const id = randomUUID() as InboxTodoId
      await this.requireTodos().put(id, {
        id,
        sessionId: request.sessionId,
        questionSeq: request.questionSeq,
        text: text.value,
        status: 'open',
        createdAt: now,
        updatedAt: now,
        doneAt: null,
      })
      return true
    }).then(success)
  }

  /**
   * Change a todo's text or status. A request that changes nothing is a
   * successful no-op.
   * @param request - todo id and the fields to replace.
   * @returns the complete state, or an explicit failure.
   */
  @Remote('updateTodo')
  updateTodo(request: InboxUpdateTodoRequest): Promise<InboxTodoResult> {
    const text = request.text === undefined ? undefined : this.resolveText(request.text)
    if (text !== undefined && !text.ok) return Promise.resolve(text)
    let failure: InboxRejected<InboxTodoNotFound> | undefined
    return this.mutate(async () => {
      const todos = this.requireTodos()
      const existing = todos.get(request.id)
      if (existing === undefined) {
        failure = rejected({ code: 'todo-not-found', id: request.id })
        return false
      }
      const nextText = text === undefined ? existing.text : text.value
      const nextStatus = request.status ?? existing.status
      if (nextText === existing.text && nextStatus === existing.status) return false
      const now = Date.now()
      await todos.put(request.id, {
        ...existing,
        text: nextText,
        status: nextStatus,
        updatedAt: now,
        doneAt: nextStatus === 'done' ? (existing.doneAt ?? now) : null,
      })
      return true
    }).then(snapshot => failure ?? success(snapshot))
  }

  /**
   * Delete one todo. An absent id is a successful no-op.
   * @param request - todo id.
   * @returns the complete state after the change.
   */
  @Remote('removeTodo')
  removeTodo(request: InboxRemoveTodoRequest): Promise<InboxSnapshot> {
    return this.mutate(() => this.requireTodos().delete(request.id))
  }

  /** The current Session row, or a blank row when nothing is marked. */
  private rowOf(sessionId: SessionId): Omit<InboxSessionRow, 'updatedAt'> {
    return this.requireSessions().get(sessionId) ?? BLANK_ROW
  }

  /** Store a row, or delete it when every mark is cleared. */
  private async writeRow(sessionId: SessionId, row: Omit<InboxSessionRow, 'updatedAt'>): Promise<void> {
    const sessions = this.requireSessions()
    if (isBlank(row)) {
      await sessions.delete(sessionId)
      return
    }
    await sessions.put(sessionId, { ...row, updatedAt: Date.now() })
  }

  /** Assemble the wire snapshot from the durable tables. */
  private snapshot(): InboxSnapshot {
    const sessions: InboxSessionState[] = []
    for (const [sessionId, row] of this.requireSessions().entries()) {
      sessions.push(Object.freeze({ sessionId, ...row }))
    }
    const todos: InboxTodo[] = []
    for (const [, row] of this.requireTodos().entries()) todos.push(Object.freeze({ ...row }))
    todos.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    return Object.freeze({
      reviewedAt: this.requireGlobal().get().reviewedAt,
      sessions: Object.freeze(sessions),
      todos: Object.freeze(todos),
    })
  }

  /**
   * Run one mutation behind every earlier one. The operation returns `true`
   * after writing and `false` when nothing changed; a write publishes the
   * snapshot as `session-inbox/changed` before the same snapshot is returned.
   */
  private mutate(operation: () => Promise<boolean>): Promise<InboxSnapshot> {
    if (!this.mutationAdmissionOpen) {
      return Promise.reject(new Error('session-inbox: service is disposing'))
    }
    const result = this.tail.then(async () => {
      const changed = await operation()
      const snapshot = this.snapshot()
      if (changed) this.ctx.emit('session-inbox/changed', snapshot)
      return snapshot
    })
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  /** Validate the complete UTF-8 byte bound and non-blank semantics of todo text. */
  private resolveText(text: string): ResolvedText {
    if (text.trim().length === 0) return rejected({ code: 'text-blank' })
    const actualBytes = Buffer.byteLength(text, 'utf8')
    if (actualBytes > this.maxTextBytes) {
      return rejected({ code: 'text-too-large', maxBytes: this.maxTextBytes, actualBytes })
    }
    return success(text)
  }

  private requireGlobal(): DomainGlobal<InboxGlobal> {
    if (this.global === undefined) throw new Error('session-inbox: durable domain is not initialized')
    return this.global
  }

  private requireSessions(): KvTable<SessionId, InboxSessionRow> {
    if (this.sessions === undefined) throw new Error('session-inbox: durable domain is not initialized')
    return this.sessions
  }

  private requireTodos(): KvTable<InboxTodoId, InboxTodoRow> {
    if (this.todos === undefined) throw new Error('session-inbox: durable domain is not initialized')
    return this.todos
  }
}

export default SessionInboxService
