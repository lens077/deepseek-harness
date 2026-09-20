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
  DEFAULT_TURN_RAIL_LAYOUT, type TurnRailLayout,
} from '../src/client/turn-rail-layout.ts'
import { TurnRailLayoutRow, type TurnRailLayoutRowProps } from '../src/client/settings/TurnRailLayoutRow.tsx'
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

function mount(layout: TurnRailLayout = DEFAULT_TURN_RAIL_LAYOUT) {
  const source = createSnapshotStore(layout)
  const setTurnRailLayout = vi.fn((next: TurnRailLayout) => { source.set(next) })
  const props: TurnRailLayoutRowProps = {
    useSessions: emptySessions(),
    useSessionPendingInteraction: noPendingInteraction(),
    useWorkspaces: emptyWorkspaces(),
    useResource,
    useTurnRailLayout: bindSnapshotSelector(source),
    setTurnRailLayout,
    t: makeTranslate(en),
  }
  render(<TurnRailLayoutRow {...props} />)
  return { setTurnRailLayout }
}

describe('TurnRailLayoutRow', () => {
  it('explains the preference and shows the stacked default', () => {
    mount()
    expect(screen.getByText(en['settings.turnRail.title'])).toBeDefined()
    expect(screen.getByText(en['settings.turnRail.description'])).toBeDefined()
    const trigger = screen.getByRole('button', { name: en['settings.turnRail.stacked'] })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('moves the rail to its own column at each alignment and follows the mirrored value', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: en['settings.turnRail.stacked'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: en['settings.turnRail.columnBottom'] }))
    expect(b.setTurnRailLayout).toHaveBeenCalledWith({ placement: 'column', alignment: 'bottom' })

    // The trigger now reads the mirrored destination, and the menu offers the rest.
    const trigger = screen.getByRole('button', { name: en['settings.turnRail.columnBottom'] })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: en['settings.turnRail.columnCenter'] }))
    expect(b.setTurnRailLayout).toHaveBeenLastCalledWith({ placement: 'column', alignment: 'center' })

    fireEvent.click(screen.getByRole('button', { name: en['settings.turnRail.columnCenter'] }))
    fireEvent.click(screen.getByRole('menuitem', { name: en['settings.turnRail.stacked'] }))
    expect(b.setTurnRailLayout).toHaveBeenLastCalledWith({ placement: 'stacked', alignment: 'top' })
  })

  it('closes on an outside press without changing the layout', () => {
    const b = mount({ placement: 'column', alignment: 'top' })
    fireEvent.click(screen.getByRole('button', { name: en['settings.turnRail.columnTop'] }))
    expect(screen.getByRole('menuitem', { name: en['settings.turnRail.stacked'] })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: en['settings.turnRail.stacked'] })).toBeNull()
    expect(b.setTurnRailLayout).not.toHaveBeenCalled()
  })
})
