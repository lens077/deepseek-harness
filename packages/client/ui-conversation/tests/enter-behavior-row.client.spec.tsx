// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { EnterBehaviorRow } from '../src/client/settings/EnterBehaviorRow.tsx'
import type { EnterBehaviorRowProps } from '../src/client/settings/EnterBehaviorRow.tsx'
import { ComposerSubmissionPolicy } from '../src/client/input/submission-policy.ts'
import { en } from '../src/client/locales.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  }))
}

function noPendingInteraction() {
  return bindSnapshotSelector(createSnapshotStore<SessionPendingInteractionSnapshot>(new Map()))
}

function mount() {
  const policy = new ComposerSubmissionPolicy()
  const setBusyEnter = vi.fn((behavior: 'queue' | 'steer') => { policy.setBusyEnter(behavior) })
  const setSendShortcut = vi.fn((shortcut: string) => { policy.setSendShortcut(shortcut) })
  const props: EnterBehaviorRowProps = {
    useSessions: emptySessions(),
    useSessionPendingInteraction: noPendingInteraction(),
    useResource,
    useWorkspaces: emptyWorkspaces(),
    useBusyEnter: bindSnapshotSelector(policy.busyEnter),
    setBusyEnter,
    useSendShortcut: bindSnapshotSelector(policy.sendShortcut),
    setSendShortcut,
    t: makeTranslate(en, commonEn),
  }
  render(<EnterBehaviorRow {...props} />)
  return { policy, setBusyEnter, setSendShortcut }
}

function startRecording() {
  fireEvent.click(screen.getByRole('button', { name: /^Send message shortcut:/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: /^Custom/ }))
  return screen.getByRole('textbox', { name: 'Record send shortcut' })
}

