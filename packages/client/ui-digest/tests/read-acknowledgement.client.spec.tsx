// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReadAcknowledgement } from '../src/client/ReadAcknowledgement.tsx'
import type { ReadAcknowledgementProps } from '../src/client/contract/slots.ts'
import { inbox, mark, row, t } from './fixtures.client.ts'

const session = row('a')
afterEach(cleanup)

function props(lastSeenSeq: number | null = null): ReadAcknowledgementProps {
  const snapshot = inbox({ sessions: [mark('a', { lastSeenSeq })] })
  return {
    sessionId: session.id,
    useSessions: selector => selector({ byId: { [session.id]: session }, current: session.id } as never),
    useInbox: selector => selector({ status: 'ready', snapshot, error: null }),
    markReplySeen: vi.fn(() => Promise.resolve({ ok: true })),
    t,
  } as ReadAcknowledgementProps
}

describe('explicit viewed action', () => {
  it('acknowledges the exact reply without a handling action and hides after it is seen', async () => {
    const p = props()
    const view = render(<ReadAcknowledgement {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '标记已查看' }))
    expect(p.markReplySeen).toHaveBeenCalledExactlyOnceWith(session.id, 3)
    await waitFor(() => { expect(screen.queryByRole('button', { name: '标记中…' })).toBeNull() })
    view.rerender(<ReadAcknowledgement {...props(3)} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it.each([new Error('offline'), 'offline'])('reports a rejected acknowledgement and restores the action', async (cause) => {
    const p = props()
    p.markReplySeen = vi.fn().mockRejectedValue(cause)
    render(<ReadAcknowledgement {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '标记已查看' }))
    expect((await screen.findByRole('alert')).textContent).toContain('offline')
    expect(screen.getByRole('button', { name: '标记已查看' }).hasAttribute('disabled')).toBe(false)
  })

  it('leaves an unsuccessful acknowledgement retryable and exposes the error', async () => {
    const p = props()
    p.markReplySeen = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'io', message: 'offline' } }).mockResolvedValue({ ok: true })
    render(<ReadAcknowledgement {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '标记已查看' }))
    expect((await screen.findByRole('alert')).textContent).toContain('offline')
    fireEvent.click(screen.getByRole('button', { name: '标记已查看' }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(p.markReplySeen).toHaveBeenCalledTimes(2)
  })
})
