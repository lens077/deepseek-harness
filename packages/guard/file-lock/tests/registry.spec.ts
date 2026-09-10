import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { FileLockRegistry, type Lease, type LeaseHolder } from '@deepseek-ai/dsh-tool-call-file-lock'

const A: LeaseHolder = { session: SessionId('a'), family: SessionId('a') }
const A_CHILD: LeaseHolder = { session: SessionId('a-child'), family: SessionId('a') }
const B: LeaseHolder = { session: SessionId('b'), family: SessionId('b') }
const C: LeaseHolder = { session: SessionId('c'), family: SessionId('c') }

const live = () => new AbortController().signal

function registry(ttl = 0, onExpire: (lease: Lease) => void = () => {}): FileLockRegistry {
  return new FileLockRegistry({ leaseTtlMs: () => ttl, onExpire })
}

describe('FileLockRegistry leases', () => {
  it('grants a free key immediately and reports it foreign to other families only', async () => {
    const table = registry()
    await expect(table.acquire('k', '/p', A, live(), 0)).resolves.toBe('acquired')
    expect(table.foreignLease('k', A.family)).toBeUndefined()
    expect(table.foreignLease('k', B.family)?.owner).toBe(A.session)
    expect(table.snapshot().map(lease => lease.path)).toEqual(['/p'])
  })

  it('lets a family member join the lease and frees it only when the last holder releases', async () => {
    const table = registry()
    await table.acquire('k', '/p', A, live(), 0)
    await expect(table.acquire('k', '/p', A_CHILD, live(), 0)).resolves.toBe('acquired')
    expect(table.releaseAll(A.session)).toEqual([])
    expect(table.foreignLease('k', B.family)).toBeDefined()
    expect(table.releaseAll(A_CHILD.session)).toEqual(['/p'])
    expect(table.foreignLease('k', B.family)).toBeUndefined()
  })

  it('returns aborted for an already-aborted signal that would have to wait', async () => {
    const table = registry()
    await table.acquire('k', '/p', A, live(), 0)
    const controller = new AbortController()
    controller.abort()
    await expect(table.acquire('k', '/p', B, controller.signal, 0)).resolves.toBe('aborted')
    await expect(table.awaitRelease('k', B.family, controller.signal)).resolves.toBe('aborted')
    expect(table.snapshot()).toHaveLength(1)
  })
})

describe('FileLockRegistry waits', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('queues a foreign writer FIFO and grants it on release', async () => {
    const table = registry()
    await table.acquire('k', '/p', A, live(), 0)
    const b = table.acquire('k', '/p', B, live(), 1000)
    const c = table.acquire('k', '/p', C, live(), 1000)
    table.releaseAll(A.session)
    await expect(b).resolves.toBe('acquired')
    expect(table.foreignLease('k', C.family)?.owner).toBe(B.session)
    table.releaseAll(B.session)
    await expect(c).resolves.toBe('acquired')
  })

  it('times out a writer that outlives its wait and leaves the queue clean', async () => {
    const table = registry()
    await table.acquire('k', '/p', A, live(), 0)
    const b = table.acquire('k', '/p', B, live(), 100)
    vi.advanceTimersByTime(100)
    await expect(b).resolves.toBe('timeout')
    table.releaseAll(A.session)
    expect(table.foreignLease('k', C.family)).toBeUndefined()
  })

  it('wakes every waiting reader before granting the next writer', async () => {
    const table = registry()
    await table.acquire('k', '/p', A, live(), 0)
    const order: string[] = []
    const readerB = table.awaitRelease('k', B.family, live()).then((outcome) => { order.push(`reader:${outcome}`) })
    const readerC = table.awaitRelease('k', C.family, live(), 5000).then((outcome) => { order.push(`reader:${outcome}`) })
    const writerC = table.acquire('k', '/p', C, live(), 5000).then((outcome) => { order.push(`writer:${outcome}`) })
    table.releaseAll(A.session)
    await Promise.all([readerB, readerC, writerC])
    expect(order).toEqual(['reader:free', 'reader:free', 'writer:acquired'])
  })

  it('resolves a reader immediately when the key is free or family-held', async () => {
    const table = registry()
    await expect(table.awaitRelease('k', B.family, live(), 10)).resolves.toBe('free')
    await table.acquire('k', '/p', A, live(), 0)
    await expect(table.awaitRelease('k', A_CHILD.family, live(), 10)).resolves.toBe('free')
  })

  it('times out a bounded reader and never times out an unbounded subscription', async () => {
    const table = registry()
    await table.acquire('k', '/p', A, live(), 0)
    const bounded = table.awaitRelease('k', B.family, live(), 30)
    const subscription = table.awaitRelease('k', B.family, live())
    vi.advanceTimersByTime(30)
    await expect(bounded).resolves.toBe('timeout')
    vi.advanceTimersByTime(10 * 60 * 1000)
    table.releaseAll(A.session)
    await expect(subscription).resolves.toBe('free')
  })

  it('aborting a waiter removes it so a later release does not grant it', async () => {
    const table = registry()
    await table.acquire('k', '/p', A, live(), 0)
    const controller = new AbortController()
    const b = table.acquire('k', '/p', B, controller.signal, 1000)
    controller.abort()
    await expect(b).resolves.toBe('aborted')
    table.releaseAll(A.session)
    expect(table.snapshot()).toEqual([])
  })

  it('releases a lease at its TTL, reports it, and wakes waiters', async () => {
    const expired: Lease[] = []
    const table = registry(500, (lease) => { expired.push(lease) })
    await table.acquire('k', '/p', A, live(), 0)
    const b = table.acquire('k', '/p', B, live(), 5000)
    vi.advanceTimersByTime(500)
    await expect(b).resolves.toBe('acquired')
    expect(expired.map(lease => lease.owner)).toEqual([A.session])
    // The new lease has its own TTL; the old timer cannot free it.
    expect(table.foreignLease('k', A.family)?.owner).toBe(B.session)
  })

  it('dispose settles every waiter as aborted and drops leases and timers', async () => {
    const table = registry(500)
    await table.acquire('k', '/p', A, live(), 0)
    const b = table.acquire('k', '/p', B, live(), 5000)
    const reader = table.awaitRelease('k', C.family, live())
    table.dispose()
    await expect(b).resolves.toBe('aborted')
    await expect(reader).resolves.toBe('aborted')
    expect(table.snapshot()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
})
