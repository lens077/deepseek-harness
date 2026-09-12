// @vitest-environment jsdom
// The two seats: the tab-row control (count badge, running spinner, toggle) and
// the rail (list order, default selection, writing marker, the collapsed read
// section, the partial-history notice, and the width drag).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  EMPTY_CHAT_SNAPSHOT, type ConversationNode, type RunningToolCall,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { type SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionFilesRailController } from '../src/client/rail-store.ts'
import type { SessionTreeState } from '../src/client/tree-controller.ts'
import { SessionFilesButton, type SessionFilesButtonProps } from '../src/client/SessionFilesButton.tsx'
import { SessionFilesRail, type SessionFilesRailProps } from '../src/client/SessionFilesRail.tsx'
import type { SessionFilesSnapshot } from '../src/client/session-files.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const SID = 'files' as SessionId
const t = makeTranslate(zh)

function changeNode(seq: number, path: string): ConversationNode {
  return {
    kind: 'tool-result', seq, time: seq, callId: `call-${seq}`, isError: false,
    call: { name: 'edit', argsRaw: JSON.stringify({ file_path: path }) },
    callTime: seq - 1, content: [], subCalls: [],
    meta: { diffs: [{ path, oldText: 'a', newText: 'b' }] },
  } as unknown as ConversationNode
}

function readNode(seq: number, path: string): ConversationNode {
  return {
    kind: 'tool-result', seq, time: seq, callId: `call-${seq}`, isError: false,
    call: { name: 'read', argsRaw: JSON.stringify({ file_path: path }) },
    callTime: seq - 1, content: [], subCalls: [],
  } as unknown as ConversationNode
}

function snapshot(overrides: Partial<Omit<SessionFilesSnapshot, 'chat'>> & {
  nodes?: readonly ConversationNode[]
  runningCalls?: readonly RunningToolCall[]
} = {}): SessionFilesSnapshot {
  const { nodes = [], runningCalls = [], running = false, hasMore = false } = overrides
  return {
    chat: {
      ...EMPTY_CHAT_SNAPSHOT,
      timeline: { turnOrder: [1], turns: new Map([[1, { start: { seq: 0 } }]]) } as never,
      legacy: { ...EMPTY_CHAT_SNAPSHOT.legacy, nodes, runningCalls },
    },
    running,
    hasMore,
  }
}

/** The subagent catalog mirror the rail watches for finished descendants. */
type CatalogMirror = { subagentsByParent: Record<string, { entries: Array<{ kind: string; activity: string }> }> }

function bench(
  snap: SessionFilesSnapshot,
  persistKey: string,
  tree: SessionTreeState = { bySession: {} },
  catalog: CatalogMirror = { subagentsByParent: {} },
) {
  const session = createSnapshotStore({ running: snap.running, hasMore: snap.hasMore })
  const chat = createSnapshotStore(snap.chat)
  const controller = new SessionFilesRailController(persistKey)
  const trees = createSnapshotStore<SessionTreeState>(tree)
  const sessions = createSnapshotStore<CatalogMirror>(catalog)
  const shared = {
    sessionId: SID,
    useSession: bindSnapshotSelector(session),
    useChat: bindSnapshotSelector(chat),
    useSessions: bindSnapshotSelector(sessions),
    useRail: bindSnapshotSelector(controller.store),
    useTree: bindSnapshotSelector(trees),
    t,
  }
  return { session, chat, controller, trees, sessions, shared }
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

  it('groups changed files under their directory and selects the most recent by default', () => {
    const b = bench(snapshot({ nodes: [changeNode(10, 'src/old.ts'), changeNode(20, 'src/new.ts')] }), 'spec.rail-list')
    const reveal = vi.fn()
    const { container } = render(<SessionFilesRail {...railProps(b, { reveal })} />)
    const dir = container.querySelector('[class*="_dir_"]') as HTMLElement
    expect(dir.textContent).toBe('src')
    expect(dir.getAttribute('title')).toBe('src')
    expect(dir.style.paddingLeft).toBe('16px')
    const rows = [...container.querySelectorAll('[class*="_file_"]')]
    expect(rows.map(row => row.textContent)).toEqual(['new.ts+1-1', 'old.ts+1-1'])
    expect((rows[0] as HTMLElement).style.paddingLeft).toBe('30px')
    expect(rows[0]?.getAttribute('aria-current')).toBe('true')

    fireEvent.click(rows[1] as HTMLElement)
    expect(reveal).toHaveBeenCalledWith('src/old.ts')
    expect([...container.querySelectorAll('[class*="_file_"]')][1]?.getAttribute('aria-current')).toBe('true')
  })

  it('keeps the tail of an over-long directory label and titles it with the full path', () => {
    const deep = 'packages/client/ui-session-files/src/client/deep.ts'
    const b = bench(snapshot({ nodes: [changeNode(10, deep)] }), 'spec.rail-truncate')
    const { container } = render(<SessionFilesRail {...railProps(b)} />)
    const dir = container.querySelector('[class*="_dir_"]') as HTMLElement
    // The default 300px rail budgets 35 characters at depth 0; the collapsed
    // 43-character chain keeps its tail and marks the cut at the front.
    expect(dir.textContent).toBe('…client/ui-session-files/src/client')
    expect(dir.getAttribute('title')).toBe('packages/client/ui-session-files/src/client')
  })

  it('marks the file a running call is writing', () => {
    const b = bench(snapshot({
      running: true,
      runningCalls: [{
        callId: 'c1', name: 'edit', argsRaw: JSON.stringify({ file_path: 'live.ts' }),
        turn: 1, step: 1, time: 1, subCalls: [],
      }],
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
    // Reads stay a flat recency list; the full path carries the directory.
    expect(screen.getByText('src/one.ts')).toBeTruthy()
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
    expect(rows.map(row => row.textContent)).toEqual(['from-child.ts+1-1', 'local.ts+1-1'])
    // One `src` group holds both, whoever recorded them.
    expect(container.querySelector('[class*="_dir_"]')?.textContent).toBe('src')
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
