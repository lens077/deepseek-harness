// @vitest-environment jsdom
/**
 * Session-row range and toggle selection driven through the assembled
 * WorkspaceBrowser: the specs press rows and keys the way a user does and
 * assert the visible selection, rather than calling the pure model directly
 * (selection.client.spec.ts covers that).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  SessionId, SessionListState, SessionSummary, WorkspaceId, WorkspaceListState, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { WorkspaceBrowserProps } from '../src/client/contract/slots.ts'
import { createWorkspaceViewStore } from '../src/client/stores.ts'
import { createSessionSelectionStore } from '../src/client/selectionStore.ts'
import { WorkspaceBrowser } from '../src/client/WorkspaceBrowser.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

const t: WorkspaceBrowserProps['t'] = makeTranslate(zh, commonZh)
const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId

const summary = (id: string, updatedAt: number): SessionSummary => ({
  id: sid(id), displayTitle: id, running: false, blank: false, updatedAt,
})
const sessionState = (items: readonly SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined,
  phase: 'ready',
  subagentsByParent: {}, jobsBySession: {},
  currentAddress: undefined,
})
const workspace = (id: string, sessionIds: string[]): WorkspaceView => ({
  workspaceId: wid(id), path: `/projects/${id}`, title: id,
  sessionIds: sessionIds.map(sid), nestedUnder: {}, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
const workspaceState = (items: readonly WorkspaceView[]): WorkspaceListState => ({
  items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true,
  recentWorkspaceId: items[0]?.workspaceId,
})
function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

/** Three sessions in one workspace, expanded, with the browser fully mounted. */
function mountRows(names: readonly string[], overrides: Partial<WorkspaceBrowserProps> = {}) {
  const store = createWorkspaceViewStore().create()
  const selection = createSessionSelectionStore().create()
  const items = names.map((name, index) => summary(name, names.length - index))
  const props: WorkspaceBrowserProps = {
    wide: true,
    expandSidebar: vi.fn(),
    useSessions: hook(sessionState(items)),
    useWorkspaces: hook(workspaceState([workspace('alpha', [...names])])),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    startSession: vi.fn(),
    open: vi.fn(),
    searchSessions: vi.fn(async () => ({ items: [], hasMore: false })),
    searchResultLimit: 20,
    renameSession: vi.fn(async () => {}),
    sessionDirectories: vi.fn(async () => ({ primaryDirectory: '/projects/alpha', additionalDirectories: [] })),
    replaceSessionDirectories: vi.fn(async (_sessionId, additionalDirectories) => ({
      primaryDirectory: '/projects/alpha', additionalDirectories: [...additionalDirectories],
    })),
    forkSession: vi.fn(),
    renameWorkspace: vi.fn(async () => {}),
    deleteWorkspace: vi.fn(async () => {}),
    archiveSession: vi.fn(async () => {}),
    archiveSessions: vi.fn(async () => {}),
    unarchiveSession: vi.fn(async () => {}),
    deleteSession: vi.fn(async sessionId => [sessionId]),
    addTodos: vi.fn(),
    todosAvailable: () => false,
    setSessionMembership: vi.fn(async (workspaceId, sessionIds) => workspace(String(workspaceId), sessionIds)),
    insertWorkspaceBefore: vi.fn(async () => {}),
    insertSessionBefore: vi.fn(async () => {}),
    createWorkspace: vi.fn(async () => workspace('created', [])),
    useDirectoryFlow: bindSnapshotSelector({ getSnapshot: () => true, subscribe: () => () => {} }),
    useSessionDirectoryFlow: bindSnapshotSelector({ getSnapshot: () => true, subscribe: () => () => {} }),
    useHostDescription: selector => selector(undefined),
    useSessionSelection: bindSnapshotSelector(selection),
    setSessionSelection: (next) => { selection.actions.setSelection(next) },
    clearSessionSelection: () => { selection.actions.clearSelection() },
    renderSlot: (() => null) as never,
    t,
    ...overrides,
  }
  render(<WorkspaceBrowser {...props} />)
  // The workspace group starts folded; open it so the session rows render.
  fireEvent.click(screen.getByText('alpha'))
  return { props, store, selection }
}

/** The session rows, dropping the leading workspace header treeitem. */
function rows(): HTMLElement[] {
  return screen.getAllByRole('treeitem').slice(1)
}

/**
 * Selected row titles, in visible order. The title is the row's first element
 * child carrying it; reading `textContent` would also pick up the relative
 * time and the screen-reader status labels.
 */
function selectedTitles(): string[] {
  return rows()
    .filter(row => row.getAttribute('aria-selected') === 'true')
    .map(row => row.querySelector('span:not([class*="slot"])')?.textContent ?? '')
}

