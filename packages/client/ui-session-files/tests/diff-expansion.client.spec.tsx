// @vitest-environment jsdom
// The inline-diff expansion preference: its shipped default, the durable
// adoption a Host acceptance drives, the write a change makes, the
// process-local arm for a composition without a settings provider, and the
// Settings row that drives it.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { DEFAULT_DIFF_EXPANSION, DiffExpansionPolicy } from '../src/client/diff-expansion.ts'
import { DiffExpansionRow, type DiffExpansionRowProps } from '../src/client/DiffExpansionRow.tsx'
import type { SessionFilesSettings } from '../src/diff-settings.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

describe('DiffExpansionPolicy', () => {
  it('ships expanding every changed file', () => {
    expect(new DiffExpansionPolicy().expansion.getSnapshot()).toBe(DEFAULT_DIFF_EXPANSION)
    expect(DEFAULT_DIFF_EXPANSION).toBe('all')
  })

  it('stays process-local without a settings provider', () => {
    const policy = new DiffExpansionPolicy()
    policy.set('none')
    expect(policy.expansion.getSnapshot()).toBe('none')
  })

  it('publishes the change before the durable write and skips a no-op', () => {
    const host = stubSettingsScope<SessionFilesSettings>()
    const policy = new DiffExpansionPolicy(host.scope)
    policy.set('single')
    expect(policy.expansion.getSnapshot()).toBe('single')
    expect(host.set).toHaveBeenCalledWith('diffExpansion', 'single')

    host.set.mockClear()
    policy.set('single')
    expect(host.set).not.toHaveBeenCalled()
  })

  it('adopts a Host acceptance without writing it back', () => {
    const host = stubSettingsScope<SessionFilesSettings>()
    const policy = new DiffExpansionPolicy(host.scope)
    // Loading: no value yet, so the shipped default stands.
    expect(policy.expansion.getSnapshot()).toBe('all')

    host.publish({ status: 'ready', value: { diffExpansion: 'none', railVisibility: 'show' } })
    expect(policy.expansion.getSnapshot()).toBe('none')
    expect(host.set).not.toHaveBeenCalled()

    // A republication of the value already held changes nothing.
    host.publish({ value: { diffExpansion: 'none', railVisibility: 'show' } })
    expect(policy.expansion.getSnapshot()).toBe('none')
  })
})

describe('DiffExpansionRow', () => {
  function bench(policy = new DiffExpansionPolicy()) {
    const setDiffExpansion = vi.fn((next: 'all' | 'single' | 'none') => { policy.set(next) })
    const props = {
      useDiffExpansion: bindSnapshotSelector(policy.expansion),
      setDiffExpansion,
      t,
    } as unknown as DiffExpansionRowProps
    return { policy, setDiffExpansion, props }
  }

  it('shows the mode in force and its explanation', () => {
    const b = bench()
    render(<DiffExpansionRow {...b.props} />)
    expect(screen.getByText(zh['settings.expansion.title'])).toBeTruthy()
    expect(screen.getByText(zh['settings.expansion.description'])).toBeTruthy()
    expect(screen.getByRole('button').textContent).toContain(zh['settings.expansion.all'])
  })

  it('opens the menu and adopts the picked mode', () => {
    const b = bench()
    const { rerender } = render(<DiffExpansionRow {...b.props} />)
    const anchor = screen.getByRole('button')
    expect(anchor.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(anchor)
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(screen.getByText(zh['settings.expansion.none']))
    expect(b.setDiffExpansion).toHaveBeenCalledWith('none')
    rerender(<DiffExpansionRow {...b.props} />)
    expect(screen.getByRole('button').textContent).toContain(zh['settings.expansion.none'])
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })

  it('closes the menu when it dismisses itself, without changing the mode', () => {
    const b = bench()
    render(<DiffExpansionRow {...b.props} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
    expect(b.setDiffExpansion).not.toHaveBeenCalled()
  })

  it('falls back to the default label for a mode this build does not know', () => {
    const policy = new DiffExpansionPolicy()
    policy.expansion.set('newer-mode' as 'all')
    const b = bench(policy)
    render(<DiffExpansionRow {...b.props} />)
    expect(screen.getByRole('button').textContent).toContain(zh['settings.expansion.all'])
  })
})
