// @vitest-environment jsdom
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UsagePopover } from '../src/client/UsagePopover.tsx'

afterEach(() => { cleanup(); vi.useRealTimers() })

function Preview({ onClose }: { onClose: () => void }) {
  const anchor = useRef<HTMLButtonElement>(null)
  return <><button ref={anchor}>Anchor</button><button>Outside</button>
    <UsagePopover anchor={anchor} label="Usage" onClose={onClose}><button>Today</button></UsagePopover></>
}

describe('non-modal usage preview', () => {
  it('focuses the preview, ignores inside and anchor pointers, closes outside or on Escape', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const view = render(<Preview onClose={onClose} />)
    act(() => { vi.runOnlyPendingTimers() })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByRole('dialog').hasAttribute('aria-modal')).toBe(false)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Today' }))
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Anchor' }))
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    expect(onClose).toHaveBeenCalledOnce()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    view.unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
