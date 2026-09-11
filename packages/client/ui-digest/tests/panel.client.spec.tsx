// @vitest-environment jsdom
/**
 * Inbox panel and sidebar entry behavior against directly supplied props: the
 * closed panel renders nothing, sections and cards carry their state and
 * actions, the window/workspace/handled controls drive the store, the
 * keyboard ring triages without the mouse, the todo and timeline tabs open
 * sessions at the right place, the brief reaches the clipboard, and the entry
 * shows the attention badge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { InboxSnapshot } from '@deepseek-ai/dsh-session-inbox/types'
import { DigestPanel } from '../src/client/DigestPanel.tsx'
import { DigestNavEntry } from '../src/client/DigestNavEntry.tsx'
import type { NavSettingsView } from '../src/client/nav-settings-policy.ts'
import { createDigestStore } from '../src/client/stores.ts'
import type { DigestNavEntryProps, DigestPanelProps } from '../src/client/contract/slots.ts'
import type { InboxView } from '../src/client/controller.ts'
import type { ProjectTodosView } from '../src/client/projects-controller.ts'
import { zh } from '../src/client/locales.ts'
import {
  DAY, HOUR, NOW, digest, inbox, mark, project, projectFile, projectItem,
  projectsSnapshot, row, t, todo, workspace, type DigestSessionSummary,
} from './fixtures.client.ts'

const scrollIntoView = vi.fn()

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
// The viewing store persists whole-value, so a leaked key from an earlier case
// would restore an already-open panel and invert the next toggle.
beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  // jsdom implements no scrollIntoView; the ring calls it on the focused card.
  scrollIntoView.mockClear()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoView })
})

const OK = { ok: true } as const

interface MountOptions {
  rows?: DigestSessionSummary[]
  workspaces?: WorkspaceView[]
  archived?: string[]
  snapshot?: InboxSnapshot
  status?: InboxView['status']
  error?: string | null
  open?: boolean
  current?: string
  projects?: Partial<ProjectTodosView>
  mobileView?: DigestPanelProps['mobileView']
  toggleShortcut?: string
}

/** Mount the panel over a real store handle, with stub framework hooks. */
function mountPanel({
  rows = [row('a')],
  workspaces = [],
  archived = [],
  snapshot = inbox(),
  status = 'ready',
  error = null,
  open = true,
  current,
  projects = {},
  mobileView,
  toggleShortcut = 'Ctrl+1',
}: MountOptions = {}) {
  const store = createDigestStore().create()
  if (open) store.actions.open()
  else store.actions.close()
  const sessionState = { ids: rows.map(r => r.id), byId: Object.fromEntries(rows.map(r => [r.id, r])), current }
  const pendingInteractions = new Map(rows.flatMap(session => session.pendingInteraction === undefined
    ? []
    : [[session.id, { key: `pending-${session.id}`, sessionId: session.id, ...session.pendingInteraction }] as const]))
  const view: InboxView = { status, snapshot, error }
  const projectsView: ProjectTodosView = { status: 'ready', snapshot: projectsSnapshot(), error: null, scanning: false, ...projects }
  const navSettings: NavSettingsView = {
    status: 'ready', writable: true, navBadges: true, navFinishedBadge: false,
    navBadgeOrder: ['waiting', 'unread', 'running', 'failed'], toggleShortcut,
  }
  const calls = {
    navigateMobile: vi.fn(),
    ensureInbox: vi.fn(async () => OK),
    ensureProjects: vi.fn(async () => OK),
    rescanProjects: vi.fn(async () => OK),
    readProjectDocument: vi.fn(async (path: string) => ({ ok: true as const, value: { path, text: '- [ ] raw text', mtime: NOW } })),
    openProject: vi.fn(async (_path: string, _text: string | null) => OK),
    openPath: vi.fn(async (_path: string) => OK),
    openSession: vi.fn(),
    openQuestion: vi.fn(),
    continueSession: vi.fn(),
    copyText: vi.fn(async (_text: string) => true),
    setHandled: vi.fn(async () => OK),
    snooze: vi.fn(async () => OK),
    setPinned: vi.fn(async () => OK),
    markReviewed: vi.fn(async () => OK),
    addTodo: vi.fn(async () => OK),
    fileTodo: vi.fn(async () => OK),
    updateTodo: vi.fn(async () => OK),
    removeTodo: vi.fn(async () => OK),
  }
  const props = {
    mobileView,
    useStore: ((selector: (s: unknown) => unknown) => selector(store.getSnapshot())),
    actions: store.actions,
    useSessions: ((selector: (s: unknown) => unknown) => selector(sessionState)),
    useSessionPendingInteraction: ((selector: (s: unknown) => unknown) => selector(pendingInteractions)),
    useWorkspaces: ((selector: (s: unknown) => unknown) => selector({ items: workspaces, archivedSessionIds: archived })),
    useInbox: ((selector: (s: InboxView) => unknown) => selector(view)),
    useProjects: ((selector: (s: ProjectTodosView) => unknown) => selector(projectsView)),
    useNavSettings: ((selector: (s: NavSettingsView) => unknown) => selector(navSettings)),
    ...calls,
    t,
  } as unknown as DigestPanelProps
  const rendered = render(<DigestPanel {...props} />)
  const rerender = (): void => { rendered.rerender(<DigestPanel {...props} />) }
  return { view: rendered, rerender, store, ...calls }
}

