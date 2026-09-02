/**
 * Browser-local object layer over the Host's durable inbox: the user's seen,
 * handled, snoozed, and pinned marks plus their todos. The Host serves the
 * complete snapshot after every read and mutation and pushes it on
 * `session-inbox/changed`, so this controller only ever replaces its copy —
 * it never merges, and another browser's change lands the same way as its own.
 * @module @deepseek-ai/dsh-client-ui-digest/client/controller
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  InboxAddTodoRequest,
  InboxSnapshot,
  InboxSnoozeResult,
  InboxTodoId,
  InboxTodoResult,
  InboxTodoStatus,
} from '@deepseek-ai/dsh-session-inbox/types'

/**
 * The Remote calls this controller needs. The generated face wraps every
 * business result in {@link RemoteResult}: a carrier failure arrives as the
 * `ok: false` branch rather than a rejection.
 */
export interface InboxRemote {
  get: () => Promise<RemoteResult<InboxSnapshot>>
  markSeen: (request: { sessionId: SessionId; seq: number }) => Promise<RemoteResult<InboxSnapshot>>
  setHandled: (request: { sessionId: SessionId; handled: boolean }) => Promise<RemoteResult<InboxSnapshot>>
  snooze: (request: { sessionId: SessionId; until: number | null }) => Promise<RemoteResult<InboxSnoozeResult>>
  setPinned: (request: { sessionId: SessionId; pinned: boolean }) => Promise<RemoteResult<InboxSnapshot>>
  markReviewed: () => Promise<RemoteResult<InboxSnapshot>>
  addTodo: (request: InboxAddTodoRequest) => Promise<RemoteResult<InboxTodoResult>>
  updateTodo: (request: { id: InboxTodoId; text?: string; status?: InboxTodoStatus }) => Promise<RemoteResult<InboxTodoResult>>
  removeTodo: (request: { id: InboxTodoId }) => Promise<RemoteResult<InboxSnapshot>>
}

/** Load state of the one snapshot read. */
export type InboxStatus = 'cold' | 'loading' | 'ready' | 'error'

/** Immutable view published to every inbox surface. */
export interface InboxView {
  status: InboxStatus
  /** The last snapshot received; empty until the first read lands. */
  snapshot: InboxSnapshot
  /** Reason the last load failed, cleared by the next successful load. */
  error: string | null
}

/** Settled action shape rendered by the surfaces. */
export type InboxActionResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } }

const EMPTY_SNAPSHOT: InboxSnapshot = Object.freeze({
  reviewedAt: null,
  sessions: Object.freeze([]),
  todos: Object.freeze([]),
})

const INITIAL_VIEW: InboxView = Object.freeze({ status: 'cold', snapshot: EMPTY_SNAPSHOT, error: null })

const OK: InboxActionResult = Object.freeze({ ok: true })

const DISPOSED: InboxActionResult = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'disposed', message: 'inbox controller is disposed' }),
})

/**
 * Human-readable text for one business failure code.
 * @param code - the Host's business failure code.
 * @returns a short description for the UI.
 */
function describe(code: string): string {
  switch (code) {
    case 'text-blank': return 'a todo needs some text'
    case 'text-too-large': return 'the todo text is too long'
    case 'todo-not-found': return 'this todo no longer exists'
    case 'snooze-in-past': return 'the snooze time is already past'
    default: return code
  }
}

/**
 * Per-client inbox object layer. One instance backs the sidebar badge, the
 * panel, and the seen-marking subscription.
 */
export class InboxController implements HostObservable<InboxView> {
  private view = INITIAL_VIEW
  private readonly listeners = new Set<() => void>()
  private loadPromise: Promise<InboxActionResult> | null = null
  private disposed = false

  /**
   * @param remote - the sessionInbox Remote namespace.
   */
  constructor(private readonly remote: InboxRemote) {}

  /** Return the cached immutable view. */
  getSnapshot = (): InboxView => this.view

  /** Subscribe to view replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Load once; a failed load stays retryable.
   * @returns the settled load result, shared by concurrent callers.
   */
  ensure(): Promise<InboxActionResult> {
    if (this.view.status === 'ready') return Promise.resolve(OK)
    return this.refresh()
  }

  /**
   * Re-read the authoritative snapshot, collapsing concurrent callers onto one
   * in-flight read.
   * @returns the settled reload result.
   */
  refresh(): Promise<InboxActionResult> {
    if (this.disposed) return Promise.resolve(DISPOSED)
    if (this.loadPromise !== null) return this.loadPromise
    this.publish({ status: 'loading', snapshot: this.view.snapshot, error: null })
    const pending = this.remote.get().then((carried) => {
      if (this.disposed) return DISPOSED
      if (!carried.ok) {
        this.publish({ status: 'error', snapshot: this.view.snapshot, error: carried.error.message })
        return { ok: false, error: { code: carried.error.code, message: carried.error.message } }
      }
      this.receive(carried.value)
      return OK
    })
    this.loadPromise = pending
    return pending.finally(() => { this.loadPromise = null })
  }

