// @vitest-environment jsdom
// The two seats: the tab-row control (count badge, running spinner, toggle) and
// the rail (list order, default selection, writing marker, the collapsed read
// section, the partial-history notice, and the width drag).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  createSnapshotStore, EMPTY_CHAT_SNAPSHOT,
  type ConversationNode, type ConversationSnapshot, type SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import { SessionFilesRailController } from '../src/client/rail-store.ts'
import type { SessionTreeState } from '../src/client/tree-controller.ts'
import { SessionFilesButton, type SessionFilesButtonProps } from '../src/client/SessionFilesButton.tsx'
import { SessionFilesRail, type SessionFilesRailProps } from '../src/client/SessionFilesRail.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const SID = 'files' as SessionId
const t = makeTranslate(zh)

function changeNode(seq: number, path: string): ConversationNode {
  return {
    kind: 'tool-result', seq, isError: false, call: { name: 'edit', argsRaw: '{}' },
    callView: { card: 'diff', locations: [{ path }] },
    resultView: { card: 'diff', diffs: [{ path, oldText: 'a', newText: 'b' }] },
  } as unknown as ConversationNode
}

function readNode(seq: number, path: string): ConversationNode {
  return {
    kind: 'tool-result', seq, isError: false, call: { name: 'read', argsRaw: '{}' },
    callView: { card: 'generic', kind: 'read', locations: [{ path }] },
    resultView: null,
  } as unknown as ConversationNode
}

function snapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: SID,
    chat: { ...EMPTY_CHAT_SNAPSHOT, timeline: { turnOrder: [1], turns: new Map([[1, { start: { seq: 0 } }]]) } },
    nodes: [], runningCalls: [], running: false, hasMore: false,
    ...overrides,
  } as unknown as ConversationSnapshot
}

/** The subagent catalog mirror the rail watches for finished descendants. */
type CatalogMirror = { subagentsByParent: Record<string, { entries: Array<{ kind: string; activity: string }> }> }

function bench(
  snap: ConversationSnapshot,
  persistKey: string,
  tree: SessionTreeState = { bySession: {} },
  catalog: CatalogMirror = { subagentsByParent: {} },
) {
  const session = createSnapshotStore<ConversationSnapshot>(snap)
  const controller = new SessionFilesRailController(persistKey)
  const trees = createSnapshotStore<SessionTreeState>(tree)
  const sessions = createSnapshotStore<CatalogMirror>(catalog)
  const shared = {
    sessionId: SID,
    useSession: bindSnapshotSelector(session),
    useSessions: bindSnapshotSelector(sessions),
    useRail: bindSnapshotSelector(controller.store),
    useTree: bindSnapshotSelector(trees),
    t,
  }
  return { session, controller, trees, sessions, shared }
}

describe('SessionFilesButton', () => {
  it('shows the changed-file count and toggles the rail', () => {
    const b = bench(snapshot({ nodes: [changeNode(10, 'a.ts'), changeNode(20, 'b.ts')] }), 'spec.button')
    const props = { ...b.shared, toggle: () => { b.controller.toggle() } } as unknown as SessionFilesButtonProps
    const { container, rerender } = render(<SessionFilesButton {...props} />)

    const button = screen.getByRole('button')
    expect(button.textContent).toContain('文件')
    expect(button.textContent).toContain('2')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe(zh['button.close'])

    fireEvent.click(button)
    rerender(<SessionFilesButton {...props} />)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe(zh['button.open'])
    expect(container.querySelector('[class*="_spinner_"]')).toBeNull()
  })

  it('replaces the count with a spinner while the agent runs', () => {
    const b = bench(snapshot({ running: true, nodes: [changeNode(10, 'a.ts')] }), 'spec.button-running')
    const props = { ...b.shared, toggle: vi.fn() } as unknown as SessionFilesButtonProps
    const { container } = render(<SessionFilesButton {...props} />)
    expect(container.querySelector('[class*="_spinner_"]')).not.toBeNull()
    expect(container.querySelector('[class*="_badge_"]')).toBeNull()
  })

  it('shows no badge for a session that changed nothing', () => {
    const b = bench(snapshot(), 'spec.button-empty')
    const props = { ...b.shared, toggle: vi.fn() } as unknown as SessionFilesButtonProps
    const { container } = render(<SessionFilesButton {...props} />)
    expect(container.querySelector('[class*="_badge_"]')).toBeNull()
  })
})