describe('EnterBehaviorRow', () => {
  it.each([
    ['Alt + Enter', 'Alt+Enter'],
    ['Ctrl + Shift + Enter', 'Ctrl+Shift+Enter'],
    ['Cmd + Shift + Enter', 'Meta+Shift+Enter'],
  ])('selects the %s preset', (label, shortcut) => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: /^Send message shortcut:/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
    expect(b.setSendShortcut).toHaveBeenCalledWith(shortcut)
    expect(b.policy.sendShortcut.getSnapshot()).toBe(shortcut)
    expect(screen.queryByRole('textbox', { name: 'Record send shortcut' })).toBeNull()
  })

  it('records a custom chord and saves only on explicit confirmation', () => {
    const b = mount()
    const input = startRecording()
    expect(document.activeElement).toBe(input)
    const save = screen.getByRole('button', { name: 'Save shortcut' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.keyDown(input, { key: 's', code: 'KeyS', ctrlKey: true, altKey: true })
    expect((input as HTMLInputElement).value).toBe('Ctrl + Alt + S')
    expect(b.setSendShortcut).not.toHaveBeenCalled()
    fireEvent.click(save)
    expect(b.setSendShortcut).toHaveBeenCalledWith('Ctrl+Alt+S')
    expect(screen.getByRole('button', { name: 'Send message shortcut: Custom: Ctrl + Alt + S' })).toBeDefined()
    expect(screen.getByText('Ctrl + Alt + S sends; Enter or Shift + Enter inserts a newline.')).toBeDefined()
    expect(screen.getByText('Busy only; the custom send shortcut uses the selected delivery mode.')).toBeDefined()
    expect(screen.queryByRole('textbox', { name: 'Record send shortcut' })).toBeNull()
  })

  it('discards a candidate on Escape and on Cancel without saving', () => {
    const b = mount()
    const input = startRecording()
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Record send shortcut' })).toBeNull()
    const reopened = startRecording()
    fireEvent.keyDown(reopened, { key: 'Enter', altKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(b.setSendShortcut).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send message shortcut: Enter' })).toBeDefined()
  })

  it.each([
    [{ key: 'a' }, 'Hold at least Ctrl, Cmd, or Alt, then press another key.'],
    [{ key: 'Enter', shiftKey: true }, 'Hold at least Ctrl, Cmd, or Alt, then press another key.'],
    [{ key: 'v', code: 'KeyV', ctrlKey: true }, 'This combination is reserved for editing or browser actions. Choose another.'],
    [{ key: 'Tab', ctrlKey: true }, 'This combination is reserved for editing or browser actions. Choose another.'],
    [{ key: 'F13', altKey: true }, 'This key is not supported. Use a letter, number, Enter, Space, arrow key, or function key.'],
  ])('refuses invalid recording %# without changing the saved shortcut', (event, message) => {
    const b = mount()
    const input = startRecording()
    fireEvent.keyDown(input, { key: 'Enter', altKey: true })
    fireEvent.keyDown(input, event)
    expect(screen.getByRole('alert').textContent).toBe(message)
    expect((screen.getByRole('button', { name: 'Save shortcut' }) as HTMLButtonElement).disabled).toBe(true)
    expect(b.setSendShortcut).not.toHaveBeenCalled()
  })

  it('ignores held modifiers, IME, and repeated keys while recording', () => {
    mount()
    const input = startRecording()
    fireEvent.keyDown(input, { key: 'Control', ctrlKey: true })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, keyCode: 229 })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, repeat: true })
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByRole('button', { name: 'Save shortcut' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('displays physical Option-letter chords and resets only the send preference', () => {
    const b = mount()
    act(() => { b.policy.setBusyEnter('steer') })
    const input = startRecording()
    fireEvent.keyDown(input, { key: 'ß', code: 'KeyS', altKey: true })
    expect((input as HTMLInputElement).value).toBe('Alt + S')
    fireEvent.click(screen.getByRole('button', { name: 'Save shortcut' }))
    expect(b.policy.sendShortcut.getSnapshot()).toBe('Alt+S')
    fireEvent.click(screen.getByRole('button', { name: 'Restore default (Enter sends)' }))
    expect(b.policy.sendShortcut.getSnapshot()).toBe('enter')
    expect(b.policy.busyEnter.getSnapshot()).toBe('steer')
  })

  it('explains the busy-only scope and shows Queue by default', () => {
    mount()
    expect(screen.getByText('Send behavior while busy')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Send message shortcut: Enter' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.getByText('Enter sends; Shift + Enter inserts a newline.')).toBeDefined()
    expect(screen.getByText('Busy only; Cmd/Ctrl+Enter uses the other behavior')).toBeDefined()
    expect(screen.getByRole('button', { name: /Queue/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('selects the send shortcut independently and follows later preference changes', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Send message shortcut: Enter' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ctrl / Cmd + Enter' }))
    expect(b.setSendShortcut).toHaveBeenCalledWith('mod-enter')
    expect(b.setBusyEnter).not.toHaveBeenCalled()
    expect(screen.queryByRole('menuitem', { name: 'Ctrl / Cmd + Enter' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Send message shortcut: Ctrl / Cmd + Enter' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Send behavior while busy: Queue' })).toBeDefined()
    expect(screen.getByText('Enter inserts a newline; Ctrl + Enter or Cmd + Enter sends. Shift + Enter also inserts a newline.')).toBeDefined()
    expect(screen.getByText('Busy only; Ctrl / Cmd + Enter uses the selected delivery mode.')).toBeDefined()
    expect(screen.queryByText('Busy only; Cmd/Ctrl+Enter uses the other behavior')).toBeNull()

    act(() => { b.policy.setSendShortcut('enter') })
    expect(screen.getByRole('button', { name: 'Send message shortcut: Enter' })).toBeDefined()
    expect(screen.getByText('Busy only; Cmd/Ctrl+Enter uses the other behavior')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Send message shortcut: Enter' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Ctrl / Cmd + Enter' })).toBeNull()
  })

  it('selects Steer, follows later preference changes, and closes outside', () => {
    const b = mount()
    const trigger = screen.getByRole('button', { name: /Queue/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Steer' }))
    expect(b.setBusyEnter).toHaveBeenCalledWith('steer')
    expect(screen.getByRole('button', { name: /Steer/ })).toBeDefined()

    act(() => { b.policy.setBusyEnter('queue') })
    const queueTrigger = screen.getByRole('button', { name: /Queue/ })
    fireEvent.click(queueTrigger)
    expect(screen.getByRole('menuitem', { name: 'Steer' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Steer' })).toBeNull()
  })
})
