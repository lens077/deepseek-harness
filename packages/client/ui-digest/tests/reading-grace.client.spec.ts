import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ReadingGrace } from '../src/client/reading-grace.ts'

const A = 'a' as SessionId
const B = 'b' as SessionId

afterEach(() => { vi.useRealTimers() })

describe('continuous reply exposure', () => {
  it('acknowledges the exposed reply only after the whole grace period', () => {
    vi.useFakeTimers()
    const seen = vi.fn()
    const grace = new ReadingGrace(seen)
    grace.update({ sessionId: A, seq: 7 }, 5)
    vi.advanceTimersByTime(4_999)
    expect(seen).not.toHaveBeenCalled()
    grace.update({ sessionId: A, seq: 7 }, 5)
    vi.advanceTimersByTime(1)
    expect(seen).toHaveBeenCalledExactlyOnceWith({ sessionId: A, seq: 7 })
    grace.update({ sessionId: A, seq: 7 }, 5)
    vi.advanceTimersByTime(10_000)
    expect(seen).toHaveBeenCalledTimes(1)
    grace.dispose()
  })

  it('does not accumulate brief visits across interruptions', () => {
    vi.useFakeTimers()
    const seen = vi.fn()
    const grace = new ReadingGrace(seen)
    grace.update({ sessionId: A, seq: 7 }, 5)
    vi.advanceTimersByTime(3_000)
    grace.update(null, 5)
    vi.advanceTimersByTime(10_000)
    grace.update({ sessionId: A, seq: 7 }, 5)
    vi.advanceTimersByTime(4_999)
    expect(seen).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(seen).toHaveBeenCalledExactlyOnceWith({ sessionId: A, seq: 7 })
    grace.dispose()
  })

  it('restarts for a different Session, reply, or configured duration', () => {
    vi.useFakeTimers()
    const seen = vi.fn()
    const grace = new ReadingGrace(seen)
    grace.update({ sessionId: A, seq: 7 }, 5)
    vi.advanceTimersByTime(4_000)
    grace.update({ sessionId: B, seq: 7 }, 5)
    vi.advanceTimersByTime(4_000)
    grace.update({ sessionId: B, seq: 9 }, 5)
    vi.advanceTimersByTime(4_000)
    grace.update({ sessionId: B, seq: 9 }, 8)
    vi.advanceTimersByTime(7_999)
    expect(seen).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(seen).toHaveBeenCalledExactlyOnceWith({ sessionId: B, seq: 9 })
    grace.dispose()
  })

  it('leaves no pending acknowledgement after disposal', () => {
    vi.useFakeTimers()
    const seen = vi.fn()
    const grace = new ReadingGrace(seen)
    grace.update({ sessionId: A, seq: 7 }, 5)
    grace.dispose()
    grace.dispose()
    vi.advanceTimersByTime(10_000)
    expect(seen).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
