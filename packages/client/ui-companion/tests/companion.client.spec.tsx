// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { Companion, type CompanionProps } from '../src/client/Companion.tsx'
import { createCompanionStore } from '../src/client/store.ts'
import { en, type CompanionKey } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function mount(wide = true, floating = false) {
  const store = createCompanionStore().create()
  if (floating) {
    store.actions.move({ x: 100, y: 100 })
    vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
  }
  const props = {
    wide,
    artwork: { awake: '/awake.webp', sleeping: '/sleeping.webp' },
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    usePageVisible: selector => selector(true),
    useSessions: selector => selector({ current: undefined } as never),
    renderSlot: vi.fn(() => null),
    t: (key: CompanionKey) => en[key],
  } as CompanionProps
  const view = render(<Companion {...props} />)
  const click = (name: string) => {
    fireEvent.click(screen.getByRole('button', { name }))
    view.rerender(<Companion {...props} />)
  }
  return { ...view, props, click }
}

describe('rest companion controls', () => {
  it('greets, rests with closed eyes, and wakes through the character button', () => {
    const view = mount()
    view.click(en['action.idle'])
    expect(screen.getByRole('status').textContent).toBe(en['hint.greeting'])
    view.click(en['action.greeting'])
    expect(screen.getByRole('status').textContent).toBe(en['hint.sleeping'])
    expect(screen.getByTestId('companion-art').getAttribute('data-mood')).toBe('sleeping')
    view.click(en['action.sleeping'])
    expect(screen.getByRole('status').textContent).toBe(en['hint.idle'])
  })

  it('minimizes and restores with focus on the surviving control', () => {
    const view = mount()
    view.click(en.collapse)
    expect(screen.queryByRole('button', { name: en['action.idle'] })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: en.expand }))
    view.click(en.expand)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: en['action.idle'] }))
  })

  it('offers a compact interaction without opening over the conversation', () => {
    const view = mount(false)
    expect(screen.getAllByRole('button')).toHaveLength(2)
    view.click(en['action.idle'])
    view.click(en['action.greeting'])
    expect(screen.getByRole('button', { name: en['action.sleeping'] })).toBeTruthy()
    view.rerender(<Companion {...view.props} wide />)
    expect(screen.getByRole('status').textContent).toBe(en['hint.sleeping'])
  })

  it('offers docking for a detached character and restores focus without changing mood', () => {
    const view = mount(true, true)
    expect(screen.getByRole('button', { name: en['dock.aria'] })).toBeTruthy()
    view.click(en['dock.aria'])
    expect(screen.queryByRole('button', { name: en['dock.aria'] })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: en['action.idle'] }))
  })

  it('opens today in a compact preview and routes details through the existing slot', () => {
    const view = mount(false)
    view.click(en.menu)
    expect(screen.getByRole('dialog', { name: en.menu })).toBeTruthy()
    expect(view.props.renderSlot).toHaveBeenLastCalledWith('companion.usage.panel', {
      initialScope: 'today', onClose: expect.any(Function) as unknown, onScope: expect.any(Function) as unknown,
    }, expect.objectContaining({ fallback: expect.anything() as unknown }))
    const call = vi.mocked(view.props.renderSlot).mock.calls.at(-1)!
    const owner = call[1] as { onClose: () => void; onScope: (scope: 'all' | 'week') => void }
    act(() => { owner.onScope('week') })
    expect(screen.getByRole('dialog')).toBeTruthy()
    act(() => { owner.onScope('all') })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: en.menu }))
    act(() => { owner.onClose() })
    view.click(en.menu)
    fireEvent.pointerDown(screen.getByRole('button', { name: en['action.idle'] }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows an inline unavailable notice without trapping focus when usage has no provider', () => {
    const view = mount()
    const fallbackProps = { ...view.props, renderSlot: ((_name, _owner, options) => options?.fallback) as CompanionProps['renderSlot'] }
    view.rerender(<Companion {...fallbackProps} />)
    fireEvent.click(screen.getByRole('button', { name: en.menu }))
    expect(screen.getByText(en['usage.unavailable'])).toBeTruthy()
    expect(screen.getByRole('dialog').hasAttribute('aria-modal')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: en.close }))
    expect(screen.queryByText(en['usage.unavailable'])).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: en.menu }))
  })

  it('pauses and resumes animation without waking the character', () => {
    const view = mount()
    view.click(en['action.idle'])
    view.click(en['action.greeting'])
    view.click(en.pause)
    expect(screen.getByRole('button', { name: en.resume })).toBeTruthy()
    view.click(en.resume)
    expect(screen.getByRole('button', { name: en['action.sleeping'] })).toBeTruthy()
  })
})
