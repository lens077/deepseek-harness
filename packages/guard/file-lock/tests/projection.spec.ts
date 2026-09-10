import { describe, expect, it } from 'vitest'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { fileLocksProjection } from '@deepseek-ai/dsh-tool-call-file-lock'
import type { FileLocksProjectionState } from '@deepseek-ai/dsh-tool-call-file-lock/types'

/** Direct fold tests for orderings the plugin never produces but a projection must still absorb. */

const holder = { session: SessionId('a') }
let seq = 0
function event<T extends SessionEvent['type']>(type: T, data: SessionEvent<T>['data']): SessionEvent {
  return { type, data, seq: SessionSeq(seq++), time: 1000 } as SessionEvent
}

const init = (): FileLocksProjectionState => fileLocksProjection.init()

describe('fileLocks projection', () => {
  it('folds a lease and the wait phases from the plugin events', () => {
    let state = fileLocksProjection.apply(init(), event('file-lock/acquired', { path: '/p' }))
    expect(state.held).toEqual(['/p'])
    state = fileLocksProjection.apply(state, event('file-lock/waiting', { path: '/q', access: 'read', holder }))
    state = fileLocksProjection.apply(state, event('file-lock/asked', { path: '/q', holder, waitedMs: 30 }))
    expect(state.waiting?.phase).toBe('asked')
    state = fileLocksProjection.apply(state, event('file-lock/subscribed', { path: '/q', holder }))
    expect(state.waiting).toEqual({ path: '/q', access: 'read', holder, phase: 'subscribed', since: 1000 })
    state = fileLocksProjection.apply(state, event('file-lock/settled', { path: '/q', access: 'read', outcome: 'released', waitedMs: 50 }))
    expect(state.waiting).toBeNull()
    expect(fileLocksProjection.wire.view(state)).toBe(state)
    expect(fileLocksProjection.apply(state, event('turn/end', { turn: 1, reason: { kind: 'completed' } }))).toEqual({ held: [], waiting: null })
  })

  it('returns the same reference for events that change nothing', () => {
    const empty = init()
    expect(fileLocksProjection.apply(empty, event('turn/end', { turn: 1, reason: { kind: 'completed' } }))).toBe(empty)
    expect(fileLocksProjection.apply(empty, event('file-lock/asked', { path: '/q', holder, waitedMs: 1 }))).toBe(empty)
    expect(fileLocksProjection.apply(empty, event('file-lock/settled', { path: '/q', access: 'read', outcome: 'aborted', waitedMs: 1 }))).toBe(empty)
    expect(fileLocksProjection.apply(empty, event('file-lock/released', { paths: ['/p'], reason: 'ttl' }))).toBe(empty)
    expect(fileLocksProjection.apply(empty, event('turn/start', { turn: 1 }))).toBe(empty)
    const held = fileLocksProjection.apply(empty, event('file-lock/acquired', { path: '/p' }))
    expect(fileLocksProjection.apply(held, event('file-lock/acquired', { path: '/p' }))).toBe(held)
    expect(fileLocksProjection.apply(held, event('file-lock/released', { paths: ['/p'], reason: 'ttl' }))).toEqual({ held: [], waiting: null })
  })
})
