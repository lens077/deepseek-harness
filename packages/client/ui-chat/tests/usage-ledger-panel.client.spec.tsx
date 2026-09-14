// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UsageLedgerProjection } from '@deepseek-ai/dsh-session-stats/client'
import { StatsPills, type StatsPillsProps } from '../src/client/chat/StatsPills.tsx'
import { en, zh } from '../src/client/locale.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'
import { usageLedger, usageList } from './usage-fixture.client.ts'

const ROOT = 'root' as SessionId
const CHILD = 'child' as SessionId
const t = makeTranslate(en, commonEn)

afterEach(cleanup)

function props(ledger: UsageLedgerProjection, list: SessionListState = usageList({ root: ledger })): StatsPillsProps {
  const chat = chatSnapshotFixture({})
  const values: Record<string, unknown> = { usageLedger: ledger,
    tokenUsage: { uncachedInputTokens: 99999, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
    sessionStats: { turns: 99, steps: 99, llmMs: 99999, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 } }
  return {
    t, sessionId: ROOT,
    useChat: bindSnapshotSelector({ getSnapshot: () => chat, subscribe: () => () => {} }),
    useSessions: bindSnapshotSelector({ getSnapshot: () => list, subscribe: () => () => {} }),
    useProjection: (key: string) => values[key],
  }
}

describe('usage ledger drawer', () => {
  it('prefers own ledger cost, steps, and activity to legacy projections', () => {
    const view = render(<StatsPills {...props(usageLedger())} />)
    const trigger = view.getByRole('button', { name: /^AI usage:/ })
    expect(trigger.textContent).toContain('Est. USD 0.02')
    expect(trigger.textContent).toContain('Cache hit 80%')
    expect(trigger.textContent).toContain('1K input/step')
    expect(view.container.textContent).toContain('1 turns 1 steps')
    expect(view.container.textContent).not.toContain('99 turns')
    fireEvent.click(trigger)
    const panel = view.getByRole('dialog', { name: 'AI usage' })
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(panel.textContent).toContain('1/1 session snapshots')
    expect(panel.textContent).toContain('fixture/model')
    expect(panel.textContent).toContain('bash')
    expect(panel.textContent).toContain('Includes 20 tok reasoning, already counted in output')
    expect(panel.textContent).toContain('Changes show correlation, not proof')
    expect(panel.textContent).toContain('High average input per step')
    expect(panel.querySelector('[data-usage-budget]')?.getAttribute('data-usage-budget')).toBe('within')
  })

  it('isolates background content, wraps focus in both directions, and restores the trigger on Escape', () => {
    const view = render(<><button type="button">Outside</button><StatsPills {...props(usageLedger())} /></>)
    const outside = view.getByRole('button', { name: 'Outside' })
    const trigger = view.getByRole('button', { name: /^AI usage:/ })
    trigger.focus()
    fireEvent.click(trigger)
    const panel = view.getByRole('dialog', { name: 'AI usage' })
    const close = view.getByRole('button', { name: 'Close usage panel' })
    const last = view.getByRole('button', { name: 'All sessions' })
    expect(document.activeElement).toBe(close)
    expect(view.container.inert).toBe(true)
    expect(view.container.getAttribute('aria-hidden')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    outside.focus()
    expect(panel.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(view.container.inert).toBeFalsy()
    expect(view.container.hasAttribute('aria-hidden')).toBe(false)
    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(trigger)
  })

  it('restores existing isolation attributes and page scrolling when unmounted', () => {
    const background = document.createElement('aside')
    background.inert = true
    background.setAttribute('aria-hidden', 'false')
    document.body.append(background)
    document.body.style.overflow = 'clip'
    try {
      const view = render(<StatsPills {...props(usageLedger())} />)
      fireEvent.click(view.getByRole('button', { name: /^AI usage:/ }))
      expect(background.getAttribute('aria-hidden')).toBe('true')
      view.unmount()
      expect(background.inert).toBe(true)
      expect(background.getAttribute('aria-hidden')).toBe('false')
      expect(document.body.style.overflow).toBe('clip')
    } finally {
      background.remove()
      document.body.style.overflow = ''
    }
  })

  it('switches session, subagent tree, and all scopes without duplicating catalog children', () => {
    const ledger = usageLedger()
    const list = usageList({ root: ledger, child: ledger, other: ledger })
    Object.assign(list.byId[CHILD]!, { parentId: ROOT, origin: 'subagent' })
    list.subagentsByParent = { [ROOT]: { state: 'ready', error: null, entries: [
      { kind: 'child', id: CHILD, mode: 'continuable', label: 'child', activity: 'inactive', hasChildren: false },
    ] } }
    const view = render(<StatsPills {...props(ledger, list)} />)
    fireEvent.click(view.getByRole('button', { name: /^AI usage:/ }))
    const panel = view.getByRole('dialog')
    expect(panel.querySelector('[data-usage-cost]')?.textContent).toContain('USD 0.02')
    fireEvent.click(view.getByRole('button', { name: 'Session tree' }))
    expect(panel.querySelector('[data-usage-cost]')?.textContent).toContain('USD 0.04')
    expect(panel.textContent).toContain('2/2 session snapshots')
    fireEvent.click(view.getByRole('button', { name: 'All sessions' }))
    expect(panel.querySelector('[data-usage-cost]')?.textContent).toContain('USD 0.06')
    expect(panel.textContent).toContain('3/3 session snapshots')
    expect(panel.textContent).toContain('Unopened sessions may be missing or out of date')
    fireEvent.click(view.getByRole('button', { name: 'Close usage panel' }))
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('discloses missing snapshots and suppresses total, budget, and clean diagnoses', () => {
    const ledger = usageLedger()
    const view = render(<StatsPills {...props(ledger, usageList({ root: ledger, cold: undefined }))} />)
    fireEvent.click(view.getByRole('button', { name: /^AI usage:/ }))
    fireEvent.click(view.getByRole('button', { name: 'All sessions' }))
    const panel = view.getByRole('dialog')
    expect(panel.textContent).toContain('1 sessions have no usage snapshot')
    expect(panel.textContent).toContain('Observed cost (partial)')
    expect(panel.textContent).toContain('Usage is incomplete')
    expect(panel.querySelector('[data-usage-budget]')).toBeNull()
    expect(panel.querySelector('[data-usage-cost] strong')).toBeNull()
  })

  it.each(['unreported', 'incomplete'] as const)('discloses %s accounting even when a stale price exists', (kind) => {
    const ledger = usageLedger(kind === 'unreported' ? { unreportedAttempts: 1, observedCost: 0.02 }
      : { models: [{ ...usageLedger().models[0]!, incompleteRequests: 1 }], observedCost: 0.02 })
    const view = render(<StatsPills {...props(ledger)} />)
    const trigger = view.getByRole('button', { name: /^AI usage:/ })
    expect(trigger.textContent).toContain('Observed USD 0.02')
    fireEvent.click(trigger)
    const panel = view.getByRole('dialog')
    expect(panel.textContent).toContain(kind === 'unreported' ? 'did not report usable token usage' : 'incomplete billing inputs')
    expect(panel.querySelector('[data-usage-budget]')).toBeNull()
    expect(panel.querySelector('[data-usage-cost] strong')?.textContent).toContain('USD 0.02')
    expect(panel.textContent).toContain('Observed cost (partial)')
  })

  it('shows observed usage without billing copy when no pricing is configured', () => {
    const base = usageLedger()
    const { currency: _currency, estimatedCost: _cost, ...ledger } = base
    const model = ledger.models[0]
    const withoutPrice = model === undefined ? ledger : (() => {
      const { estimatedCost: _modelCost, ...modelWithoutPrice } = model
      return { ...ledger, models: [modelWithoutPrice] }
    })()
    const view = render(<StatsPills {...props(withoutPrice)} />)
    fireEvent.click(view.getByRole('button', { name: /^AI usage:/ }))
    const panel = view.getByRole('dialog', { name: 'AI usage' })
    expect(panel.textContent).toContain('Observed tokens')
    expect(panel.textContent).not.toContain('Total cost unavailable')
    expect(panel.textContent).not.toContain('lack complete prices')
    expect(panel.querySelector('[data-usage-budget]')).toBeNull()
  })

  it('keeps zero-report activity inspectable without a cost or budget', () => {
    const ledger = usageLedger({ models: [], estimatedCost: 0, unreportedAttempts: 1 })
    const view = render(<StatsPills {...props(ledger)} />)
    fireEvent.click(view.getByRole('button', { name: /^AI usage:/ }))
    const panel = view.getByRole('dialog')
    expect(panel.textContent).toContain('No model requests have reported usage yet')
    expect(panel.querySelector('[data-usage-cost]')).toBeNull()
    expect(panel.querySelector('[data-usage-budget]')).toBeNull()
  })

  it('keeps tiny nonzero prices visible rather than rounding them to zero', () => {
    const ledger = usageLedger({ estimatedCost: 0.00000001,
      models: [{ ...usageLedger().models[0]!, estimatedCost: 0.00000001 }] })
    const view = render(<StatsPills {...props(ledger)} />)
    expect(view.getByRole('button', { name: /^AI usage:/ }).textContent).toContain('USD 1e-8')
  })

  it('updates an open drawer without resetting focus and dismisses from its backdrop', () => {
    const ledger = usageLedger()
    const view = render(<StatsPills {...props(ledger)} />)
    fireEvent.click(view.getByRole('button', { name: /^AI usage:/ }))
    const scope = view.getByRole('button', { name: 'This session' })
    scope.focus()
    const updated = usageLedger({ estimatedCost: 0.04,
      models: [{ ...ledger.models[0]!, estimatedCost: 0.04 }] })
    view.rerender(<StatsPills {...props(updated)} />)
    const panel = view.getByRole('dialog')
    expect(panel.querySelector('[data-usage-cost]')?.textContent).toContain('USD 0.04')
    expect(document.activeElement).toBe(scope)
    fireEvent.click(panel.previousElementSibling!)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('uses the active Chinese dictionary for title, scopes, and disclosures', () => {
    const view = render(<StatsPills {...props(usageLedger())} t={makeTranslate(zh, commonZh)} />)
    fireEvent.click(view.getByRole('button', { name: /^查看 AI 用量/ }))
    const panel = view.getByRole('dialog', { name: 'AI 用量' })
    expect(view.getByRole('button', { name: '本会话' })).toBeTruthy()
    expect(view.getByRole('button', { name: '会话树' })).toBeTruthy()
    expect(panel.textContent).toContain('已包含在输出中')
    fireEvent.click(view.getByRole('button', { name: '关闭用量面板' }))
    expect(view.queryByRole('dialog')).toBeNull()
  })
})
