/**
 * In-process lease table over file identities. One exclusive lease per key is
 * shared by every session of one runtime family (a root agent and the agents
 * it owns) and is freed when its last holder releases; waiting writers queue
 * FIFO and waiting readers are all woken before the next writer is granted.
 * The table performs no I/O and knows nothing about tools or sessions beyond
 * their ids, so the policy plugin owns every message and event.
 * @module @deepseek-ai/dsh-tool-call-file-lock/registry
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The identity a lease is granted to: the exact session plus its runtime family root. */
export interface LeaseHolder {
  /** Session whose turn end releases its share of the lease. */
  readonly session: SessionId
  /** Root session of the runtime family; leases are foreign across families only. */
  readonly family: SessionId
}

/** One live exclusive lease. */
export interface Lease {
  /** Stable file identity the lease covers. */
  readonly key: string
  /** Display path recorded at the first acquisition. */
  readonly path: string
  /** Family every holder belongs to. */
  readonly family: SessionId
  /** Session that first took the lease; the one shown as the holder. */
  readonly owner: SessionId
  /** Sessions of the family sharing the lease; the lease frees when this empties. */
  readonly holders: Set<SessionId>
  /** Epoch milliseconds of the first acquisition. */
  readonly since: number
}

/** How a wait for a lease ended. */
export type WaitOutcome = 'acquired' | 'free' | 'timeout' | 'aborted'

/** One pending writer or reader. */
interface Waiter {
  readonly family: SessionId
  readonly settle: (outcome: WaitOutcome) => void
}

/** Registry options fixed at construction. */
export interface FileLockRegistryOptions {
  /** Milliseconds after `since` at which a lease is released regardless of its turn, read at each grant; `0` disables. */
  readonly leaseTtlMs: () => number
  /** Called after a TTL release with the released lease. */
  readonly onExpire: (lease: Lease) => void
  /** Clock used for `since`; injectable for tests. */
  readonly now?: () => number
}

/** A pending wait, its cancellation, and its deadline as one settled unit; every settle path detaches the others first. */
class PendingWait {
  readonly promise: Promise<WaitOutcome>
  private resolve!: (outcome: WaitOutcome) => void
  private readonly timer: ReturnType<typeof setTimeout> | undefined
  private readonly onAbort = (): void => { this.settle('aborted') }

  constructor(
    private readonly signal: AbortSignal,
    waitMs: number | undefined,
    private readonly detach: () => void,
  ) {
    this.promise = new Promise<WaitOutcome>((resolve) => { this.resolve = resolve })
    signal.addEventListener('abort', this.onAbort, { once: true })
    this.timer = waitMs === undefined ? undefined : setTimeout(() => { this.settle('timeout') }, waitMs)
  }

  /** Settle: detach the abort listener and deadline, leave the queue, and resolve. */
  settle(outcome: WaitOutcome): void {
    this.signal.removeEventListener('abort', this.onAbort)
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.detach()
    this.resolve(outcome)
  }
}

/** The lease table plus its two wait queues per key. */
export class FileLockRegistry {
  private readonly leases = new Map<string, Lease>()
  private readonly writers = new Map<string, Waiter[]>()
  private readonly readers = new Map<string, Waiter[]>()
  private readonly ttlTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly now: () => number

  constructor(private readonly options: FileLockRegistryOptions) {
    this.now = options.now ?? Date.now
  }

  /**
   * The lease on `key` held by a different family, if any.
   * @param key - file identity.
   * @param family - the asking family.
   * @returns the foreign lease, or undefined when the key is free or leased by `family`.
   */
  foreignLease(key: string, family: SessionId): Lease | undefined {
    const lease = this.leases.get(key)
    return lease === undefined || lease.family === family ? undefined : lease
  }