  /**
   * Replace the copy with a snapshot the Host published. Used by the forwarded
   * `session-inbox/changed` event and by every mutation reply.
   * @param snapshot - the complete inbox state.
   */
  receive(snapshot: InboxSnapshot): void {
    if (this.disposed) return
    this.publish({ status: 'ready', snapshot, error: null })
  }

  /**
   * Raise a Session's seen mark. Skipped without a call when the known mark
   * already covers `seq`, so a selection subscription can call this freely.
   * @param sessionId - the Session on screen.
   * @param seq - the highest seq shown.
   * @returns the settled result.
   */
  markSeen(sessionId: SessionId, seq: number): Promise<InboxActionResult> {
    const known = this.view.snapshot.sessions.find(row => row.sessionId === sessionId)
    if (known !== undefined && known.lastSeenSeq !== null && known.lastSeenSeq >= seq) return Promise.resolve(OK)
    return this.apply(() => this.remote.markSeen({ sessionId, seq }))
  }

  /**
   * Mark or clear a Session as dealt with.
   * @param sessionId - target Session.
   * @param handled - desired state.
   * @returns the settled result.
   */
  setHandled(sessionId: SessionId, handled: boolean): Promise<InboxActionResult> {
    return this.apply(() => this.remote.setHandled({ sessionId, handled }))
  }

  /**
   * Hide a Session until `until`, or clear the snooze with `null`.
   * @param sessionId - target Session.
   * @param until - epoch ms, or `null`.
   * @returns the settled result.
   */
  snooze(sessionId: SessionId, until: number | null): Promise<InboxActionResult> {
    return this.applyBusiness(() => this.remote.snooze({ sessionId, until }))
  }

  /**
   * Pin or unpin a Session.
   * @param sessionId - target Session.
   * @param pinned - desired state.
   * @returns the settled result.
   */
  setPinned(sessionId: SessionId, pinned: boolean): Promise<InboxActionResult> {
    return this.apply(() => this.remote.setPinned({ sessionId, pinned }))
  }

  /**
   * Record that the user reviewed the inbox now.
   * @returns the settled result.
   */
  markReviewed(): Promise<InboxActionResult> {
    return this.apply(() => this.remote.markReviewed())
  }

  /**
   * Create one todo.
   * @param request - target Session, optional question seq, and text.
   * @returns the settled result.
   */
  addTodo(request: InboxAddTodoRequest): Promise<InboxActionResult> {
    return this.applyBusiness(() => this.remote.addTodo(request))
  }

  /**
   * Change a todo's text or status.
   * @param id - the todo.
   * @param patch - fields to replace.
   * @returns the settled result.
   */
  updateTodo(id: InboxTodoId, patch: { text?: string; status?: InboxTodoStatus }): Promise<InboxActionResult> {
    return this.applyBusiness(() => this.remote.updateTodo({ id, ...patch }))
  }

  /**
   * Delete one todo.
   * @param id - the todo.
   * @returns the settled result.
   */
  removeTodo(id: InboxTodoId): Promise<InboxActionResult> {
    return this.apply(() => this.remote.removeTodo({ id }))
  }

  /** Stop publishing; every later action reports `disposed`. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  /** Run one snapshot-returning Remote call and adopt its reply. */
  private async apply(call: () => Promise<RemoteResult<InboxSnapshot>>): Promise<InboxActionResult> {
    if (this.disposed) return DISPOSED
    const carried = await call()
    if (!carried.ok) return { ok: false, error: { code: carried.error.code, message: carried.error.message } }
    this.receive(carried.value)
    return OK
  }

  /** Run one Remote call whose value is itself a business result. */
  private async applyBusiness(
    call: () => Promise<RemoteResult<InboxTodoResult | InboxSnoozeResult>>,
  ): Promise<InboxActionResult> {
    if (this.disposed) return DISPOSED
    const carried = await call()
    if (!carried.ok) return { ok: false, error: { code: carried.error.code, message: carried.error.message } }
    const result = carried.value
    if (!result.ok) return { ok: false, error: { code: result.error.code, message: describe(result.error.code) } }
    this.receive(result.value)
    return OK
  }

  private publish(view: InboxView): void {
    this.view = Object.freeze(view)
    for (const listener of this.listeners) listener()
  }
}
