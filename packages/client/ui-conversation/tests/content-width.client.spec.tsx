// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  bindSnapshotSelector, makeTranslate, stubSettingsScope,
} from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ContentWidthRow } from '../src/client/settings/ContentWidthRow.tsx'
import type { ContentWidthRowProps } from '../src/client/settings/ContentWidthRow.tsx'
import { ContentWidthPolicy } from '../src/client/settings/content-width-policy.ts'
import { DEFAULT_CONTENT_WIDTH_MODE } from '../src/submission-settings.ts'
import type { ContentWidthMode, ConversationSettings } from '../src/submission-settings.ts'
import { en } from '../src/client/locales.ts'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']

afterEach(() => {
  cleanup()
})

const SETTINGS: ConversationSettings = {
  busyEnter: 'queue',
  sendShortcut: 'enter',
  contentWidth: 'adaptive',
  questionNavigation: {
    previousShortcut: 'Ctrl+ArrowUp',
    nextShortcut: 'Ctrl+ArrowDown',
    focusPolicy: 'editable',
    expandButtonSide: 'right',
  },
}

describe('ContentWidthPolicy', () => {
  it('defaults to the fill mode and publishes an explicit change through the scope', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ContentWidthPolicy(host.scope)
    expect(policy.mode.getSnapshot()).toBe(DEFAULT_CONTENT_WIDTH_MODE)
    expect(policy.mode.getSnapshot()).toBe('fill')

    const changed = vi.fn()
    policy.mode.subscribe(changed)
    policy.setMode('adaptive')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(policy.mode.getSnapshot()).toBe('adaptive')
    expect(host.set).toHaveBeenCalledWith('contentWidth', 'adaptive')
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('adopts a Host preference without writing it back and leaves an identical write untouched', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ContentWidthPolicy(host.scope)
    host.publish({ status: 'ready', value: SETTINGS, revision: 1, writable: true })
    expect(policy.mode.getSnapshot()).toBe('adaptive')
    policy.setMode('adaptive')
    expect(host.set).not.toHaveBeenCalled()
  })

  it('adopts a section already standing at construction and stays process-local without a scope', () => {
    const host = stubSettingsScope<ConversationSettings>()
    host.publish({ status: 'ready', value: SETTINGS, revision: 1, writable: true })
    expect(new ContentWidthPolicy(host.scope).mode.getSnapshot()).toBe('adaptive')

    const local = new ContentWidthPolicy()
    local.setMode('adaptive')
    expect(local.mode.getSnapshot()).toBe('adaptive')
  })
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
  const policy = new ContentWidthPolicy()
  const setContentWidthMode = vi.fn((mode: ContentWidthMode) => { policy.setMode(mode) })
  const props: ContentWidthRowProps = {
    useSessions: emptySessions(),
    useSessionPendingInteraction: noPendingInteraction(),
    useResource,
    useWorkspaces: emptyWorkspaces(),
    useContentWidthMode: bindSnapshotSelector(policy.mode),
    setContentWidthMode,
    t: makeTranslate(en),
  }
  render(<ContentWidthRow {...props} />)
  return { policy, setContentWidthMode }
}

describe('ContentWidthRow', () => {
  it('shows the fill mode by default with the explanatory copy', () => {
    mount()
    expect(screen.getByText('Conversation content width')).toBeDefined()
    expect(screen.getByText('Fill the whole content area, or enable the draggable adaptive width')).toBeDefined()
    expect(screen.getByRole('button', { name: /Fill the content area/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('selects the adaptive mode and closes on an outside pointerdown', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: /Fill the content area/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Draggable' }))
    expect(b.setContentWidthMode).toHaveBeenCalledWith('adaptive')
    const trigger = screen.getByRole('button', { name: /Draggable/ })
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Fill the content area' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Fill the content area' })).toBeNull()
  })
})
