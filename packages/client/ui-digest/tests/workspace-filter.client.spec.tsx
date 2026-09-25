// @vitest-environment jsdom
/** Workspace overflow expands independently of filtering and distinguishes dragging from clicking. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WorkspaceFilter } from '../src/client/WorkspaceFilter.tsx'
import { workspaceRowsOf } from '../src/client/workspace-layout.ts'
import { t } from './fixtures.client.ts'

const workspaces = [
  { workspaceId: 'alpha', title: 'Alpha', attention: 2, running: 1 },
  { workspaceId: 'beta', title: 'Beta', attention: 0, running: 3 },
]

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function mount(rows: 'single' | 2 | 6 | 'all' = 'single') {
  const onSelect = vi.fn()
  const props = { workspaces, selected: undefined, rows, onSelect, t }
  const view = render(<WorkspaceFilter {...props} />)
  const scroll = view.container.querySelector<HTMLElement>('[data-workspace-scroll]')!
  Object.defineProperties(scroll, {
    clientWidth: { configurable: true, value: 200 },
    scrollWidth: { configurable: true, value: 500 },
    clientHeight: { configurable: true, value: 28 },
    scrollHeight: { configurable: true, value: 96 },
  })
  fireEvent(window, new Event('resize'))
  return { scroll, onSelect, ...view }
}

describe('WorkspaceFilter', () => {
  it('expands overflowing workspaces without clearing the filter or saving another row limit', () => {
    const m = mount()
    const expand = screen.getByRole('button', { name: '显示全部' })
    expect(expand.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById(expand.getAttribute('aria-controls')!)).toBe(m.scroll)
    fireEvent.click(expand)
    expect(screen.getByRole('button', { name: '收起' }).getAttribute('aria-expanded')).toBe('true')
    expect(m.onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '收起' }))
    fireEvent.click(screen.getByRole('button', { name: 'Alpha21' }))
    expect(m.onSelect).toHaveBeenCalledWith('alpha')
    fireEvent.click(screen.getByRole('button', { name: '全部工作区' }))
    expect(m.onSelect).toHaveBeenLastCalledWith(undefined)
  })

  it.each([2, 6] as const)('keeps workspaces reachable after the %s-row cap', (rows) => {
    mount(rows)
    expect(screen.getByRole('button', { name: '显示全部' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '显示全部' }))
    expect(screen.getByRole('button', { name: 'Beta3' })).toBeTruthy()
  })

  it('does not offer expansion with no overflow or in all-rows mode', () => {
    const m = mount('all')
    expect(screen.queryByRole('button', { name: '显示全部' })).toBeNull()
    m.unmount()
    render(<WorkspaceFilter workspaces={workspaces} selected={undefined} rows="single" onSelect={vi.fn()} t={t} />)
    expect(screen.queryByRole('button', { name: '显示全部' })).toBeNull()
  })

  it('scrolls on mouse drag and suppresses only the click ending that drag', () => {
    class Pointer extends MouseEvent {
      readonly pointerId = 1
      readonly pointerType = 'mouse'
    }
    vi.stubGlobal('PointerEvent', Pointer)
    const m = mount()
    m.scroll.setPointerCapture = vi.fn()
    m.scroll.hasPointerCapture = () => true
    m.scroll.releasePointerCapture = vi.fn()
    const alpha = screen.getByRole('button', { name: 'Alpha21' })
    fireEvent.pointerDown(alpha, { button: 0, clientX: 150 })
    fireEvent.pointerMove(m.scroll, { clientX: 90, buttons: 1 })
    fireEvent.pointerUp(m.scroll, { clientX: 90 })
    fireEvent.click(alpha)
    expect(m.scroll.scrollLeft).toBe(60)
    expect(m.onSelect).not.toHaveBeenCalled()
    fireEvent.pointerDown(alpha, { button: 0, clientX: 100 })
    fireEvent.pointerUp(alpha, { clientX: 100 })
    fireEvent.click(alpha)
    expect(m.onSelect).toHaveBeenCalledWith('alpha')
  })

  it('observes content resizing and disconnects when the strip is unmounted', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      observe = observe
      disconnect = disconnect
    })
    const m = mount()
    expect(observe).toHaveBeenCalledTimes(2)
    m.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('keeps small pointer movement as a click and clears cancelled or lost drags', () => {
    class Pointer extends MouseEvent {
      readonly pointerId = 1
      readonly pointerType = 'mouse'
    }
    vi.stubGlobal('PointerEvent', Pointer)
    const m = mount()
    m.scroll.setPointerCapture = vi.fn()
    m.scroll.hasPointerCapture = () => false
    const alpha = screen.getByRole('button', { name: 'Alpha21' })
    fireEvent.pointerMove(m.scroll, { clientX: 100, buttons: 1 })
    fireEvent.pointerDown(alpha, { button: 2, clientX: 150 })
    fireEvent.pointerMove(m.scroll, { clientX: 100, buttons: 1 })
    expect(m.scroll.scrollLeft).toBe(0)
    fireEvent.pointerDown(alpha, { button: 0, clientX: 150 })
    fireEvent.pointerMove(m.scroll, { clientX: 148, buttons: 1 })
    fireEvent.pointerUp(alpha, { clientX: 148 })
    fireEvent.click(alpha)
    expect(m.onSelect).toHaveBeenCalledWith('alpha')
    fireEvent.pointerDown(alpha, { button: 0, clientX: 150 })
    fireEvent.pointerMove(m.scroll, { clientX: 100, buttons: 1 })
    fireEvent.pointerCancel(m.scroll)
    fireEvent.pointerMove(m.scroll, { clientX: 50, buttons: 1 })
    expect(m.scroll.scrollLeft).toBe(50)
    fireEvent.pointerDown(alpha, { button: 0, clientX: 150 })
    fireEvent.lostPointerCapture(m.scroll)
    fireEvent.pointerMove(m.scroll, { clientX: 100, buttons: 1 })
    expect(m.scroll.scrollLeft).toBe(50)
  })

  it('ends a pre-capture drag when the mouse button was released outside the strip', () => {
    class Pointer extends MouseEvent {
      readonly pointerId = 1
      readonly pointerType = 'mouse'
    }
    vi.stubGlobal('PointerEvent', Pointer)
    const m = mount()
    const capture = vi.fn()
    m.scroll.setPointerCapture = capture
    m.scroll.hasPointerCapture = () => false
    const alpha = screen.getByRole('button', { name: 'Alpha21' })
    fireEvent.pointerDown(alpha, { button: 0, clientX: 150 })
    fireEvent.pointerUp(document.body, { clientX: 140 })
    fireEvent.pointerMove(m.scroll, { clientX: 90, buttons: 0 })
    expect(m.scroll.scrollLeft).toBe(0)
    expect(capture).not.toHaveBeenCalled()
    fireEvent.click(alpha)
    expect(m.onSelect).toHaveBeenCalledWith('alpha')
  })

  it.each([undefined, null, 'invalid', 1, 7, 2.5, {}, Number.NaN])('uses one row for malformed stored limit %j', (value) => {
    expect(workspaceRowsOf(value)).toBe('single')
  })
})