function section(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-section="${key}"]`)
  if (element === null) throw new Error(`no section ${key}`)
  return element
}

describe('DigestPanel phone surfaces', () => {
  it('shares compact surface and time selectors with existing viewing state and keeps extra actions reachable', () => {
    const m = mountPanel({ mobileView: 'overview', rows: [row('unread'), row('running', { running: true })] })
    const toolbar = m.view.container.querySelector<HTMLElement>('[data-digest-compact-toolbar]')!
    const surface = within(toolbar).getByRole('combobox', { name: zh['mobile.surface'] })
    const window = within(toolbar).getByRole('combobox', { name: zh['mobile.window'] })
    fireEvent.change(surface, { target: { value: 'timeline' } })
    expect(screen.getByRole('tab', { name: zh['tab.timeline'] }).getAttribute('aria-selected')).toBe('true')
    expect(m.store.getSnapshot().tab).toBe('inbox')
    fireEvent.change(window, { target: { value: 'week' } })
    expect(m.store.getSnapshot().window).toBe('week')
    const more = toolbar.querySelector('details')!
    more.open = true
    fireEvent.click(within(more).getByRole('button', { name: '运行中 1' }))
    expect(screen.queryByText('title-unread')).toBeNull()
    expect(section('running').textContent).toContain('title-running')
    fireEvent.click(within(more).getByRole('checkbox', { name: zh['panel.showHandled'] }))
    expect(m.store.getSnapshot().showHandled).toBe(true)
    fireEvent.click(within(more).getByRole('button', { name: zh['panel.markReviewed'] }))
    expect(m.markReviewed).toHaveBeenCalledOnce()
    fireEvent.click(within(more).getByRole('button', { name: zh['panel.copyBrief'] }))
    expect(m.copyText).toHaveBeenCalledOnce()
  })

  it.each(['overview', 'pending'] as const)('discloses only one titled row at a time in %s without triaging it', (mobileView) => {
    const title = 'Investigate the login refresh race and retain the complete accessible session name'
    const m = mountPanel({ mobileView, rows: [row('a', { displayTitle: title }), row('b')] })
    const first = screen.getByRole('button', { name: new RegExp(title) })
    const second = screen.getByRole('button', { name: /title-b/ })
    expect(first.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTitle(title).textContent).toBe(title)
    expect(screen.queryByText('修一下登录的 bug')).toBeNull()
    expect(screen.queryByText('已修复：token 刷新和跳转有竞态。')).toBeNull()
    expect(screen.queryByRole('button', { name: zh['card.open'] })).toBeNull()
    fireEvent.keyDown(first, { key: 'Enter' })
    expect(m.openSession).not.toHaveBeenCalled()
    fireEvent.click(first)
    expect(first.getAttribute('aria-expanded')).toBe('true')
    const details = document.getElementById(first.getAttribute('aria-controls')!)!
    expect(details.hidden).toBe(false)
    expect(within(details).getByText('修一下登录的 bug')).toBeTruthy()
    expect(within(details).getByRole('button', { name: zh['card.open'] })).toBeTruthy()
    fireEvent.click(second)
    expect(first.getAttribute('aria-expanded')).toBe('false')
    expect(details.hidden).toBe(true)
    expect(second.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('button', { name: zh['card.open'] })).toHaveLength(1)
    fireEvent.click(second)
    expect(screen.queryByRole('button', { name: zh['card.open'] })).toBeNull()
    expect(m.setHandled).not.toHaveBeenCalled()
    expect(m.markReviewed).not.toHaveBeenCalled()
    expect(m.fileTodo).not.toHaveBeenCalled()
    expect(m.addTodo).not.toHaveBeenCalled()
  })
  it('joins questions, unread completions and personal todos without automatic failures', () => {
    const m = mountPanel({
      mobileView: 'pending', open: false, current: 'unread',
      rows: [row('unread'), row('waiting', { pendingInteraction: { kind: 'question' } }), row('running', { running: true }), row('failed', { projectionValues: { sessionDigest: digest({ outcome: 'error' }) } })],
      snapshot: inbox({ todos: [todo('manual', 'unread', { text: 'Personal follow-up' })] }),
    })
    expect(screen.getByRole('region', { name: zh['mobile.pending'] })).toBeTruthy()
    expect(section('needsYou').textContent).toContain('title-waiting')
    expect(section('unread').textContent).toContain('title-unread')
    expect(screen.getByText('Personal follow-up')).toBeTruthy()
    expect(screen.queryByText('title-running')).toBeNull()
    expect(screen.queryByText('title-failed')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['mobile.todos'] }))
    expect(scrollIntoView).toHaveBeenCalled()
    expect(m.markReviewed).not.toHaveBeenCalled()
    fireEvent.click(within(section('unread')).getByRole('button', { name: /title-unread/ }))
    fireEvent.click(within(section('unread')).getByRole('button', { name: zh['card.open'] }))
    expect(m.openSession).toHaveBeenCalledWith('unread')
    expect(m.navigateMobile).toHaveBeenCalledWith('conversation')
  })

  it('puts running work first and filters it without changing desktop viewing preferences', () => {
    const m = mountPanel({ mobileView: 'overview', rows: [row('unread'), row('running', { running: true })] })
    expect(document.querySelector('[data-section]')?.getAttribute('data-section')).toBe('running')
    const running = screen.getAllByRole('button', { name: '运行中 1' }).find(button => button.closest('[data-digest-compact-toolbar]') === null)!
    fireEvent.click(running)
    expect(screen.queryByText('title-unread')).toBeNull()
    expect(section('running').textContent).toContain('title-running')
    fireEvent.click(screen.getByRole('tab', { name: zh['tab.timeline'] }))
    expect(m.store.getSnapshot().tab).toBe('inbox')
  })
})

describe('DigestPanel inbox tab', () => {
  it('renders nothing while closed, and loads the inbox once opened', () => {
    const closed = mountPanel({ open: false })
    expect(closed.view.container.firstChild).toBeNull()
    expect(closed.ensureInbox).not.toHaveBeenCalled()
    cleanup()
    const opened = mountPanel()
    expect(opened.ensureInbox).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('region', { name: zh['panel.title'] })).toBeTruthy()
  })

  it('sections rows by why they need attention and reports the counts', () => {
    mountPanel({
      rows: [
        row('unread', { updatedAt: NOW }),
        row('failed', { projectionValues: { sessionDigest: digest({ outcome: 'interrupted', changedFiles: ['src/a.ts', 'src/b.ts'], changedFileCount: 3 }) } }),
        row('running', { running: true }),
        row('waiting', { pendingInteraction: { kind: 'question' } }),
        row('archived'),
      ],
      archived: ['archived'],
    })
    expect(section('needsYou').textContent).toContain('title-waiting')
    expect(section('failed').textContent).toContain(zh['outcome.interrupted'])
    expect(section('failed').textContent).toContain('改了 3 个文件')
    expect(section('failed').textContent).toContain('a.ts · b.ts …')
    expect(section('unread').textContent).toContain('title-unread')
    expect(section('running').textContent).toContain('title-running')
    expect(screen.queryByText('title-archived')).toBeNull()
    expect(screen.getByText('待处理 3')).toBeTruthy()
    expect(screen.getByText('运行中 1')).toBeTruthy()
    expect(screen.getByText(zh['panel.keys'].replace('{shortcut}', 'Ctrl+1'))).toBeTruthy()
  })

  it('shows the empty state, the loading state, and the error bar with retry', () => {
    const empty = mountPanel({ rows: [] })
    expect(screen.getByText(zh['panel.empty.title'])).toBeTruthy()
    cleanup()
    mountPanel({ rows: [], status: 'loading' })
    expect(screen.getByText(zh['panel.loading'])).toBeTruthy()
    cleanup()
    const failed = mountPanel({ rows: [], status: 'error', error: 'boom' })
    expect(screen.getByRole('alert').textContent).toContain('boom')
    fireEvent.click(screen.getByRole('button', { name: zh['panel.retry'] }))
    expect(failed.ensureInbox).toHaveBeenCalledTimes(2)
    expect(empty.ensureInbox).toHaveBeenCalledTimes(1)
    cleanup()
    mountPanel({ rows: [], status: 'error', error: null })
    expect(screen.getByRole('alert').textContent).toBe('收件箱读取失败：' + zh['panel.retry'])
  })

  it('renders card variants: open outcome, truncated question, missing and truncated replies, exact file lists', () => {
    mountPanel({ rows: [
      row('open', { projectionValues: { sessionDigest: digest({ outcome: null, questionTruncated: true, reply: null }) } }),
      row('cut', { projectionValues: { sessionDigest: digest({ outcome: 'error', replyTruncated: true, changedFiles: ['x.ts'], changedFileCount: 1 }) } }),
    ] })
    const failed = section('failed')
    expect(failed.textContent).toContain(zh['outcome.open'])
    expect(failed.textContent).toContain('修一下登录的 bug…')
    expect(failed.textContent).toContain(zh['card.noReply'])
    expect(failed.textContent).toContain('已修复：token 刷新和跳转有竞态。…')
    expect(failed.textContent).toContain(zh['card.truncated'])
    expect(failed.textContent).toContain('改了 1 个文件')
    expect(failed.textContent).not.toContain('x.ts …')
    // The question, reply, and files scroll inside the card; the head and
    // the action row are siblings of that region so they stay in place.
    const card = failed.querySelector('[data-session-id="cut"]') as HTMLElement
    const body = card.querySelector('[data-card-body]') as HTMLElement
    expect(body.textContent).toContain('已修复：token 刷新和跳转有竞态。…')
    expect(body.textContent).toContain('改了 1 个文件')
    expect(body.querySelector('button')).toBeNull()
    expect(card.querySelector('button')?.textContent).toBe(zh['card.open'])
    expect(body.contains(card.querySelector('[title="title-cut"]'))).toBe(false)
  })

  it('closes from the header, switches tabs by click, and counts snoozed rows', () => {
    const m = mountPanel({ rows: [row('a'), row('z')], snapshot: inbox({ sessions: [mark('z', { snoozedUntil: NOW + HOUR })] }) })
    expect(screen.getByText('已延后 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /^待办/ }))
    expect(m.store.getSnapshot().tab).toBe('todos')
    fireEvent.click(screen.getByRole('button', { name: zh['panel.close'] }))
    expect(m.store.getSnapshot().open).toBe(false)
  })

  it('files a todo from a waiting card by its title and stays on the inbox when the filing fails', async () => {
    const m = mountPanel({ rows: [row('w', { pendingInteraction: { kind: 'approval' }, projectionValues: { sessionDigest: digest({ question: null }) } })] })
    m.fileTodo.mockResolvedValueOnce({ ok: false, error: { code: 'text-blank', message: 'blank' } } as never)
    fireEvent.click(within(section('needsYou')).getByRole('button', { name: zh['card.todo'] }))
    await act(async () => { await Promise.resolve() })
    expect(m.fileTodo).toHaveBeenCalledWith({ sessionId: 'w', questionSeq: 1, text: '跟进：title-w' })
    expect(m.addTodo).not.toHaveBeenCalled()
    expect(m.store.getSnapshot().tab).toBe('inbox')
  })

  it('drives the card actions: open, continue, handled, todo, pin, snooze', async () => {
    const m = mountPanel({ rows: [row('a', { updatedAt: NOW })] })
    const card = section('unread')
    fireEvent.click(within(card).getByRole('button', { name: zh['card.handled'] }))
    expect(m.setHandled).toHaveBeenCalledWith('a', true)
    fireEvent.click(within(card).getByRole('button', { name: zh['card.pin'] }))
    expect(m.setPinned).toHaveBeenCalledWith('a', true)
    fireEvent.click(within(card).getByRole('button', { name: zh['card.snooze'] }))
    expect(m.snooze).toHaveBeenCalledWith('a', new Date(2026, 8, 17, 9, 0, 0).getTime())
    fireEvent.click(within(card).getByRole('button', { name: zh['card.todo'] }))
    expect(m.fileTodo).toHaveBeenCalledWith({ sessionId: 'a', questionSeq: 1, text: '跟进：修一下登录的 bug' })
    await act(async () => { await Promise.resolve() })
    expect(m.store.getSnapshot().tab).toBe('todos')
    m.store.actions.setTab('inbox')
    m.rerender()
    fireEvent.click(within(section('unread')).getByRole('button', { name: zh['card.continue'] }))
    expect(m.continueSession).toHaveBeenCalledWith('a', '接着上面的工作继续：\n修一下登录的 bug')
    expect(m.store.getSnapshot().open).toBe(false)
    m.store.actions.open()
    m.rerender()
    fireEvent.click(within(section('unread')).getByRole('button', { name: zh['card.open'] }))
    expect(m.openSession).toHaveBeenCalledWith('a')
    expect(m.store.getSnapshot().open).toBe(false)
  })

  it('unmarks a handled card and shortens a long question in the automatic todo text', () => {
    const long = 'x'.repeat(200)
    const m = mountPanel({
      rows: [row('a', { projectionValues: { sessionDigest: digest({ question: long }) } })],
      snapshot: inbox({ sessions: [mark('a', { handledAt: 1, pinned: true })] }),
    })
    m.store.actions.toggleShowHandled()
    m.rerender()
    const card = section('pinned')
    fireEvent.click(within(card).getByRole('button', { name: zh['card.unhandle'] }))
    expect(m.setHandled).toHaveBeenCalledWith('a', false)
    fireEvent.click(within(card).getByRole('button', { name: zh['card.unpin'] }))
    expect(m.setPinned).toHaveBeenCalledWith('a', false)
    fireEvent.click(within(card).getByRole('button', { name: zh['card.todo'] }))
    expect(m.fileTodo).toHaveBeenCalledWith({ sessionId: 'a', questionSeq: 1, text: `跟进：${'x'.repeat(120)}…` })
  })

  it('omits continue and snooze for waiting and running rows, and hides reply fields while running', () => {
    mountPanel({ rows: [
      row('w', { pendingInteraction: { kind: 'approval' } }),
      row('r', { running: true, projectionValues: { sessionDigest: digest({ question: null }) } }),
    ] })
    const waiting = section('needsYou')
    expect(within(waiting).queryByRole('button', { name: zh['card.continue'] })).toBeNull()
    expect(within(waiting).queryByRole('button', { name: zh['card.snooze'] })).toBeNull()
    expect(waiting.textContent).toContain(zh['card.waiting'])
    const running = section('running')
    expect(running.textContent).toContain(zh['card.noQuestion'])
    expect(running.textContent).not.toContain(zh['card.reply'])
    expect(within(running).queryByRole('button', { name: zh['card.handled'] })).toBeNull()
  })

  it('switches window, workspace, and handled visibility through the store', () => {
    const m = mountPanel({
      rows: [row('a', { updatedAt: NOW - 3 * DAY }), row('b'), row('r', { running: true }), row('u')],
      workspaces: [workspace('w1', ['a', 'r'], 'Alpha'), workspace('w2', ['b'], 'Beta')],
      snapshot: inbox({ reviewedAt: NOW - DAY, sessions: [mark('a', { lastSeenSeq: 3 }), mark('b', { handledAt: 1 })] }),
    })
    expect(screen.getByRole('button', { name: /^Alpha/ }).textContent).toBe('Alpha1')
    expect(screen.getByRole('button', { name: /^Beta/ }).textContent).toBe('Beta')
    expect(screen.getByRole('button', { name: /^未分组/ }).textContent).toBe('未分组1')
    // Since review: the old seen row is out, the handled row hidden.
    expect(screen.queryByText('title-a')).toBeNull()
    expect(screen.queryByText('title-b')).toBeNull()
    expect(screen.getByText(/自 .* 起/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['window.all'] }))
    m.rerender()
    expect(m.store.getSnapshot().window).toBe('all')
    expect(screen.getByText('title-a')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: zh['panel.showHandled'] }))
    m.rerender()
    expect(screen.getByText('title-b')).toBeTruthy()
    // Chips: one per workspace plus the all chip; picking one hides the other.
    fireEvent.click(screen.getByRole('button', { name: /^Beta/ }))
    m.rerender()
    expect(m.store.getSnapshot().workspace).toBe('w2')
    expect(screen.queryByText('title-a')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^未分组/ }))
    m.rerender()
    expect(m.store.getSnapshot().workspace).toBeNull()
    expect(screen.getByText('title-u')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['panel.allWorkspaces'] }))
    m.rerender()
    expect(m.store.getSnapshot().workspace).toBeUndefined()
    expect(screen.getByText('title-a')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['window.today'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['window.week'] }))
    expect(m.store.getSnapshot().window).toBe('week')
  })

  it('marks the inbox reviewed and copies the brief with a notice that fades', async () => {
    const m = mountPanel({ rows: [row('a', { projectionValues: { sessionDigest: digest({ changedFileCount: 2 }) } })] })
    fireEvent.click(screen.getByRole('button', { name: zh['panel.markReviewed'] }))
    expect(m.markReviewed).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: zh['panel.copyBrief'] }))
    await act(async () => { await Promise.resolve() })
    expect(m.copyText).toHaveBeenCalledTimes(1)
    const text = m.copyText.mock.calls[0]?.[0] ?? ''
    expect(text).toContain('# 晨报')
    expect(text).toContain('## 已完成 (1)')
    expect(text).toContain('title-a — 修一下登录的 bug (已完成) · 改了 2 个文件')
    expect(screen.getByRole('status').textContent).toBe(zh['panel.copied'])
    act(() => { vi.advanceTimersByTime(2_100) })
    expect(screen.queryByRole('status')).toBeNull()
    m.copyText.mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: zh['panel.copyBrief'] }))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('status').textContent).toBe(zh['panel.copyFailed'])
  })

  it('re-evaluates the window on the clock while open', () => {
    const m = mountPanel({ rows: [row('a', { updatedAt: NOW - 3 * DAY })], snapshot: inbox({ sessions: [mark('a', { lastSeenSeq: 3 })] }) })
    m.store.actions.setWindow('today')
    m.rerender()
    expect(screen.queryByText('title-a')).toBeNull()
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(screen.queryByText('title-a')).toBeNull()
  })
})

describe('DigestPanel keyboard ring', () => {
  function ringBench() {
    const m = mountPanel({ rows: [
      row('first', { updatedAt: NOW }),
      row('second', { updatedAt: NOW - HOUR }),
      row('run', { running: true }),
    ] })
    const focusedId = (): string | undefined =>
      document.querySelector<HTMLElement>('[data-focused]')?.dataset['sessionId']
    const press = (key: string, init: KeyboardEventInit = {}): void => {
      fireEvent.keyDown(document.body, { key, ...init })
    }
    return { ...m, focusedId, press }
  }

  it('moves with j/k and arrows, opens with Enter, and closes with Escape', () => {
    const b = ringBench()
    // Finished rows lead, so the ring starts on the newest finished row.
    expect(b.focusedId()).toBe('first')
    b.press('j')
    b.rerender()
    expect(b.focusedId()).toBe('second')
    b.press('ArrowDown')
    b.rerender()
    expect(b.focusedId()).toBe('run')
    b.press('j')
    b.rerender()
    expect(b.focusedId()).toBe('run')
    b.press('k')
    b.press('ArrowUp')
    b.press('k')
    b.rerender()
    expect(b.focusedId()).toBe('first')
    b.press('Enter')
    expect(b.openSession).toHaveBeenCalledWith('first')
    expect(b.store.getSnapshot().open).toBe(false)
    b.store.actions.open()
    b.rerender()
    b.press('Escape')
    expect(b.store.getSnapshot().open).toBe(false)
  })

  it('triages with e/t/p/s and leaves running rows and modified keys alone', () => {
    const b = ringBench()
    b.press('e')
    expect(b.setHandled).toHaveBeenCalledWith('first', true)
    b.press('t')
    expect(b.fileTodo).toHaveBeenCalledTimes(1)
    b.press('p')
    expect(b.setPinned).toHaveBeenCalledWith('first', true)
    b.press('s')
    expect(b.snooze).toHaveBeenCalledTimes(1)
    b.press('e', { metaKey: true })
    b.press('x')
    expect(b.setHandled).toHaveBeenCalledTimes(1)
    b.press('j')
    b.press('j')
    b.rerender()
    expect(b.focusedId()).toBe('run')
    b.press('e')
    b.press('s')
    expect(b.setHandled).toHaveBeenCalledTimes(1)
    expect(b.snooze).toHaveBeenCalledTimes(1)
  })

  it('ignores keys typed into editable controls and outside the inbox tab', () => {
    const b = ringBench()
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'e' })
    expect(b.setHandled).not.toHaveBeenCalled()
    input.remove()
    b.store.actions.setTab('todos')
    b.rerender()
    b.press('e')
    expect(b.setHandled).not.toHaveBeenCalled()
  })

  it('does nothing on an empty ring except closing, and skips contenteditable hosts', () => {
    const m = mountPanel({ rows: [] })
    for (const key of ['j', 'k', 'Enter', 'e', 't', 'p', 's']) fireEvent.keyDown(document, { key })
    expect(m.openSession).not.toHaveBeenCalled()
    expect(m.fileTodo).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(m.store.getSnapshot().open).toBe(false)
    cleanup()
    const b = ringBench()
    const host = document.createElement('div')
    host.setAttribute('contenteditable', 'true')
    const inner = document.createElement('span')
    host.appendChild(inner)
    document.body.appendChild(host)
    fireEvent.keyDown(inner, { key: 'e' })
    expect(b.setHandled).not.toHaveBeenCalled()
    host.remove()
  })

  it('clamps the focus when the ring shrinks', () => {
    const b = ringBench()
    b.press('j')
    b.press('j')
    b.rerender()
    expect(b.focusedId()).toBe('run')
    cleanup()
    const smaller = mountPanel({ rows: [row('only', { updatedAt: NOW })] })
    fireEvent.keyDown(document.body, { key: 'j' })
    smaller.rerender()
    expect(document.querySelector<HTMLElement>('[data-focused]')?.dataset['sessionId']).toBe('only')
  })
})

describe('DigestPanel todo tab', () => {
  it('lists todos with their session, jumps to the question, continues, completes, and removes', () => {
    const m = mountPanel({
      rows: [row('a', { projectionValues: { sessionDigest: digest({ questionSeq: 7, question: 'current' }) } })],
      snapshot: inbox({ todos: [
        todo('t1', 'a', { questionSeq: 7, text: 'fix it', createdAt: 1 }),
        todo('t2', 'a', { questionSeq: null, text: 'whole session', createdAt: 2 }),
        todo('t3', 'gone', { text: 'orphan', createdAt: 3 }),
        todo('d1', 'a', { status: 'done', text: 'done one' }),
      ] }),
      current: 'a',
    })
    m.store.actions.setTab('todos')
    m.rerender()
    const list = screen.getByRole('list', { name: zh['todos.title'] })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map(item => item.textContent)).toEqual([
      expect.stringContaining('orphan'),
      expect.stringContaining('whole session'),
      expect.stringContaining('fix it'),
      expect.stringContaining('done one'),
    ])
    expect(rows[0]?.textContent).toContain(zh['todos.missingSession'])
    expect(rows[2]?.textContent).toContain('current')
    fireEvent.click(within(rows[2]!).getByRole('button', { name: zh['todos.jump'] }))
    expect(m.openQuestion).toHaveBeenCalledWith('a', 7)
    expect(m.store.getSnapshot().open).toBe(false)
    m.store.actions.open('todos')
    m.rerender()
    fireEvent.click(within(rows[1]!).getByRole('button', { name: zh['card.open'] }))
    expect(m.openSession).toHaveBeenCalledWith('a')
    fireEvent.click(within(rows[2]!).getByRole('button', { name: zh['todos.continue'] }))
    expect(m.continueSession).toHaveBeenCalledWith('a', '接着上面的工作继续：\nfix it')
    fireEvent.click(within(rows[2]!).getByRole('checkbox'))
    expect(m.updateTodo).toHaveBeenCalledWith('t1', { status: 'done' })
    fireEvent.click(within(rows[3]!).getByRole('checkbox'))
    expect(m.updateTodo).toHaveBeenCalledWith('d1', { status: 'open' })
    fireEvent.click(within(rows[0]!).getByRole('button', { name: zh['todos.remove'] }))
    expect(m.removeTodo).toHaveBeenCalledWith('t3')
    expect(within(rows[3]!).queryByRole('button', { name: zh['todos.continue'] })).toBeNull()
  })

  it('adds a todo about the current session and clears the field on success', async () => {
    const m = mountPanel({
      rows: [row('a', { projectionValues: { sessionDigest: digest({ questionSeq: 4 }) } })],
      current: 'a',
    })
    m.store.actions.setTab('todos')
    m.rerender()
    const input = screen.getByRole('textbox', { name: zh['todos.add'] }) as HTMLInputElement
    const submit = screen.getByRole('button', { name: zh['todos.add'] }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(input, { target: { value: '  ' } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(input, { target: { value: ' write tests ' } })
    expect(submit.disabled).toBe(false)
    fireEvent.submit(input.closest('form')!)
    await act(async () => { await Promise.resolve() })
    expect(m.addTodo).toHaveBeenCalledWith({ sessionId: 'a', questionSeq: 4, text: 'write tests' })
    expect(input.value).toBe('')
    m.addTodo.mockResolvedValueOnce({ ok: false, error: { code: 'text-too-large', message: 'long' } } as never)
    fireEvent.change(input, { target: { value: 'again' } })
    fireEvent.submit(input.closest('form')!)
    await act(async () => { await Promise.resolve() })
    expect(input.value).toBe('again')
    expect(screen.getByText(zh['panel.copyFailed'])).toBeTruthy()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.submit(input.closest('form')!)
    expect(m.addTodo).toHaveBeenCalledTimes(2)
  })

  it('disables adding without a current session and shows the empty hint', () => {
    const m = mountPanel({ rows: [] })
    m.store.actions.setTab('todos')
    m.rerender()
    const input = screen.getByRole('textbox', { name: zh['todos.add'] }) as HTMLInputElement
    expect(input.disabled).toBe(true)
    expect(screen.getByText(zh['todos.empty'])).toBeTruthy()
    fireEvent.change(input, { target: { value: 'typed anyway' } })
    fireEvent.submit(input.closest('form')!)
    expect(m.addTodo).not.toHaveBeenCalled()
  })

  it('lists failed sessions as automatic todos with open, continue, and handled', () => {
    const m = mountPanel({
      rows: [
        row('f', { projectionValues: { sessionDigest: digest({ outcome: 'error' }) } }),
        row('o', { projectionValues: { sessionDigest: digest({ outcome: null }) } }),
      ],
    })
    m.store.actions.setTab('todos')
    m.rerender()
    const auto = screen.getByText(zh['todos.auto.title']).closest('section') as HTMLElement
    expect(auto.textContent).toContain('修一下登录的 bug')
    expect(auto.textContent).toContain(zh['outcome.open'])
    expect(within(auto).getAllByRole('listitem')).toHaveLength(2)
    const first = within(auto).getAllByRole('listitem')[0]!
    fireEvent.click(within(first).getByRole('button', { name: zh['card.open'] }))
    expect(m.openSession).toHaveBeenCalledWith('f')
    fireEvent.click(within(first).getByRole('button', { name: zh['todos.continue'] }))
    expect(m.continueSession).toHaveBeenCalledWith('f', zh['continue.prefill'])
    fireEvent.click(within(first).getByRole('button', { name: zh['card.handled'] }))
    expect(m.setHandled).toHaveBeenCalledWith('f', true)
  })
})

describe('DigestPanel projects tab', () => {
  const alpha = () => project('/tmp/root/alpha', [
    projectFile('/tmp/root/alpha/TODO.md', [
      projectItem('ship it', { line: 2, section: 'Alpha' }),
      projectItem('plan it', { line: 3, status: 'done' }),
      projectItem('plain bullet', { line: 4, checkbox: false, depth: 1 }),
    ]),
    projectFile('/tmp/root/alpha/notes/TODO.md', Array.from({ length: 10 }, (_, i) => projectItem(`doc ${i}`, { line: i + 1 })), { relativePath: 'notes/TODO.md', truncated: true }),
  ], { sources: ['root', 'workspace'] })
  const beta = () => project('/tmp/root/beta', [projectFile('/tmp/root/beta/TODO.md', [projectItem('finished', { status: 'done' })])], { sources: ['workspace'] })

  function openProjects(options: MountOptions = {}) {
    const m = mountPanel(options)
    fireEvent.click(screen.getByRole('tab', { name: /项目待办/ }))
    m.rerender()
    return m
  }

  it('reads the scan when the tab shows and lists projects, documents, items, and counts', () => {
    const m = openProjects({ projects: { snapshot: projectsSnapshot({ projects: [alpha(), beta()], candidates: 5, warnings: [{ path: '/tmp/root/nowhere', message: 'ENOENT' }] }) } })
    expect(m.ensureProjects).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('tab', { name: /项目待办/ }).textContent).toContain('12')
    expect(screen.getByText('扫描了 5 个目录，2 个项目有待办文档')).toBeTruthy()
    expect(screen.getByText('1 个目录或文件无法读取').getAttribute('title')).toContain('ENOENT')
    const section = document.querySelector<HTMLElement>('[data-project="/tmp/root/alpha"]')!
    expect(section.textContent).toContain('根目录')
    expect(section.textContent).toContain('工作区')
    expect(section.textContent).toContain('已完成 1')
    expect(section.textContent).toContain('ship it')
    expect(section.textContent).toContain('plain bullet')
    expect(section.textContent).toContain('2 未完成 · 1 已完成')
    expect(section.textContent).toContain('仅列出前 10 项')
    // Folded after eight items; expand and fold back.
    expect(within(section).queryByText('doc 9')).toBeNull()
    fireEvent.click(within(section).getByRole('button', { name: '还有 2 项…' }))
    expect(within(section).getByText('doc 9')).toBeTruthy()
    fireEvent.click(within(section).getByRole('button', { name: zh['projects.showLess'] }))
    expect(within(section).queryByText('doc 9')).toBeNull()
    const done = document.querySelector<HTMLElement>('[data-project="/tmp/root/beta"]')!
    expect(done.textContent).toContain(zh['projects.noOpen'])
    // The filter hides projects without open items.
    fireEvent.click(screen.getByRole('checkbox', { name: zh['projects.onlyOpen'] }))
    expect(document.querySelector('[data-project="/tmp/root/beta"]')).toBeNull()
    expect(document.querySelector('[data-project="/tmp/root/alpha"]')).toBeTruthy()
  })

  it('starts a session in the project, opens paths, and shows the document source inline', async () => {
    const m = openProjects({ projects: { snapshot: projectsSnapshot({ projects: [alpha()] }) } })
    const file = document.querySelector<HTMLElement>('[data-project-file="/tmp/root/alpha/TODO.md"]')!
    fireEvent.click(within(file).getByRole('button', { name: zh['projects.newSession'] }))
    await act(async () => { await Promise.resolve() })
    expect(m.openProject).toHaveBeenCalledWith('/tmp/root/alpha', '请阅读 TODO.md 里的待办，挑选下一项开始处理。')
    expect(m.store.getSnapshot().open).toBe(false)
    fireEvent.click(within(file).getByRole('button', { name: zh['projects.openFile'] }))
    expect(m.openPath).toHaveBeenCalledWith('/tmp/root/alpha/TODO.md')
    fireEvent.click(screen.getByRole('button', { name: zh['projects.reveal'] }))
    expect(m.openPath).toHaveBeenCalledWith('/tmp/root/alpha')
    fireEvent.click(within(file).getByRole('button', { name: zh['projects.view'] }))
    await act(async () => { await Promise.resolve() })
    expect(m.readProjectDocument).toHaveBeenCalledWith('/tmp/root/alpha/TODO.md')
    expect(within(file).getByText('- [ ] raw text')).toBeTruthy()
    fireEvent.click(within(file).getByRole('button', { name: zh['projects.hide'] }))
    expect(within(file).queryByText('- [ ] raw text')).toBeNull()
  })

  it('reports failed opens and reads, and rescans on demand', async () => {
    const m = openProjects({ projects: { snapshot: projectsSnapshot({ projects: [alpha()] }) } })
    m.openProject.mockResolvedValueOnce({ ok: false, error: { code: 'runtime', message: 'no dir' } } as never)
    m.openPath.mockResolvedValueOnce({ ok: false, error: { code: 'runtime', message: 'no app' } } as never)
    m.readProjectDocument.mockResolvedValueOnce({ ok: false, error: { code: 'not-listed', message: 'stale' } } as never)
    const file = document.querySelector<HTMLElement>('[data-project-file="/tmp/root/alpha/TODO.md"]')!
    fireEvent.click(within(file).getByRole('button', { name: zh['projects.newSession'] }))
    await act(async () => { await Promise.resolve() })
    expect(within(file).getByRole('status').textContent).toBe('打开失败：no dir')
    expect(m.store.getSnapshot().open).toBe(true)
    fireEvent.click(within(file).getByRole('button', { name: zh['projects.openFile'] }))
    await act(async () => { await Promise.resolve() })
    expect(within(file).getByRole('status').textContent).toBe('打开失败：no app')
    act(() => { vi.advanceTimersByTime(3_000) })
    expect(within(file).queryByRole('status')).toBeNull()
    fireEvent.click(within(file).getByRole('button', { name: zh['projects.view'] }))
    await act(async () => { await Promise.resolve() })
    expect(within(file).getByText('读取失败：stale')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['projects.rescan'] }))
    expect(m.rescanProjects).toHaveBeenCalledTimes(1)
  })

  it('explains an empty scan, the missing roots, and the current patterns', () => {
    openProjects({ projects: { snapshot: projectsSnapshot({ projects: [], settings: { roots: [], files: ['TODO.md', 'todo.md'], includeWorkspaces: true } }) } })
    expect(screen.getByText(zh['projects.empty.title'])).toBeTruthy()
    expect(screen.getByText(zh['projects.empty.noRoots'])).toBeTruthy()
    expect(screen.getByText('当前文件名规则：TODO.md, todo.md')).toBeTruthy()
    cleanup()
    openProjects({ projects: { status: 'loading', snapshot: projectsSnapshot({ scannedAt: null, projects: [], settings: { roots: ['/r'], files: [], includeWorkspaces: true } }) } })
    expect(screen.getAllByText(zh['projects.loading']).length).toBeGreaterThan(0)
    cleanup()
    openProjects({ projects: { status: 'cold', snapshot: projectsSnapshot({ scannedAt: null, projects: [] }) } })
    expect(screen.getByText(zh['projects.empty.title'])).toBeTruthy()
  })

  it('shows the load error with a retry and disables rescan while scanning', () => {
    const m = openProjects({ projects: { status: 'error', error: 'host down', snapshot: projectsSnapshot({ projects: [] }) } })
    expect(screen.getByRole('alert').textContent).toContain('项目待办读取失败：host down')
    fireEvent.click(screen.getByRole('button', { name: zh['panel.retry'] }))
    expect(m.rescanProjects).toHaveBeenCalledTimes(1)
    cleanup()
    openProjects({ projects: { scanning: true } })
    expect(screen.getByRole('button', { name: zh['projects.scanning'] }).hasAttribute('disabled')).toBe(true)
  })
})

describe('DigestPanel timeline tab', () => {
  it('groups questions by day with today/yesterday labels and opens the question', () => {
    const m = mountPanel({
      rows: [row('a', { projectionValues: { sessionDigest: digest({
        questionAt: NOW - HOUR,
        history: [
          { seq: 0, at: NOW - DAY, text: 'yesterday q', truncated: true, outcome: 'error', repliedAt: null, changedFileCount: 2 },
          { seq: -1, at: NOW - 5 * DAY, text: 'old q', truncated: false, outcome: null, repliedAt: null, changedFileCount: 0 },
        ],
      }) } })],
    })
    m.store.actions.setTab('timeline')
    m.store.actions.setWindow('all')
    m.rerender()
    expect(screen.getByRole('heading', { name: /^今天/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^昨天/ })).toBeTruthy()
    expect(screen.getByText('2026-09-11')).toBeTruthy()
    expect(screen.getByText(zh['timeline.current'])).toBeTruthy()
    expect(screen.getByText('改了 2 个文件')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'yesterday q…' }))
    expect(m.openQuestion).toHaveBeenCalledWith('a', 0)
    expect(m.store.getSnapshot().open).toBe(false)
  })

  it('states emptiness within the window', () => {
    const m = mountPanel({ rows: [row('a', { projectionValues: { sessionDigest: digest({ questionAt: NOW - 3 * DAY }) } })] })
    m.store.actions.setTab('timeline')
    m.store.actions.setWindow('today')
    m.rerender()
    expect(screen.getByText(zh['timeline.empty'])).toBeTruthy()
  })
})

describe('DigestNavEntry', () => {
  function mountEntry(over: {
    wide?: boolean
    rows?: DigestSessionSummary[]
    snapshot?: InboxSnapshot
    archived?: string[]
    settings?: Partial<NavSettingsView>
    mobileView?: DigestNavEntryProps['mobileView']
  } = {}) {
    const store = createDigestStore().create()
    const settings: NavSettingsView = {
      status: 'ready', writable: true, navBadges: true, navFinishedBadge: false,
      navBadgeOrder: ['waiting', 'unread', 'running', 'failed'], toggleShortcut: 'Ctrl+1', ...over.settings,
    }
    const rows = over.rows ?? [row('a')]
    const sessionState = { ids: rows.map(r => r.id), byId: Object.fromEntries(rows.map(r => [r.id, r])) }
    const pendingInteractions = new Map(rows.flatMap(session => session.pendingInteraction === undefined
      ? []
      : [[session.id, { key: `pending-${session.id}`, sessionId: session.id, ...session.pendingInteraction }] as const]))
    const view: InboxView = { status: 'ready', snapshot: over.snapshot ?? inbox(), error: null }
    const navigateMobile = vi.fn()
    const props = {
      mobileView: over.mobileView,
      navigateMobile,
      wide: over.wide ?? true,
      useStore: ((selector: (s: unknown) => unknown) => selector(store.getSnapshot())),
      actions: store.actions,
      useSessions: ((selector: (s: unknown) => unknown) => selector(sessionState)),
      useSessionPendingInteraction: ((selector: (s: unknown) => unknown) => selector(pendingInteractions)),
      useWorkspaces: ((selector: (s: unknown) => unknown) => selector({ items: [], archivedSessionIds: over.archived ?? [] })),
      useInbox: ((selector: (s: InboxView) => unknown) => selector(view)),
      useNavSettings: ((selector: (s: NavSettingsView) => unknown) => selector(settings)),
      t,
    } as unknown as DigestNavEntryProps
    const rendered = render(<DigestNavEntry {...props} />)
    return { store, navigateMobile, rerender: () => { rendered.rerender(<DigestNavEntry {...props} />) } }
  }

  it('renders phone destinations and excludes personal todos from the attention badge', () => {
    const e = mountEntry({ mobileView: 'overview', rows: [], snapshot: inbox({ todos: [todo('manual', 'a')] }) })
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([zh['mobile.overview'], zh['mobile.pending']])
    // The small layout hides these labels, so the two destinations must stay
    // distinguishable by glyph alone.
    const glyphs = screen.getAllByRole('button').map(button => button.querySelector('svg')?.innerHTML)
    expect(glyphs[0]).toBeTruthy()
    expect(glyphs[0]).not.toBe(glyphs[1])
    fireEvent.click(screen.getByRole('button', { name: zh['mobile.pending'] }))
    expect(e.navigateMobile).toHaveBeenCalledWith('pending')
    expect(e.store.getSnapshot().open).toBe(false)
    fireEvent.keyDown(document, { key: '1', code: 'Digit1', ctrlKey: true })
    expect(e.navigateMobile).toHaveBeenCalledWith('conversation')
  })

  it('toggles the shared store, reports the pressed state, and names its shortcut', () => {
    const e = mountEntry()
    const button = screen.getByRole('button', { name: /汇总/ })
    expect(screen.getByText(zh['nav.label'])).toBeTruthy()
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
    expect(e.store.getSnapshot().open).toBe(true)
    e.rerender()
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })

  it('toggles the panel on Ctrl+1 from anywhere, including a focused text field', () => {
    const e = mountEntry()
    fireEvent.keyDown(document, { key: '1', code: 'Digit1', ctrlKey: true })
    expect(e.store.getSnapshot().open).toBe(true)
    // The chord carries a modifier, so it stays live while the composer has focus.
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: '1', code: 'Digit1', ctrlKey: true })
    expect(e.store.getSnapshot().open).toBe(false)
    // A layout reporting no code still reaches the digit.
    fireEvent.keyDown(document, { key: '1', ctrlKey: true })
    expect(e.store.getSnapshot().open).toBe(true)
    input.remove()
  })

  it('ignores near-miss chords and stops listening once unmounted', () => {
    const e = mountEntry()
    for (const init of [
      { key: '1', code: 'Digit1' },
      { key: '1', code: 'Digit1', ctrlKey: true, shiftKey: true },
      { key: '1', code: 'Digit1', ctrlKey: true, altKey: true },
      { key: '1', code: 'Digit1', ctrlKey: true, metaKey: true },
      { key: '2', code: 'Digit2', ctrlKey: true },
    ]) fireEvent.keyDown(document, init)
    expect(e.store.getSnapshot().open).toBe(false)
    cleanup()
    fireEvent.keyDown(document, { key: '1', code: 'Digit1', ctrlKey: true })
    expect(e.store.getSnapshot().open).toBe(false)
  })

  it('follows the configured chord: a modified chord stays live in text fields, a bare key does not', () => {
    const e = mountEntry({ settings: { toggleShortcut: 'Ctrl+Shift+I' } })
    fireEvent.keyDown(document, { key: '1', code: 'Digit1', ctrlKey: true })
    expect(e.store.getSnapshot().open).toBe(false)
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'I', code: 'KeyI', ctrlKey: true, shiftKey: true })
    expect(e.store.getSnapshot().open).toBe(true)
    // The tooltip names the configured chord; keyboard focus shows it at once.
    fireEvent.focus(screen.getByRole('button', { name: /汇总/ }))
    expect(screen.getByRole('tooltip').textContent).toBe('汇总 · 完成未读 1 · Ctrl+Shift+I')
    cleanup()
    // The viewing store persists whole-value; a fresh handle must start closed.
    localStorage.clear()
    const bare = mountEntry({ settings: { toggleShortcut: 'F2' } })
    fireEvent.keyDown(input, { key: 'F2', code: 'F2' })
    expect(bare.store.getSnapshot().open).toBe(false)
    fireEvent.keyDown(document, { key: 'F2', code: 'F2' })
    expect(bare.store.getSnapshot().open).toBe(true)
    // Key repeat holds the panel where it is.
    fireEvent.keyDown(document, { key: 'F2', code: 'F2', repeat: true })
    expect(bare.store.getSnapshot().open).toBe(true)
    input.remove()
  })

  it('carries one pill per state in the configured order, and one summed pill on the rail', () => {
    const rows = [
      row('unread'),
      row('seen'),
      row('w', { pendingInteraction: { kind: 'approval' } }),
      row('r1', { running: true }),
      row('r2', { running: true }),
      row('f1', { projectionValues: { sessionDigest: digest({ outcome: 'error' }) } }),
      row('f2', { projectionValues: { sessionDigest: digest({ outcome: 'aborted' }) } }),
      row('f3', { projectionValues: { sessionDigest: digest({ outcome: 'error' }) } }),
      row('h', { projectionValues: { sessionDigest: digest({ outcome: 'error' }) } }),
    ]
    mountEntry({ rows, snapshot: inbox({ sessions: [mark('h', { handledAt: 1 }), mark('seen', { lastSeenSeq: 9 })] }) })
    // Seen rows are not a state pill; handled failures do not count.
    const pills = [...document.querySelectorAll<HTMLElement>('[data-state]')]
    expect(pills.map(pill => [pill.dataset['state'], pill.textContent])).toEqual([['waiting', '1'], ['unread', '1'], ['running', '2'], ['failed', '3']])
    expect(screen.getByRole('button', { name: '汇总 · 等待你选择 1 · 完成未读 1 · 运行中 2 · 出错 3' })).toBeTruthy()
    cleanup()
    // The settings page's order is the display order; the grey finished pill counts seen rows and trails.
    mountEntry({ rows, snapshot: inbox({ sessions: [mark('h', { handledAt: 1 }), mark('seen', { lastSeenSeq: 9 })] }), settings: { navFinishedBadge: true, navBadgeOrder: ['failed', 'running', 'unread', 'waiting'] } })
    expect([...document.querySelectorAll<HTMLElement>('[data-state]')].map(pill => [pill.dataset['state'], pill.textContent])).toEqual([['failed', '3'], ['running', '2'], ['unread', '1'], ['waiting', '1'], ['finished', '1']])
    expect(screen.getByRole('button', { name: '汇总 · 出错 3 · 运行中 2 · 完成未读 1 · 等待你选择 1 · 已完成 1' })).toBeTruthy()
    cleanup()
    // Badges off: no pills, no counts in the name.
    mountEntry({ rows, settings: { navBadges: false, navFinishedBadge: true } })
    expect(document.querySelector('[data-state]')).toBeNull()
    expect(screen.getByRole('button', { name: '汇总' })).toBeTruthy()
    cleanup()
    // A zero count drops its pill and its words.
    mountEntry({ rows: [row('r1', { running: true }), row('f1', { projectionValues: { sessionDigest: digest({ outcome: 'error' }) } })] })
    expect([...document.querySelectorAll<HTMLElement>('[data-state]')].map(pill => pill.dataset['state'])).toEqual(['running', 'failed'])
    expect(screen.getByRole('button', { name: '汇总 · 运行中 1 · 出错 1' })).toBeTruthy()
    cleanup()
    // The rail sums the counts into one pill toned by the first state present.
    mountEntry({ wide: false, rows: [row('r1', { running: true }), row('f1', { projectionValues: { sessionDigest: digest({ outcome: 'error' }) } })] })
    const rail = document.querySelector<HTMLElement>('[data-state]')
    expect(rail?.dataset['state']).toBe('running')
    expect(rail?.textContent).toBe('2')
    expect(screen.getByRole('button', { name: '汇总 · 运行中 1 · 出错 1' })).toBeTruthy()
    expect(screen.queryByText('汇总')).toBeNull()
    cleanup()
    mountEntry({ rows: [row('a')], archived: ['a'] })
    expect(document.querySelector('[data-state]')).toBeNull()
    cleanup()
    // A finished row the user has not seen is the green pill alone; seeing it drops the pill.
    mountEntry({ rows: [row('a')] })
    expect([...document.querySelectorAll<HTMLElement>('[data-state]')].map(pill => pill.dataset['state'])).toEqual(['unread'])
    expect(screen.getByRole('button', { name: '汇总 · 完成未读 1' })).toBeTruthy()
    cleanup()
    mountEntry({ rows: [row('a')], snapshot: inbox({ sessions: [mark('a', { lastSeenSeq: 9 })] }) })
    expect(document.querySelector('[data-state]')).toBeNull()
    expect(screen.getByRole('button', { name: '汇总' })).toBeTruthy()
  })
})

describe('branded ids in fixtures', () => {
  it('keeps the session id brand', () => {
    const id: SessionId = row('x').id
    expect(id).toBe('x')
  })
})