describe('SessionFilesRail', () => {
  function railProps(b: ReturnType<typeof bench>, extra: Partial<SessionFilesRailProps> = {}) {
    return {
      ...b.shared,
      setWidth: (px: number) => { b.controller.setWidth(px) },
      loadTree: vi.fn(),
      loadAll: vi.fn(),
      reveal: vi.fn(),
      ...extra,
    } as unknown as SessionFilesRailProps
  }

  it('renders nothing while the reader keeps it closed', () => {
    const b = bench(snapshot(), 'spec.rail-closed')
    b.controller.toggle()
    const { container } = render(<SessionFilesRail {...railProps(b)} />)
    expect(container.firstChild).toBeNull()
  })

  it('states that nothing has changed yet', () => {
    const b = bench(snapshot(), 'spec.rail-empty')
    render(<SessionFilesRail {...railProps(b)} />)
    expect(screen.getByText(zh['rail.empty'])).toBeTruthy()
  })

  it('lists changed files oldest first and selects the most recent by default', () => {
    const b = bench(snapshot({ nodes: [changeNode(10, 'src/old.ts'), changeNode(20, 'src/new.ts')] }), 'spec.rail-list')
    const reveal = vi.fn()
    const { container } = render(<SessionFilesRail {...railProps(b, { reveal })} />)
    const rows = [...container.querySelectorAll('[class*="_file_"]')]
    expect(rows.map(row => row.textContent)).toEqual(['old.ts+1-1', 'new.ts+1-1'])
    expect(rows[1]?.getAttribute('aria-current')).toBe('true')

    fireEvent.click(rows[0] as HTMLElement)
    expect(reveal).toHaveBeenCalledWith('src/old.ts')
    expect([...container.querySelectorAll('[class*="_file_"]')][0]?.getAttribute('aria-current')).toBe('true')
  })

  it('marks the file a running call is writing', () => {
    const b = bench(snapshot({
      running: true,
      runningCalls: [{ callId: 'c1', callView: { card: 'diff', locations: [{ path: 'live.ts' }] } }] as unknown as ConversationSnapshot['runningCalls'],
    }), 'spec.rail-writing')
    const { container } = render(<SessionFilesRail {...railProps(b)} />)
    expect(container.querySelector('[class*="_spinner_"]')).not.toBeNull()
  })

  it('collapses the read list behind its count and expands on request', () => {
    const b = bench(snapshot({ running: true, nodes: [readNode(10, 'src/one.ts')] }), 'spec.rail-read-one')
    const { container } = render(<SessionFilesRail {...railProps(b)} />)
    const toggle = screen.getByText(zh['rail.readOne']).closest('button') as HTMLElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[class*="_read_"]')).toBeNull()

    fireEvent.click(toggle)
    expect(screen.getByText('one.ts')).toBeTruthy()
    fireEvent.click(screen.getByText(zh['rail.readOne']).closest('button') as HTMLElement)
    expect(container.querySelector('[class*="_read_"]')).toBeNull()
  })

  it('counts more than one read in the plural form', () => {
    const b = bench(
      snapshot({ running: true, nodes: [readNode(10, 'a.ts'), readNode(20, 'b.ts')] }),
      'spec.rail-read-many',
    )
    render(<SessionFilesRail {...railProps(b)} />)
    expect(screen.getByText('已读取 2 个文件')).toBeTruthy()
  })

  it('re-reads the descendants when a running one finishes', () => {
    const b = bench(snapshot(), 'spec.rail-descendants', { bySession: {} }, {
      subagentsByParent: { [SID]: { entries: [{ kind: 'child', activity: 'running' }] } },
    })
    const loadTree = vi.fn()
    const { rerender } = render(<SessionFilesRail {...railProps(b, { loadTree })} />)
    expect(loadTree).toHaveBeenCalledTimes(1)

    // A rerender with the catalog unchanged asks for nothing more.
    rerender(<SessionFilesRail {...railProps(b, { loadTree })} />)
    expect(loadTree).toHaveBeenCalledTimes(1)

    act(() => {
      b.sessions.set({ subagentsByParent: { [SID]: { entries: [{ kind: 'child', activity: 'inactive' }] } } })
    })
    expect(loadTree).toHaveBeenCalledTimes(2)
  })

  it('lists what a descendant changed beside this session\'s own files', () => {
    const b = bench(
      snapshot({ nodes: [changeNode(10, 'src/local.ts')] }),
      'spec.rail-merged',
      {
        bySession: {
          [SID]: {
            status: 'ready',
            partial: true,
            error: null,
            sources: [{
              sessionId: 'child',
              label: 'reviewer',
              files: [{
                path: 'src/from-child.ts',
                firstSeq: 1,
                lastSeq: 1,
                segments: [{ turn: 2, tool: 'edit', source: 'reviewer', time: 5, oldText: 'a', newText: 'b' }],
              }],
            }],
          },
        },
      },
    )
    const { container } = render(<SessionFilesRail {...railProps(b)} />)
    const rows = [...container.querySelectorAll('[class*="_file_"]')]
    expect(rows.map(row => row.textContent)).toEqual(['local.ts+1-1', 'from-child.ts+1-1'])
    // A descendant read that left pages behind says so through the same notice.
    expect(screen.getByText(zh['rail.partial'])).toBeTruthy()
  })

  it('says the list is partial and offers to complete it', () => {
    const b = bench(snapshot({ hasMore: true }), 'spec.rail-partial')
    const loadAll = vi.fn()
    render(<SessionFilesRail {...railProps(b, { loadAll })} />)
    expect(screen.getByText(zh['rail.partial'])).toBeTruthy()
    fireEvent.click(screen.getByText(zh['rail.loadAll']))
    expect(loadAll).toHaveBeenCalledOnce()
  })

  it('drags to a new width and stops tracking on release', () => {
    const b = bench(snapshot(), 'spec.rail-drag')
    const { container, rerender } = render(<SessionFilesRail {...railProps(b)} />)
    const handle = container.querySelector('[role="separator"]') as HTMLElement

    fireEvent.pointerDown(handle, { clientX: 100 })
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 220 }))
    expect(b.controller.store.getSnapshot().width).toBe(420)

    window.dispatchEvent(new MouseEvent('pointerup'))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 40 }))
    expect(b.controller.store.getSnapshot().width).toBe(420)

    rerender(<SessionFilesRail {...railProps(b)} />)
    expect((container.querySelector('aside') as HTMLElement).style.width).toBe('420px')
  })
})
