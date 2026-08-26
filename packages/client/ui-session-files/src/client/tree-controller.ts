/**
 * Descendant-session reader for the file rail.
 *
 * A subagent works in its own session, so the parent's own log answers nothing
 * about what a delegated turn changed. This controller walks the durable child
 * catalog (`subagent.list`) and reads each child's transcript
 * (`subagent.history`), which serves live and cold children alike and carries
 * the same render intents the local snapshot holds.
 *
 * Two depths, one switch. Opening the panel takes the shallow read — the first
 * level of finished children, one page each — because a tree can be wide and a
 * panel that opens should not fan out. `Load all` takes the deep read: every
 * page of every descendant, recursing while the catalog reports children.
 * @module
 */

import {
  createSnapshotStore, type SessionId, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  deriveTreeFiles, type TreeFileChange, type TreeHistoryEntry, type TreeSource,
} from './tree-files.ts'

/** Messages requested per history page. */
const PAGE_MESSAGES = 200

/** Pages read for one descendant in the deep pass before the walk gives up. */
const MAX_PAGES = 50

export type { TreeSource } from './tree-files.ts'

/** What the rail knows about one session's descendants. */
export interface SessionTreeEntry {
  readonly status: 'loading' | 'ready' | 'error'
  readonly sources: readonly TreeSource[]
  /** Whether descendant history remains unread — a shallow pass, or a page cap. */
  readonly partial: boolean
  readonly error: string | null
}

/** Descendant reads keyed by the session whose panel asked for them. */
export interface SessionTreeState {
  bySession: Record<string, SessionTreeEntry | undefined>
}

/** The two catalog row shapes this walk distinguishes. */
type CatalogEntry =
  | {
    kind: 'child'
    id: SessionId
    mode: 'one-shot' | 'continuable'
    activity: 'running' | 'inactive'
    hasChildren: boolean
    label?: string
  }
  | { kind: 'diagnostic'; id: SessionId; reason: string }

interface RpcResult<T> { readonly ok: boolean; readonly value: T; readonly error?: { message?: string } }

/** The subagent RPCs this controller uses, structurally. */
export interface SubagentApi {
  list(
    request: { parentSessionId: SessionId },
    signal?: AbortSignal,
  ): Promise<{ result: RpcResult<{ entries: readonly CatalogEntry[] }> }>
  history(
    request: {
      parentSessionId: SessionId
      childSessionId: SessionId
      mode: 'one-shot' | 'continuable'
      beforeSeq?: number
      maxMessages?: number
    },
    signal?: AbortSignal,
  ): Promise<{ result: RpcResult<{ events: readonly TreeHistoryEntry[]; hasMore: boolean }> }>
}

const INITIAL: SessionTreeState = { bySession: {} }

/** Reads descendant sessions and publishes what they changed. */
export class SessionTreeController {
  /** uSES-safe source the rail reads for descendant changes. */
  readonly store: SnapshotStore<SessionTreeState> = createSnapshotStore(INITIAL)

  private readonly inflight = new Map<string, Promise<void>>()
  private readonly aborts = new Set<AbortController>()
  private disposed = false

  /** @param api - the subagent RPC surface, from the connection's api client. */
  constructor(private readonly api: SubagentApi) {}

