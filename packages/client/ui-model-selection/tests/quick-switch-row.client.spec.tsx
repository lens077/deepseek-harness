// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { QuickSwitchState } from '../src/client/quick-switch.ts'
import { QuickSwitchRow } from '../src/client/QuickSwitchRow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function mount(enabled = true) {
  const source = createSnapshotStore<QuickSwitchState>({ enabled, recent: [] })
  const setQuickSwitch = vi.fn((next: boolean) => { source.set({ enabled: next, recent: [] }) })
  const props = {
    useQuickSwitch: bindSnapshotSelector(source),
    setQuickSwitch,
    t: makeTranslate(en),
  } as unknown as Parameters<typeof QuickSwitchRow>[0]
  render(<QuickSwitchRow {...props} />)
  return { setQuickSwitch, source }
}

describe('QuickSwitchRow', () => {
  it('explains the preference and echoes the persisted value, on by default', () => {
    mount()
    expect(screen.getByText('Quick model switch')).toBeTruthy()
    expect(screen.getByText('Show recently used models above the composer for one-click switching')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Quick model switch' }).getAttribute('aria-checked')).toBe('true')
  })

  it('writes the toggle and follows the mirrored value', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('switch', { name: 'Quick model switch' }))
    expect(b.setQuickSwitch).toHaveBeenCalledWith(false)
    expect(screen.getByRole('switch', { name: 'Quick model switch' }).getAttribute('aria-checked')).toBe('false')

    act(() => { b.source.set({ enabled: true, recent: [] }) })
    expect(screen.getByRole('switch', { name: 'Quick model switch' }).getAttribute('aria-checked')).toBe('true')
  })
})
