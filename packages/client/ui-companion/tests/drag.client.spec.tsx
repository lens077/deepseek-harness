// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useCompanionDrag } from '../src/client/useCompanionDrag.ts'
import type { CompanionPosition } from '../src/client/store.ts'

let resize: () => void
const disconnect = vi.fn()
const release = vi.fn()
const capture = vi.fn()
const hasCapture = vi.fn(() => true)
const active = vi.fn()

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect = disconnect
  })
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number
    isPrimary: boolean
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
      this.isPrimary = init.isPrimary ?? true
    }
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const point = JSON.parse(this.getAttribute('data-position') ?? 'null') as CompanionPosition | null
    return { x: point?.x ?? 20, y: point?.y ?? 30, left: point?.x ?? 20, top: point?.y ?? 30,
      width: 200, height: 160, right: 220, bottom: 190, toJSON: () => ({}) }
  })
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: capture },
    hasPointerCapture: { configurable: true, value: hasCapture },
    releasePointerCapture: { configurable: true, value: release },
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  for (const key of ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture']) {
    Reflect.deleteProperty(HTMLElement.prototype, key)
  }
})

function Harness({ attach = true, initial = null }: { attach?: boolean; initial?: CompanionPosition | null }) {
  const [position, move] = useState<CompanionPosition | null>(initial)
  const { root, dragging, ...handlers } = useCompanionDrag(position, move, () => { move(null) }, active)
  return <section ref={attach ? root : undefined} data-testid="pet" data-position={JSON.stringify(position)} data-dragging={dragging}>
    <button {...handlers}>Character</button>
  </section>
}
function setup() {
  const view = render(<Harness />)
  const handle = screen.getByRole('button', { name: 'Character' })
  const point = () => JSON.parse(screen.getByTestId('pet').getAttribute('data-position')!) as CompanionPosition | null
  return { ...view, handle, point }
}
const pointer = { pointerId: 1, isPrimary: true, button: 0, clientX: 50, clientY: 60 }

describe('companion drag gestures', () => {
  it('does not start a move without an attached root', () => {
    render(<Harness attach={false} initial={{ x: 10, y: 20 }} />)
    const handle = screen.getByRole('button', { name: 'Character' })
    fireEvent.pointerDown(handle, pointer)
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(capture).not.toHaveBeenCalled()
    expect(screen.getByTestId('pet').getAttribute('data-position')).toBe('{"x":10,"y":20}')
  })

  it('follows the visible viewport when a software keyboard or zoom changes its bounds', () => {
    const viewport = Object.assign(new EventTarget(), { offsetLeft: 20, offsetTop: 40, width: 500, height: 600 })
    vi.stubGlobal('visualViewport', viewport)
    const remove = vi.spyOn(viewport, 'removeEventListener')
    const { handle, point } = setup()
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.pointerDown(handle, pointer)
    fireEvent.pointerMove(handle, { ...pointer, clientX: 900, clientY: 900 })
    fireEvent.pointerUp(handle, pointer)
    expect(point()).toEqual({ x: 320, y: 480 })
    viewport.width = 320
    viewport.height = 260
    act(() => { viewport.dispatchEvent(new Event('resize')) })
    expect(point()).toEqual({ x: 140, y: 140 })
    viewport.offsetLeft = 160
    act(() => { viewport.dispatchEvent(new Event('scroll')) })
    expect(point()).toEqual({ x: 160, y: 140 })
    fireEvent.keyDown(handle, { key: 'Home' })
    act(() => { resize() })
    expect(point()).toBeNull()
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
  })

  it('keeps taps clickable but suppresses the click produced by a drag', () => {
    const { handle, point } = setup()
    fireEvent.pointerDown(handle, pointer)
    fireEvent.pointerMove(handle, { ...pointer, clientX: 52 })
    fireEvent.pointerUp(handle, pointer)
    fireEvent.click(handle, { detail: 1 })
    expect(active).toHaveBeenCalledOnce()
    expect(point()).toBeNull()
    fireEvent.pointerDown(handle, pointer)
    fireEvent.pointerMove(handle, { ...pointer, clientX: 250, clientY: 200 })
    expect(point()).toEqual({ x: 220, y: 170 })
    fireEvent.pointerUp(handle, pointer)
    fireEvent.click(handle, { detail: 1 })
    expect(active).toHaveBeenCalledOnce()
    fireEvent.click(handle, { detail: 0 })
    expect(active).toHaveBeenCalledTimes(2)
  })

  it('ignores secondary pointers and ends cancelled or lost captures at their latest position', () => {
    const { handle, point, unmount } = setup()
    fireEvent.pointerMove(handle, pointer)
    fireEvent.pointerUp(handle, pointer)
    fireEvent.pointerDown(handle, { ...pointer, button: 2 })
    fireEvent.pointerDown(handle, { ...pointer, isPrimary: false })
    expect(capture).not.toHaveBeenCalled()
    fireEvent.pointerDown(handle, pointer)
    fireEvent.pointerDown(handle, { ...pointer, pointerId: 2 })
    fireEvent.pointerMove(handle, { ...pointer, pointerId: 2, clientX: 250 })
    fireEvent.pointerUp(handle, { ...pointer, pointerId: 2 })
    expect(point()).toBeNull()
    fireEvent.pointerMove(handle, { ...pointer, clientX: 100 })
    fireEvent.pointerCancel(handle, pointer)
    expect(point()).toEqual({ x: 70, y: 30 })
    expect(screen.getByTestId('pet').getAttribute('data-dragging')).toBe('false')
    fireEvent.pointerDown(handle, pointer)
    hasCapture.mockReturnValueOnce(false)
    fireEvent.lostPointerCapture(handle, pointer)
    fireEvent.pointerDown(handle, pointer)
    unmount()
    expect(release).toHaveBeenCalledWith(1)
    expect(disconnect).toHaveBeenCalled()
  })

  it('clamps pointer, resize, and keyboard moves and docks with Home', () => {
    const { handle, point } = setup()
    fireEvent.keyDown(handle, { key: 'ArrowRight', ctrlKey: true })
    fireEvent.keyDown(handle, { key: 'Enter' })
    expect(point()).toBeNull()
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(point()).toEqual({ x: 36, y: 30 })
    fireEvent.pointerDown(handle, pointer)
    fireEvent.pointerMove(handle, { ...pointer, clientX: 5000, clientY: 5000 })
    fireEvent.pointerUp(handle, pointer)
    expect(point()).toEqual({ x: window.innerWidth - 200, y: window.innerHeight - 160 })
    vi.stubGlobal('innerWidth', 320)
    vi.stubGlobal('innerHeight', 240)
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(point()).toEqual({ x: 120, y: 80 })
    act(() => { resize() })
    expect(point()).toEqual({ x: 120, y: 80 })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(point()).toEqual({ x: 104, y: 80 })
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(point()).toBeNull()
  })
})
