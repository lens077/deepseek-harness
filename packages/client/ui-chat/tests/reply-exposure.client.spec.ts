// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeReplyExposure, replyExposed } from '../src/client/chat/reply-exposure.ts'

let dispose: (() => void) | undefined
const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalHitTest === undefined) Reflect.deleteProperty(document, 'elementFromPoint')
  else Object.defineProperty(document, 'elementFromPoint', originalHitTest)
})

function box(element: Element, x: number, y: number, width: number, height: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(x, y, width, height))
}

function fixture() {
  const scroll = document.createElement('div')
  scroll.style.overflow = 'auto'
  const body = document.createElement('div')
  const prose = document.createElement('div')
  prose.textContent = 'The completed answer'
  prose.style.fontSize = '16px'
  prose.style.lineHeight = '24px'
  body.append(prose)
  scroll.append(body)
  document.body.append(scroll)
  box(scroll, 0, 100, 600, 300)
  box(body, 0, 100, 500, 800)
  box(prose, 0, 100, 500, 800)
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const hit = vi.fn(() => prose as Element | null)
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit })
  return { scroll, body, prose, hit }
}

describe('closing reply exposure', () => {
  it('allows a visible part of a long answer, but not offscreen content', () => {
    const { body, prose } = fixture()
    expect(replyExposed(body)).toBe(true)
    box(prose, 0, 500, 500, 800)
    expect(replyExposed(body)).toBe(false)
  })

  it('rejects a clipped sliver but accepts a whole short answer or a readable slice', () => {
    const { body, prose } = fixture()
    box(prose, 0, 399, 500, 800)
    expect(replyExposed(body)).toBe(false)
    box(prose, 0, 370, 500, 800)
    expect(replyExposed(body)).toBe(true)
    box(prose, 0, 110, 500, 14)
    expect(replyExposed(body)).toBe(true)
  })

  it('does not count background, unfocused, covered, detached, or reasoning-only content', () => {
    const { body, prose, hit } = fixture()
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    expect(replyExposed(body)).toBe(false)
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    expect(replyExposed(body)).toBe(false)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    hit.mockReturnValue(document.body)
    expect(replyExposed(body)).toBe(false)
    hit.mockReturnValue(null)
    expect(replyExposed(body)).toBe(false)
    hit.mockReturnValue(prose)
    prose.dataset.assistantReasoning = ''
    expect(replyExposed(body)).toBe(false)
    delete prose.dataset.assistantReasoning
    body.setAttribute('hidden', '')
    expect(replyExposed(body)).toBe(false)
    body.removeAttribute('hidden')
    body.remove()
    expect(replyExposed(body)).toBe(false)
  })

  it('observes overlay changes, focus and scroll; disposal removes observations and withdraws exposure', async () => {
    const { body, hit } = fixture()
    const report = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect = disconnect
    })
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect = disconnect
    })
    dispose = observeReplyExposure(body, report)
    expect(report).toHaveBeenLastCalledWith(true)
    hit.mockReturnValue(document.body)
    document.body.append(document.createElement('dialog'))
    await Promise.resolve()
    expect(report).toHaveBeenLastCalledWith(false)
    hit.mockReturnValue(body.firstElementChild)
    document.dispatchEvent(new Event('scroll'))
    expect(report).toHaveBeenLastCalledWith(true)
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    window.dispatchEvent(new Event('blur'))
    expect(report).toHaveBeenLastCalledWith(false)
    dispose()
    dispose = undefined
    expect(disconnect).toHaveBeenCalledTimes(2)
    report.mockClear()
    window.dispatchEvent(new Event('focus'))
    document.body.append(document.createElement('div'))
    await Promise.resolve()
    expect(report).not.toHaveBeenCalled()
  })
})