  /**
   * Take or join the exclusive lease on `key`, waiting up to `waitMs` for a
   * foreign lease to free. A family already leasing the key joins immediately.
   * @param key - file identity.
   * @param path - display path recorded when the lease is created.
   * @param holder - the acquiring session and its family.
   * @param signal - abandons the wait when aborted.
   * @param waitMs - maximum wait for a foreign lease.
   * @returns `acquired`, or `timeout`/`aborted` when the lease was not obtained.
   */
  acquire(key: string, path: string, holder: LeaseHolder, signal: AbortSignal, waitMs: number): Promise<WaitOutcome> {
    const lease = this.leases.get(key)
    if (lease === undefined || lease.family === holder.family) {
      this.grant(key, path, holder)
      return Promise.resolve('acquired')
    }
    if (signal.aborted) return Promise.resolve('aborted')
    const queue = this.queue(this.writers, key)
    const waiter: Waiter = {
      family: holder.family,
      settle: (outcome) => {
        if (outcome === 'acquired') this.grant(key, path, holder)
        pending.settle(outcome)
      },
    }
    const pending = new PendingWait(signal, waitMs, () => { this.dequeue(this.writers, key, queue, waiter) })
    queue.push(waiter)
    return pending.promise
  }

  /**
   * Wait until no foreign lease covers `key`. Resolves immediately when the
   * key is free or leased by `family`.
   * @param key - file identity.
   * @param family - the reading family.
   * @param signal - abandons the wait when aborted.
   * @param waitMs - maximum wait; omit for an unbounded subscription.
   * @returns `free`, or `timeout`/`aborted` when the wait ended first.
   */
  awaitRelease(key: string, family: SessionId, signal: AbortSignal, waitMs?: number): Promise<WaitOutcome> {
    if (signal.aborted) return Promise.resolve('aborted')
    if (this.foreignLease(key, family) === undefined) return Promise.resolve('free')
    const queue = this.queue(this.readers, key)
    const waiter: Waiter = { family, settle: (outcome) => { pending.settle(outcome) } }
    const pending = new PendingWait(signal, waitMs, () => { this.dequeue(this.readers, key, queue, waiter) })
    queue.push(waiter)
    return pending.promise
  }

  /**
   * Release `session`'s share of every lease it holds.
   * @param session - the releasing session.
   * @returns display paths whose lease became free.
   */
  releaseAll(session: SessionId): string[] {
    const freed: string[] = []
    for (const lease of [...this.leases.values()]) {
      if (!lease.holders.delete(session)) continue
      if (lease.holders.size > 0) continue
      this.free(lease)
      freed.push(lease.path)
    }
    return freed
  }

  /**
   * Every live lease, in acquisition order.
   * @returns a fresh array; the leases themselves are the live records.
   */
  snapshot(): Lease[] {
    return [...this.leases.values()]
  }

  /** Cancel every TTL timer and settle every waiter as aborted; used at disposal. */
  dispose(): void {
    for (const timer of this.ttlTimers.values()) clearTimeout(timer)
    this.ttlTimers.clear()
    for (const queue of [...this.writers.values(), ...this.readers.values()]) {
      for (const waiter of [...queue]) waiter.settle('aborted')
    }
    this.leases.clear()
  }

  private grant(key: string, path: string, holder: LeaseHolder): void {
    const existing = this.leases.get(key)
    if (existing !== undefined) {
      existing.holders.add(holder.session)
      return
    }
    const lease: Lease = {
      key, path, family: holder.family, owner: holder.session,
      holders: new Set([holder.session]), since: this.now(),
    }
    this.leases.set(key, lease)
    const ttlMs = this.options.leaseTtlMs()
    if (ttlMs > 0) {
      // `free` clears this timer, so a firing timer always finds its own lease live.
      const timer = setTimeout(() => {
        this.ttlTimers.delete(key)
        this.free(lease)
        this.options.onExpire(lease)
      }, ttlMs)
      timer.unref()
      this.ttlTimers.set(key, timer)
    }
  }

  /** Drop the lease and wake its waiters: every reader first, then the first writer. */
  private free(lease: Lease): void {
    this.leases.delete(lease.key)
    const timer = this.ttlTimers.get(lease.key)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.ttlTimers.delete(lease.key)
    }
    for (const reader of [...this.readers.get(lease.key) ?? []]) reader.settle('free')
    const writer = this.writers.get(lease.key)?.[0]
    if (writer !== undefined) writer.settle('acquired')
  }

  private queue(table: Map<string, Waiter[]>, key: string): Waiter[] {
    let queue = table.get(key)
    if (queue === undefined) {
      queue = []
      table.set(key, queue)
    }
    return queue
  }

  /** Remove a waiter that settles exactly once from the queue it was pushed to. */
  private dequeue(table: Map<string, Waiter[]>, key: string, queue: Waiter[], waiter: Waiter): void {
    queue.splice(queue.indexOf(waiter), 1)
    if (queue.length === 0) table.delete(key)
  }
}
