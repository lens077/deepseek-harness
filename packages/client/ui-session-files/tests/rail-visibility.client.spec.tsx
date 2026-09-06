// @vitest-environment jsdom
// The Files-surface visibility preference: its shipped default, the durable
// adoption a Host acceptance drives, the write a change makes, the
// process-local arm for a composition without a settings provider, the
// Conversation-layout section column, and the Settings row that drives it.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  ConversationLayoutSection, type ConversationLayoutSectionProps,
} from '../src/client/ConversationLayoutSection.tsx'
import { DEFAULT_RAIL_VISIBILITY, RailVisibilityPolicy } from '../src/client/rail-visibility.ts'
import { FilesVisibilityRow, type FilesVisibilityRowProps } from '../src/client/FilesVisibilityRow.tsx'
import type { SessionFilesSettings } from '../src/diff-settings.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

describe('RailVisibilityPolicy', () => {
  it('ships showing the Files surface', () => {
    expect(new RailVisibilityPolicy().visibility.getSnapshot()).toBe(DEFAULT_RAIL_VISIBILITY)
    expect(DEFAULT_RAIL_VISIBILITY).toBe('show')
  })

  it('stays process-local without a settings provider', () => {
    const policy = new RailVisibilityPolicy()
    policy.set('hide')
    expect(policy.visibility.getSnapshot()).toBe('hide')
  })

  it('publishes the change before the durable write and skips a no-op', () => {
    const host = stubSettingsScope<SessionFilesSettings>()
    const policy = new RailVisibilityPolicy(host.scope)
    policy.set('hide')
    expect(policy.visibility.getSnapshot()).toBe('hide')
    expect(host.set).toHaveBeenCalledWith('railVisibility', 'hide')

    host.set.mockClear()
    policy.set('hide')
    expect(host.set).not.toHaveBeenCalled()
  })

  it('adopts a Host acceptance without writing it back', () => {
    const host = stubSettingsScope<SessionFilesSettings>()
    const policy = new RailVisibilityPolicy(host.scope)
    // Loading: no value yet, so the shipped default stands.
    expect(policy.visibility.getSnapshot()).toBe('show')

    host.publish({ status: 'ready', value: { diffExpansion: 'all', railVisibility: 'hide' } })
    expect(policy.visibility.getSnapshot()).toBe('hide')
    expect(host.set).not.toHaveBeenCalled()

    // A republication of the value already held changes nothing.
    host.publish({ value: { diffExpansion: 'all', railVisibility: 'hide' } })
    expect(policy.visibility.getSnapshot()).toBe('hide')
  })

  it('reads an accepted section missing the field as the shipped default', () => {
    const host = stubSettingsScope<SessionFilesSettings>()
    const policy = new RailVisibilityPolicy(host.scope)
    policy.set('hide')
    // A Host still serving the section from before the field existed vouches
    // for no choice, not for hiding: the shipped default stands.
    host.publish({ status: 'ready', value: { diffExpansion: 'all' } as SessionFilesSettings })
    expect(policy.visibility.getSnapshot()).toBe('show')
  })
})

describe('ConversationLayoutSection', () => {
  it('renders its row seat as one column', () => {
    const renderSlot = vi.fn(() => null)
    render(<ConversationLayoutSection {...({ renderSlot } as unknown as ConversationLayoutSectionProps)} />)
    expect(renderSlot).toHaveBeenCalledWith('settings.conversation-layout.item', {})
  })
})

describe('FilesVisibilityRow', () => {
  function bench(policy = new RailVisibilityPolicy()) {
    const setFilesVisibility = vi.fn((next: 'show' | 'hide') => { policy.set(next) })
    const props = {
      useFilesVisibility: bindSnapshotSelector(policy.visibility),
      setFilesVisibility,
      t,
    } as unknown as FilesVisibilityRowProps
    return { policy, setFilesVisibility, props }
  }

  it('shows the mode in force and its explanation', () => {
    const b = bench()
    render(<FilesVisibilityRow {...b.props} />)
    expect(screen.getByText(zh['settings.visibility.title'])).toBeTruthy()
    expect(screen.getByText(zh['settings.visibility.description'])).toBeTruthy()
    expect(screen.getByRole('button').textContent).toContain(zh['settings.visibility.show'])
  })

  it('opens the menu and adopts the picked mode', () => {
    const b = bench()
    const { rerender } = render(<FilesVisibilityRow {...b.props} />)
    const anchor = screen.getByRole('button')
    expect(anchor.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(anchor)
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(screen.getByText(zh['settings.visibility.hide']))
    expect(b.setFilesVisibility).toHaveBeenCalledWith('hide')
    rerender(<FilesVisibilityRow {...b.props} />)
    expect(screen.getByRole('button').textContent).toContain(zh['settings.visibility.hide'])
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })

  it('closes the menu when it dismisses itself, without changing the mode', () => {
    const b = bench()
    render(<FilesVisibilityRow {...b.props} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
    expect(b.setFilesVisibility).not.toHaveBeenCalled()
  })

  it('falls back to the default label for a mode this build does not know', () => {
    const policy = new RailVisibilityPolicy()
    policy.visibility.set('sometimes' as 'show')
    const b = bench(policy)
    render(<FilesVisibilityRow {...b.props} />)
    expect(screen.getByRole('button').textContent).toContain(zh['settings.visibility.show'])
  })
})