  /**
   * Read one session's descendants and publish their changes.
   *
   * Concurrent requests for the same session and depth share one operation, and
   * a deep request supersedes a shallow one already published.
   * @param sessionId - the session whose panel is open.
   * @param deep - whether to recurse the whole tree and page each descendant fully.
   * @returns after the read settles; a post-disposal call resolves immediately.
   */
  refresh(sessionId: SessionId, deep: boolean): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const key = `${sessionId}:${deep ? 'deep' : 'shallow'}`
    const existing = this.inflight.get(key)
    if (existing !== undefined) return existing
    const operation = this.run(sessionId, deep).finally(() => { this.inflight.delete(key) })
    this.inflight.set(key, operation)
    return operation
  }

  /**
   * Abort every in-flight read and reach quiescence.
   * @returns after every active operation settles.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    for (const abort of this.aborts) abort.abort()
    await Promise.allSettled([...this.inflight.values()])
  }

  private async run(sessionId: SessionId, deep: boolean): Promise<void> {
    const abort = new AbortController()
    this.aborts.add(abort)
    this.publish(sessionId, { status: 'loading', sources: this.sourcesOf(sessionId), partial: true, error: null })
    try {
      const sources: TreeSource[] = []
      const partial = await this.walk(sessionId, sessionId, deep, sources, abort.signal, [])
      this.publish(sessionId, { status: 'ready', sources, partial, error: null })
    } catch (error: unknown) {
      if (abort.signal.aborted) return
      this.publish(sessionId, {
        status: 'error',
        sources: this.sourcesOf(sessionId),
        partial: true,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      this.aborts.delete(abort)
    }
  }

  /**
   * Walk one parent's catalog, reading each usable child and recursing.
   * @returns whether anything was left unread.
   */
  private async walk(
    root: SessionId,
    parentSessionId: SessionId,
    deep: boolean,
    into: TreeSource[],
    signal: AbortSignal,
    ancestry: readonly string[],
  ): Promise<boolean> {
    const { result } = await this.api.list({ parentSessionId }, signal)
    if (!result.ok) throw new Error(result.error?.message ?? 'subagent.list failed')
    let partial = false
    for (const [index, entry] of result.value.entries.entries()) {
      if (entry.kind !== 'child') { partial = true; continue }
      // A shallow pass reads finished children only: a running one is still
      // writing, and its page would be stale before the panel drew it.
      if (!deep && entry.activity === 'running') { partial = true; continue }
      const name = [...ancestry, entry.label ?? `#${index + 1}`].join(' / ')
      const read = await this.readChild(parentSessionId, entry, name, deep, signal)
      partial = partial || read.partial
      if (read.files.length > 0) into.push({ sessionId: entry.id, label: name, files: read.files })
      if (!entry.hasChildren) continue
      if (!deep) { partial = true; continue }
      partial = await this.walk(root, entry.id, deep, into, signal, [...ancestry, name]) || partial
    }
    return partial
  }

  /** Read one child's transcript, one page shallow or every page deep. */
  private async readChild(
    parentSessionId: SessionId,
    entry: Extract<CatalogEntry, { kind: 'child' }>,
    source: string,
    deep: boolean,
    signal: AbortSignal,
  ): Promise<{ files: readonly TreeFileChange[]; partial: boolean }> {
    const collected: TreeHistoryEntry[] = []
    let beforeSeq: number | undefined
    let pages = 0
    for (;;) {
      const { result } = await this.api.history({
        parentSessionId,
        childSessionId: entry.id,
        mode: entry.mode,
        maxMessages: PAGE_MESSAGES,
        ...beforeSeq === undefined ? {} : { beforeSeq },
      }, signal)
      if (!result.ok) throw new Error(result.error?.message ?? 'subagent.history failed')
      collected.unshift(...result.value.events)
      pages++
      if (!result.value.hasMore) return { files: deriveTreeFiles(collected, source), partial: false }
      if (!deep || pages >= MAX_PAGES) return { files: deriveTreeFiles(collected, source), partial: true }
      const oldest = result.value.events[0]?.event.seq
      // No older anchor means the page carried nothing to page before.
      if (oldest === undefined) return { files: deriveTreeFiles(collected, source), partial: true }
      beforeSeq = oldest
    }
  }

  private sourcesOf(sessionId: SessionId): readonly TreeSource[] {
    return this.store.getSnapshot().bySession[String(sessionId)]?.sources ?? []
  }

  private publish(sessionId: SessionId, entry: SessionTreeEntry): void {
    this.store.update((state) => {
      state.bySession = { ...state.bySession, [String(sessionId)]: entry }
    })
  }
}
