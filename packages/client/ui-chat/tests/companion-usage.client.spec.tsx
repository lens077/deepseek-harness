// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CompanionUsage, type CompanionUsageProps } from '../src/client/chat/CompanionUsage.tsx'
import { en } from '../src/client/locale.ts'
import { usageLedger, usageList } from './usage-fixture.client.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })

function props(current = false): CompanionUsageProps {
  const ledger = usageLedger()
  const list = usageList({ root: ledger, other: ledger })
  return {
    sessionId: current ? 'root' as SessionId : undefined,
    useProjection: () => current ? ledger : undefined,
    useSessions: bindSnapshotSelector({ getSnapshot: () => list, subscribe: () => () => {} }),
    initialScope: current ? 'tree' : 'all',
    onClose: vi.fn(),
    onScope: vi.fn(),
    t: makeTranslate(en, commonEn),
  } as CompanionUsageProps
}

describe('companion usage adapter', () => {
  it('offers today, week and month previews without inventing unavailable calendar data', () => {
    const p = props()
    const view = render(<CompanionUsage {...p} initialScope="today" />)
    expect(view.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed')).toBe('true')
    expect(view.getByText('Daily usage is not ready. Open relevant sessions to fill it in.')).toBeTruthy()
    expect(view.queryByRole('dialog')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'This week' }))
    expect(p.onScope).toHaveBeenCalledWith('week')
    fireEvent.click(view.getByRole('button', { name: 'This month' }))
    expect(p.onScope).toHaveBeenCalledWith('month')
    fireEvent.click(view.getByRole('button', { name: 'View details' }))
    expect(p.onScope).toHaveBeenCalledWith('all')
  })

  it('advances the date while open at midnight and releases its refresh timer on close', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 8, 25, 23, 59, 30))
    const ledger = usageLedger({ calendar: { timeZone: 'UTC', days: [
      { date: '2026-09-25', requests: 1, incompleteRequests: 0, unreportedAttempts: 0, unpricedRequests: 0,
        uncachedInputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50, estimatedCost: 0.01 },
    ] } })
    const p = props()
    const list = usageList({ root: ledger })
    const view = render(<CompanionUsage {...p} initialScope="today"
      useSessions={bindSnapshotSelector({ getSnapshot: () => list, subscribe: () => () => {} })} />)
    expect(view.getByText('150')).toBeTruthy()
    expect(view.getByText('2026-09-25 — 2026-09-25')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(view.getByText('2026-09-26 — 2026-09-26')).toBeTruthy()
    expect(view.queryByText('150')).toBeNull()
    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('opens the existing global ledger without selecting or inventing a session', () => {
    const p = props()
    const view = render(<CompanionUsage {...p} />)
    const panel = view.getByRole('dialog', { name: 'AI usage' })
    expect(panel.textContent).toContain('2/2 session snapshots')
    expect(panel.textContent).toContain('USD 0.04')
    expect(panel.querySelector('[data-usage-budget]')).toBeNull()
    expect(view.getByRole('button', { name: 'This session' }).hasAttribute('disabled')).toBe(true)
    expect(view.getByRole('button', { name: 'Session tree' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(view.getByRole('button', { name: 'Close usage panel' }))
    expect(p.onClose).toHaveBeenCalledOnce()
  })

  it('opens the requested session scope and preserves incomplete-data disclosure', () => {
    const p = props(true)
    const view = render(<CompanionUsage {...p} />)
    expect(view.getByRole('button', { name: 'Session tree' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(view.getByRole('button', { name: 'All sessions' }))
    expect(view.getByRole('dialog').textContent).toContain('2/2 session snapshots')
    view.rerender(<CompanionUsage {...p} useProjection={() => undefined} />)
    expect(view.getByRole('dialog').textContent).toContain('1 sessions have no usage snapshot')
  })
})