describe('session row multi-selection', () => {
  it('opens the session on a plain click and selects only that row', () => {
    const { props } = mountRows(['one', 'two', 'three'])
    fireEvent.click(rows()[1] as HTMLElement)
    expect(props.open).toHaveBeenCalledWith(sid('two'))
    expect(selectedTitles()).toEqual(['two'])
  })

  it('ctrl-click adds rows without opening any of them', () => {
    const { props } = mountRows(['one', 'two', 'three'])
    fireEvent.click(rows()[0] as HTMLElement, { ctrlKey: true })
    fireEvent.click(rows()[2] as HTMLElement, { ctrlKey: true })
    expect(props.open).not.toHaveBeenCalled()
    expect(selectedTitles()).toEqual(['one', 'three'])
  })

  it('ctrl-click on a selected row removes it again', () => {
    mountRows(['one', 'two', 'three'])
    fireEvent.click(rows()[0] as HTMLElement, { ctrlKey: true })
    fireEvent.click(rows()[1] as HTMLElement, { ctrlKey: true })
    expect(selectedTitles()).toEqual(['one', 'two'])
    fireEvent.click(rows()[0] as HTMLElement, { ctrlKey: true })
    expect(selectedTitles()).toEqual(['two'])
  })

  it('shift-click selects the inclusive range from the anchor without opening', () => {
    const { props } = mountRows(['one', 'two', 'three', 'four'])
    fireEvent.click(rows()[0] as HTMLElement)
    expect(props.open).toHaveBeenCalledTimes(1)
    fireEvent.click(rows()[2] as HTMLElement, { shiftKey: true })
    expect(selectedTitles()).toEqual(['one', 'two', 'three'])
    // The range gesture itself never opens a session.
    expect(props.open).toHaveBeenCalledTimes(1)
  })

  it('a second shift-click re-ranges from the same anchor instead of growing', () => {
    mountRows(['one', 'two', 'three', 'four'])
    fireEvent.click(rows()[0] as HTMLElement)
    fireEvent.click(rows()[3] as HTMLElement, { shiftKey: true })
    expect(selectedTitles()).toEqual(['one', 'two', 'three', 'four'])
    fireEvent.click(rows()[1] as HTMLElement, { shiftKey: true })
    expect(selectedTitles()).toEqual(['one', 'two'])
  })

  it('includes expanded nested children in a shift range', () => {
    const nested = {
      ...workspace('alpha', ['parent', 'child', 'peer']),
      nestedUnder: { child: sid('parent') },
    }
    mountRows(['parent', 'child', 'peer'], {
      useWorkspaces: hook(workspaceState([nested])),
    })

    fireEvent.click(rows()[0] as HTMLElement)
    fireEvent.click(rows()[2] as HTMLElement, { shiftKey: true })

    expect(selectedTitles()).toEqual(['parent', 'child', 'peer'])
  })

  it('ctrl+shift-click unions a second range onto the existing selection', () => {
    mountRows(['one', 'two', 'three', 'four'])
    fireEvent.click(rows()[0] as HTMLElement, { ctrlKey: true })
    fireEvent.click(rows()[2] as HTMLElement, { ctrlKey: true })
    fireEvent.click(rows()[3] as HTMLElement, { ctrlKey: true, shiftKey: true })
    expect(selectedTitles()).toEqual(['one', 'three', 'four'])
  })

  it('ctrl+A selects every visible row and Escape clears the selection', () => {
    mountRows(['one', 'two', 'three'])
    const tree = screen.getByRole('tree')
    fireEvent.keyDown(tree, { key: 'a', ctrlKey: true })
    expect(selectedTitles()).toEqual(['one', 'two', 'three'])
    fireEvent.keyDown(tree, { key: 'Escape' })
    expect(selectedTitles()).toEqual([])
  })

  it('arrow keys move the selection and shift+arrow extends it', () => {
    mountRows(['one', 'two', 'three'])
    const tree = screen.getByRole('tree')
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(selectedTitles()).toEqual(['one'])
    fireEvent.keyDown(tree, { key: 'ArrowDown' })
    expect(selectedTitles()).toEqual(['two'])
    fireEvent.keyDown(tree, { key: 'ArrowDown', shiftKey: true })
    expect(selectedTitles()).toEqual(['two', 'three'])
    fireEvent.keyDown(tree, { key: 'ArrowUp', shiftKey: true })
    expect(selectedTitles()).toEqual(['two'])
  })

  it('a range never reaches rows hidden behind the overflow cut', () => {
    // Seven sessions with the default five-row cut: the last two are not
    // rendered, so ctrl+A must stop at the visible five.
    mountRows(['s1', 's2', 's3', 's4', 's5', 's6', 's7'])
    expect(rows()).toHaveLength(5)
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'a', ctrlKey: true })
    expect(selectedTitles()).toEqual(['s1', 's2', 's3', 's4', 's5'])
  })

  it('marks the tree multi-selectable only while the setting is on', () => {
    const { store } = mountRows(['one', 'two'])
    expect(screen.getByRole('tree').getAttribute('aria-multiselectable')).toBe('true')
    act(() => { store.actions.setMultiSelect(false) })
    expect(screen.getByRole('tree').getAttribute('aria-multiselectable')).toBeNull()
  })

  it('with the setting off, modified clicks just open the session', () => {
    const { props, store } = mountRows(['one', 'two', 'three'])
    act(() => { store.actions.setMultiSelect(false) })
    fireEvent.click(rows()[0] as HTMLElement, { ctrlKey: true })
    expect(props.open).toHaveBeenCalledWith(sid('one'))
    fireEvent.click(rows()[2] as HTMLElement, { shiftKey: true })
    expect(props.open).toHaveBeenCalledWith(sid('three'))
    expect(selectedTitles()).toEqual([])
  })

  it('turning the setting off drops a selection made while it was on', () => {
    const { store, selection } = mountRows(['one', 'two', 'three'])
    fireEvent.click(rows()[0] as HTMLElement, { ctrlKey: true })
    fireEvent.click(rows()[1] as HTMLElement, { ctrlKey: true })
    expect(selection.getSnapshot().selected).toHaveLength(2)
    act(() => { store.actions.setMultiSelect(false) })
    expect(selection.getSnapshot().selected).toHaveLength(0)
  })

  it('does not start a reorder drag from a modified press', () => {
    mountRows(['one', 'two', 'three'])
    const row = rows()[0] as HTMLElement
    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true })
    Object.defineProperty(dragStart, 'ctrlKey', { value: true })
    Object.defineProperty(dragStart, 'dataTransfer', {
      value: { effectAllowed: '', dropEffect: '', setData: vi.fn() },
    })
    fireEvent(row, dragStart)
    expect(dragStart.defaultPrevented).toBe(true)
  })
})
