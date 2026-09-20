// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  ACTION_CONTROL_SIZE_MAX, ACTION_CONTROL_SIZE_MIN, ACTION_CONTROL_SIZE_STEP,
  DEFAULT_ACTION_CONTROL_SIZE, clampActionControlSize,
} from '../src/chat-settings.ts'
import {
  PixelStepperRow, type PixelPreferenceDescriptor, type PixelStepperRowProps,
} from '../src/client/settings/PixelStepperRow.tsx'

/** The action-control size preference, as apply() describes it to the row. */
const SIZE_PREFERENCE: PixelPreferenceDescriptor = {
  title: 'settings.actionSize.title',
  description: 'settings.actionSize.description',
  shrink: 'settings.actionSize.shrink',
  enlarge: 'settings.actionSize.enlarge',
  min: ACTION_CONTROL_SIZE_MIN,
  max: ACTION_CONTROL_SIZE_MAX,
}
import { en } from '../src/client/locale.ts'

afterEach(cleanup)

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

// The resource hook the resources plugin merges into GlobalStandardProps; this row reads no address.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']

function mount(size: number = DEFAULT_ACTION_CONTROL_SIZE, preference: PixelPreferenceDescriptor = SIZE_PREFERENCE) {
  const source = createSnapshotStore(size)
  const zoomPixels = vi.fn((steps: number) => {
    source.set(clampActionControlSize(source.getSnapshot() + steps * ACTION_CONTROL_SIZE_STEP))
  })
  const props: PixelStepperRowProps = {
    useSessions: emptySessions(),
    useSessionPendingInteraction: noPendingInteraction(),
    useWorkspaces: emptyWorkspaces(),
    useResource,
    usePixelValue: bindSnapshotSelector(source),
    zoomPixels,
    preference,
    t: makeTranslate(en),
  }
  render(<PixelStepperRow {...props} />)
  return { zoomPixels, source }
}

const shrink = () => screen.getByRole('button', { name: en['settings.actionSize.shrink'] })
const enlarge = () => screen.getByRole('button', { name: en['settings.actionSize.enlarge'] })

describe('PixelStepperRow', () => {
  it('explains the preference and reads the standing size in px', () => {
    mount()
    expect(screen.getByText(en['settings.actionSize.title'])).toBeDefined()
    expect(screen.getByText(en['settings.actionSize.description'])).toBeDefined()
    expect(screen.getByText(`${String(DEFAULT_ACTION_CONTROL_SIZE)} px`)).toBeDefined()
  })

  it('zooms in both directions and follows the mirrored value', () => {
    const b = mount()
    fireEvent.click(enlarge())
    expect(b.zoomPixels).toHaveBeenCalledWith(1)
    expect(screen.getByText(`${String(DEFAULT_ACTION_CONTROL_SIZE + ACTION_CONTROL_SIZE_STEP)} px`)).toBeDefined()

    fireEvent.click(shrink())
    expect(b.zoomPixels).toHaveBeenCalledWith(-1)
    expect(screen.getByText(`${String(DEFAULT_ACTION_CONTROL_SIZE)} px`)).toBeDefined()
  })

  it('disables the step that would leave the accepted range', () => {
    mount(ACTION_CONTROL_SIZE_MIN)
    expect(shrink().hasAttribute('disabled')).toBe(true)
    expect(enlarge().hasAttribute('disabled')).toBe(false)
    cleanup()

    mount(ACTION_CONTROL_SIZE_MAX)
    expect(enlarge().hasAttribute('disabled')).toBe(true)
    expect(shrink().hasAttribute('disabled')).toBe(false)
  })
})
