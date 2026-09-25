// @vitest-environment jsdom
/**
 * ui-digest plugin halves: the browser entry's dictionary, its two slot
 * registrations against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), the inbox wiring (push adoption, reconnect re-read,
 * the seen mark following the current session, the document badge, and the
 * navigation callbacks, the three settings pages, the session-pins seat), and
 * the invariant companion's ownership reservation; the node half has its own
 * host spec.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { RemoteError, SlotTestRuntime, TestRemote, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import type { InboxSnapshot } from '@deepseek-ai/dsh-session-inbox/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ChatReplyExposureValue } from '@deepseek-ai/dsh-client-ui-chat/client'
import { DEFAULT_DIGEST_SETTINGS } from '../src/nav-settings.ts'
import type { ProjectTodosSnapshot } from '@deepseek-ai/dsh-project-todos/types'
import { apply, inject } from '../src/client/index.ts'
import type {
  DigestNavEntryInjected, DigestPanelInjected, DigestSettingsInjected,
  PinsSettingsInjected, ProjectSettingsInjected, ReadAcknowledgementInjected,
} from '../src/client/contract/slots.ts'
import type { DigestSettings } from '../src/nav-settings.ts'
import type { SessionPinsSettings } from '../src/pins-settings.ts'
import * as DigestInvariant from '../src/invariant.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import { digest, inbox, mark, project, projectFile, projectItem, projectsSnapshot } from './fixtures.client.ts'

let runtime: SlotTestRuntime | undefined

// The viewing store persists whole-value in localStorage.
beforeEach(() => { localStorage.clear() })

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
  vi.useRealTimers()
})

/** Entry ids currently registered in one list slot. */
function entryIds(ctx: Context, slot: string): (string | undefined)[] {
  return ctx.slots.entries(slot as never).map(entry => entry.options.id)
}

/** Boot the browser half over the test runtime declaring both target holes. */
async function bench(initial: InboxSnapshot = inbox()) {
  runtime = await SlotTestRuntime.create()
  const ctx = runtime.ctx
  const exposure = createSnapshotStore<ChatReplyExposureValue | null>(null)
  ctx.provide('chatReplyExposure', { view: exposure })
  const remote = new TestRemote(ctx)
  const calls: { method: string; request: unknown }[] = []
  let snapshot = initial
  const carried = <T>(value: T) => Promise.resolve({ ok: true as const, value })
  const answer = (method: string) => (request?: unknown) => {
    calls.push({ method, request })
    return carried(snapshot)
  }
  const business = (method: string) => (request?: unknown) => {
    calls.push({ method, request })
    return carried({ ok: true as const, value: snapshot })
  }
  const sessionInbox = {
    get: answer('get'),
    markSeen: (request: { sessionId: SessionId; seq: number }) => {
      calls.push({ method: 'markSeen', request })
      const existing = snapshot.sessions.find(item => item.sessionId === request.sessionId) ?? mark(request.sessionId)
      snapshot = {
        ...snapshot,
        sessions: [...snapshot.sessions.filter(item => item.sessionId !== request.sessionId), { ...existing, lastSeenSeq: request.seq }],
      }
      return carried(snapshot)
    },
    setHandled: answer('setHandled'),
    setPinned: answer('setPinned'),
    markReviewed: answer('markReviewed'),
    removeTodo: answer('removeTodo'),
    snooze: business('snooze'),
    addTodo: business('addTodo'),
    updateTodo: business('updateTodo'),
  }
  let projects: ProjectTodosSnapshot = projectsSnapshot({ projects: [project('/tmp/root/alpha', [projectFile('/tmp/root/alpha/TODO.md', [projectItem('ship')])])] })
  const projectTodos = {
    get: (request?: unknown) => {
      calls.push({ method: 'projects.get', request })
      return carried(projects)
    },
    rescan: (request?: unknown) => {
      calls.push({ method: 'projects.rescan', request })
      return carried(projects)
    },
    readDocument: (request: { path: string }) => {
      calls.push({ method: 'projects.readDocument', request })
      return carried({ ok: true as const, value: { path: request.path, text: '- [ ] ship', mtime: 1 } })
    },
  }
  const sessionRemote = {
    openWorkspacePath: (_request: { path: string }) => carried({ opened: true as const }),
  }
  // The double carries no generated namespaces; the plugin reads
  // `ctx.remote.sessionInbox` off the provided object, so attach it there and
  // satisfy the `remote.sessionInbox` service edge separately.
  Object.assign(remote, { sessionInbox, projectTodos, session: sessionRemote })
  ctx.provide('remote.sessionInbox', sessionInbox as never)
  ctx.provide('remote.projectTodos', projectTodos as never)
  ctx.provide('remote.session', sessionRemote as never)
  let pickDirectory = (): Promise<string | null> => Promise.resolve('/picked')
  const uiWorkspace = {
    connectWorkspace: async () => {
      const current = runtime?.sessions.list.getSnapshot().current
      if (current === undefined) throw new Error('no fixture Session available')
      return current
    },
    pickDirectory: () => pickDirectory(),
  }
  ctx.provide('uiWorkspace', uiWorkspace as never)
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  const settingsScope = stubSettingsScope<{ roots: string[]; files: string[]; includeWorkspaces: boolean }>()
  const digestScope = stubSettingsScope<DigestSettings>()
  const pinsScope = stubSettingsScope<SessionPinsSettings>()
  const bound: { namespace: string; decode?: (section: unknown) => unknown }[] = []
  ctx.provide('settingsScope', { bind: (spec: { namespace: string; decode?: (section: unknown) => unknown }) => {
    bound.push(spec)
    return spec.namespace === 'ui-digest' ? digestScope.scope : spec.namespace === 'session-pins' ? pinsScope.scope : settingsScope.scope
  } } as never)
  await runtime.root.declare({
    'sidebar.nav.entry': { kind: 'list', scope: 'root' },
    'center.overlay': { kind: 'list', scope: 'root' },
    'settings.section': { kind: 'list', scope: 'root' },
    'conversation.session.header.actions': { kind: 'list', scope: 'session' },
  }, () => null)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('zh')
  const feature = await runtime.mount({ inject: [...inject], apply })
  digestScope.publish({ status: 'ready', value: { ...DEFAULT_DIGEST_SETTINGS }, revision: 1, writable: true })
  const panel = (): DigestPanelInjected => {
    const entry = ctx.slots.entries('center.overlay').find(e => e.options.id === 'digest')
    if (entry === undefined) throw new Error('panel entry missing')
    return (entry.inject as unknown as () => DigestPanelInjected)()
  }
  const nav = (): DigestNavEntryInjected => {
    const entry = ctx.slots.entries('sidebar.nav.entry').find(e => e.options.id === 'digest')
    if (entry === undefined) throw new Error('nav entry missing')
    return (entry.inject as unknown as () => DigestNavEntryInjected)()
  }
  const settings = (): ProjectSettingsInjected => {
    const entry = ctx.slots.entries('settings.section').find(e => e.options.id === 'project-todos')
    if (entry === undefined) throw new Error('settings entry missing')
    return (entry.inject as unknown as () => ProjectSettingsInjected)()
  }
  const digestSettings = (): DigestSettingsInjected => {
    const entry = ctx.slots.entries('settings.section').find(e => e.options.id === 'digest')
    if (entry === undefined) throw new Error('digest settings entry missing')
    return (entry.inject as unknown as () => DigestSettingsInjected)()
  }
  const pinsSettings = (): PinsSettingsInjected => {
    const entry = ctx.slots.entries('settings.section').find(e => e.options.id === 'session-pins')
    if (entry === undefined) throw new Error('pins settings entry missing')
    return (entry.inject as unknown as () => PinsSettingsInjected)()
  }
  return {
    ctx,
    runtime,
    exposure,
    remote,
    calls,
    feature,
    panel,
    nav,
    settings,
    digestSettings,
    pinsSettings,
    settingsScope,
    digestScope,
    pinsScope,
    bound,
    setSnapshot: (next: InboxSnapshot) => { snapshot = next },
    setProjects: (next: ProjectTodosSnapshot) => { projects = next },
    sessionRemote,
    setPickDirectory: (next: () => Promise<string | null>) => { pickDirectory = next },
  }
}

describe('ui-digest browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual([
      'slots', 'sessions', 'workspaces', 'uiWorkspace', 'uiSession', 'locale',
      'remote', 'remote.session', 'remote.sessionInbox', 'remote.projectTodos',
    ])
  })

  it('registers both seats, reads the inbox once, and fiber teardown removes them (HMR safety)', async () => {
    const b = await bench()
    expect(entryIds(b.ctx, 'sidebar.nav.entry')).toContain('digest')
    expect(entryIds(b.ctx, 'center.overlay')).toContain('digest')
    expect(entryIds(b.ctx, 'settings.section')).toContain('project-todos')
    expect(entryIds(b.ctx, 'settings.section')).toContain('digest')
    expect(entryIds(b.ctx, 'settings.section')).toContain('session-pins')
    expect(entryIds(b.ctx, 'conversation.session.header.actions')).toContain('digest-read')
    await b.runtime.flush()
    // The project scan is not read until the tab shows.
    expect(b.calls.map(call => call.method)).toEqual(['get'])
    expect(b.nav().hooks.inbox).toBe(b.panel().hooks.inbox)
    expect(b.panel().hooks.inbox.getSnapshot().status).toBe('ready')
    await b.feature.dispose()
    expect(entryIds(b.ctx, 'sidebar.nav.entry')).not.toContain('digest')
    expect(entryIds(b.ctx, 'center.overlay')).not.toContain('digest')
    expect(entryIds(b.ctx, 'settings.section')).not.toContain('project-todos')
    expect(entryIds(b.ctx, 'settings.section')).not.toContain('digest')
    expect(entryIds(b.ctx, 'settings.section')).not.toContain('session-pins')
    expect(entryIds(b.ctx, 'conversation.session.header.actions')).not.toContain('digest-read')
  })

  it('closes the panel on repeated session navigation and releases the listener on teardown', async () => {
    const b = await bench()
    await b.runtime.sessions.add({ id: 's1' }, { current: false })
    b.runtime.renderRoot()
    const entry = b.ctx.slots.entries('center.overlay').find(e => e.options.id === 'digest')
    const instance = b.runtime.storeOf('center.overlay') as unknown as {
      actions: { open: () => void }
      store: { getSnapshot: () => { open: boolean } }
    }
    ;(entry!.inject as unknown as (actions: unknown) => unknown)(instance.actions)
    instance.actions.open()
    b.runtime.sessions.open('s1' as SessionId)
    expect(instance.store.getSnapshot().open).toBe(false)

    instance.actions.open()
    await b.feature.dispose()
    b.runtime.sessions.open('s1' as SessionId)
    expect(instance.store.getSnapshot().open).toBe(true)
  })

  it('reads the project scan on demand, adopts pushes, and re-reads after a reset only once warm', async () => {
    const b = await bench()
    await b.runtime.flush()
    b.ctx.emit('connection/reset')
    await b.runtime.flush()
    expect(b.calls.filter(call => call.method.startsWith('projects.'))).toEqual([])
    const face = b.panel()
    await face.ensureProjects()
    expect(face.hooks.projects.getSnapshot().snapshot.projects.map(p => p.name)).toEqual(['alpha'])
    const pushed = projectsSnapshot({ projects: [] })
    b.remote.emit('project-todos/changed', [pushed])
    expect(face.hooks.projects.getSnapshot().snapshot).toBe(pushed)
    b.ctx.emit('connection/reset')
    await b.runtime.flush()
    await face.rescanProjects()
    await expect(face.readProjectDocument('/tmp/root/alpha/TODO.md')).resolves.toMatchObject({ ok: true, value: { text: '- [ ] ship' } })
    expect(b.calls.filter(call => call.method.startsWith('projects.')).map(call => call.method))
      .toEqual(['projects.get', 'projects.get', 'projects.rescan', 'projects.readDocument'])
  })

  it('opens a project by registering the workspace, connecting a session, and prefilling the composer', async () => {
    const b = await bench()
    await b.runtime.flush()
    const setDraft = vi.fn()
    b.runtime.workspaces.stub('create', (input: unknown) => Promise.resolve({
      workspaceId: 'w1',
      path: (input as { path: string }).path,
      title: 'alpha',
      sessionIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as never))
    await b.runtime.sessions.add({ id: 'session-of-w1', summary: { title: 'One' } })
    const face = b.panel()
    // Without the composer seat the session still opens; the draft is simply not set.
    await expect(face.openProject('/tmp/root/alpha', 'read TODO.md')).resolves.toEqual({ ok: true })
    expect(b.runtime.workspaces.calls.map(call => call.method)).toEqual(['create'])
    expect(b.runtime.sessions.calls.at(-1)).toEqual({ method: 'open', args: ['session-of-w1'] })
    b.ctx.provide('conversation', { input: { for: () => ({ setDraft }) } } as never)
    await expect(face.openProject('/tmp/root/alpha', 'read TODO.md')).resolves.toEqual({ ok: true })
    expect(setDraft).toHaveBeenCalledWith('read TODO.md')
    // No text, no draft; a failing create reports the reason.
    await expect(face.openProject('/tmp/root/alpha', null)).resolves.toEqual({ ok: true })
    expect(setDraft).toHaveBeenCalledTimes(1)
    b.runtime.workspaces.stub('create', () => Promise.reject(new Error('missing dir')))
    await expect(face.openProject('/nowhere', 'x')).resolves.toEqual({ ok: false, error: { code: 'runtime', message: 'missing dir' } })
    b.runtime.workspaces.stub('create', vi.fn().mockRejectedValue('plain'))
    await expect(face.openProject('/nowhere', 'x')).resolves.toEqual({ ok: false, error: { code: 'runtime', message: 'plain' } })
  })

  it('opens paths through the host opener and reports its failure', async () => {
    const b = await bench()
    await b.runtime.flush()
    const face = b.panel()
    await expect(face.openPath('/tmp/root/alpha/TODO.md')).resolves.toEqual({ ok: true })
    const refused = vi.spyOn(b.ctx.remote.session, 'openWorkspacePath')
      .mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'unavailable', {}) })
    await expect(face.openPath('/x')).resolves.toEqual({ ok: false, error: { code: 'runtime', message: 'unavailable' } })
    refused.mockRestore()
    b.sessionRemote.openWorkspacePath = async () => { throw new Error('no opener') }
    await expect(face.openPath('/x')).resolves.toEqual({ ok: false, error: { code: 'runtime', message: 'no opener' } })
  })

  it('binds the scan settings page to the project-todos namespace and routes its writes', async () => {
    const b = await bench()
    await b.runtime.flush()
    expect(b.bound).toContainEqual({ namespace: 'project-todos' })
    const face = b.settings()
    expect(face.hooks.projectSettings.getSnapshot().status).toBe('loading')
    b.settingsScope.publish({ status: 'ready', writable: true, value: { roots: ['/a'], files: ['TODO.md'], includeWorkspaces: false } })
    expect(face.hooks.projectSettings.getSnapshot()).toEqual({ status: 'ready', writable: true, roots: ['/a'], files: ['TODO.md'], includeWorkspaces: false })
    await face.setRoots(['/a', ' /b ', '', '/a'])
    await face.setFiles(['TODO.md', 'notes/TODO.md'])
    await face.setIncludeWorkspaces(true)
    // The locale plugin shares the stub scope; only this page's writes are asserted.
    expect(b.settingsScope.set.mock.calls.filter(call => call[0] !== 'preference')).toEqual([
      ['roots', ['/a', '/b']], ['files', ['TODO.md', 'notes/TODO.md']], ['includeWorkspaces', true],
    ])
    b.setPickDirectory(() => Promise.resolve('/picked'))
    await expect(face.pickDirectory()).resolves.toBe('/picked')
    const entry = b.ctx.slots.entries('settings.section').find(e => e.options.id === 'project-todos')
    b.ctx.locale.setLocale('zh')
    expect((entry?.options as { label?: () => string }).label?.()).toBe(zh['settings.nav'])
    b.ctx.locale.setLocale('en')
    expect((entry?.options as { label?: () => string }).label?.()).toBe(en['settings.nav'])
  })

  it('binds the digest panel page to the ui-digest namespace, shares its view with the entry, and routes its writes', async () => {
    const b = await bench()
    await b.runtime.flush()
    const digestBinding = b.bound.find(spec => spec.namespace === 'ui-digest')
    expect(digestBinding).toBeDefined()
    // The decoder defaults an incomplete wire section rather than passing it through.
    expect(digestBinding?.decode?.({ navBadges: false })).toEqual({ ...DEFAULT_DIGEST_SETTINGS, navBadges: false })
    const face = b.digestSettings()
    expect(face.hooks.navSettings).toBe(b.nav().hooks.navSettings)
    expect(face.hooks.navSettings.getSnapshot()).toMatchObject({ status: 'ready', navBadges: true, navFinishedBadge: false, writable: true })
    b.digestScope.publish({ status: 'ready', writable: true, value: { ...DEFAULT_DIGEST_SETTINGS, navBadges: true, navFinishedBadge: true, navBadgeOrder: ['failed', 'waiting', 'unread', 'running'], toggleShortcut: 'F2' } })
    expect(face.hooks.navSettings.getSnapshot()).toEqual({
      ...DEFAULT_DIGEST_SETTINGS, status: 'ready', writable: true, navBadges: true, navFinishedBadge: true, navBadgeOrder: ['failed', 'waiting', 'unread', 'running'], toggleShortcut: 'F2',
    })
    // The panel reads the same view to name the chord in its key legend.
    expect(b.panel().hooks.navSettings).toBe(face.hooks.navSettings)
    await face.setNavBadges(false)
    await face.setNavFinishedBadge(false)
    await face.setNavBadgeOrder(['running', 'running', 'waiting'])
    await face.setToggleShortcut('Ctrl+Shift+I')
    await face.setReadAcknowledgement('manual')
    await face.setReadGraceSeconds(8)
    expect(b.digestScope.set.mock.calls).toEqual([
      ['navBadges', false], ['navFinishedBadge', false], ['navBadgeOrder', ['running', 'waiting', 'unread', 'failed']], ['toggleShortcut', 'Ctrl+Shift+I'],
      ['readAcknowledgement', 'manual'], ['readGraceSeconds', 8],
    ])
    const entry = b.ctx.slots.entries('settings.section').find(e => e.options.id === 'digest')
    b.ctx.locale.setLocale('zh')
    expect((entry?.options as { label?: () => string }).label?.()).toBe(zh['digestSettings.nav'])
    b.ctx.locale.setLocale('en')
    expect((entry?.options as { label?: () => string }).label?.()).toBe(en['digestSettings.nav'])
    // Teardown detaches the scope and the view returns to the defaults.
    await b.feature.dispose()
    expect(face.hooks.navSettings.getSnapshot()).toMatchObject({ status: 'unavailable', navFinishedBadge: false, navBadgeOrder: ['waiting', 'unread', 'running', 'failed'], toggleShortcut: 'Ctrl+1' })
    expect(b.digestScope.listenerCount()).toBe(0)
  })

  it('binds the pins page to the session-pins namespace, shares its view with the panel, and routes its writes', async () => {
    const b = await bench()
    await b.runtime.flush()
    const binding = b.bound.find(spec => spec.namespace === 'session-pins')
    expect(binding?.decode?.({ sidebarRows: 3 })).toEqual({ enabled: true, sidebarArea: true, sidebarRows: 3, autoPinStatuses: ['running', 'completed'], digestSection: true })
    const face = b.pinsSettings()
    expect(face.hooks.pinsSettings).toBe(b.panel().hooks.pinsSettings)
    expect(face.hooks.pinsSettings.getSnapshot()).toMatchObject({ status: 'loading', enabled: true, sidebarRows: 5, writable: false })
    b.pinsScope.publish({ status: 'ready', writable: true, value: { enabled: true, sidebarArea: false, sidebarRows: 9, autoPinStatuses: ['failed'], digestSection: false } })
    expect(face.hooks.pinsSettings.getSnapshot()).toEqual({
      status: 'ready', writable: true, enabled: true, sidebarArea: false, sidebarRows: 9, autoPinStatuses: ['failed'], digestSection: false,
    })
    await face.setEnabled(false)
    await face.setSidebarArea(true)
    await face.setSidebarRows(4)
    await face.setAutoPinStatuses(['running'])
    await face.setDigestSection(true)
    expect(b.pinsScope.set.mock.calls).toEqual([
      ['enabled', false], ['sidebarArea', true], ['sidebarRows', 4], ['autoPinStatuses', ['running']], ['digestSection', true],
    ])
    const entry = b.ctx.slots.entries('settings.section').find(e => e.options.id === 'session-pins')
    expect(entry?.options.order).toBe(46)
    b.ctx.locale.setLocale('zh')
    expect((entry?.options as { label?: () => string }).label?.()).toBe(zh['pinsSettings.nav'])
    b.ctx.locale.setLocale('en')
    expect((entry?.options as { label?: () => string }).label?.()).toBe(en['pinsSettings.nav'])
    await b.feature.dispose()
    expect(face.hooks.pinsSettings.getSnapshot()).toMatchObject({ status: 'unavailable', enabled: true, sidebarRows: 5 })
    expect(b.pinsScope.listenerCount()).toBe(0)
  })

  it('provides the session-pins seat: pinned ids plus policy, republished only on change, and writes every pin', async () => {
    const b = await bench(inbox({ sessions: [mark('s2', { pinned: true }), mark('s1', { pinned: true }), mark('s3')] }))
    await b.runtime.flush()
    const seat = b.ctx.get('sessionPins')
    if (seat === undefined) throw new Error('sessionPins not provided')
    const first = seat.view.getSnapshot()
    expect(first).toEqual({ enabled: true, sidebarArea: true, sidebarRows: 5, autoPinStatuses: ['running', 'completed'], pinnedSessionIds: ['s2', 's1'], completedSessionIds: [] })
    // A push that changes nothing pin-related keeps the snapshot identity.
    const listener = vi.fn()
    seat.view.subscribe(listener)
    b.remote.emit('session-inbox/changed', [inbox({ sessions: [mark('s2', { pinned: true }), mark('s1', { pinned: true, handledAt: 5 })] })])
    expect(seat.view.getSnapshot()).toBe(first)
    expect(listener).not.toHaveBeenCalled()
    b.remote.emit('session-inbox/changed', [inbox({ sessions: [mark('s1', { pinned: true })] })])
    expect(seat.view.getSnapshot()).toMatchObject({ pinnedSessionIds: ['s1'] })
    expect(listener).toHaveBeenCalledTimes(1)
    // The policy rides the same view.
    b.pinsScope.publish({ status: 'ready', writable: true, value: { enabled: false, sidebarArea: true, sidebarRows: 7, autoPinStatuses: ['failed'], digestSection: true } })
    expect(seat.view.getSnapshot()).toEqual({ enabled: false, sidebarArea: true, sidebarRows: 7, autoPinStatuses: ['failed'], pinnedSessionIds: ['s1'], completedSessionIds: [] })
    b.pinsScope.publish({ status: 'ready', writable: true, value: { enabled: false, sidebarArea: true, sidebarRows: 7, autoPinStatuses: ['failed'], digestSection: false } })
    expect(listener).toHaveBeenCalledTimes(2)
    // Finished replies the user has not handled ride the seat as the durable
    // completed ids: the list row feeds them, the seen mark keeps them (the
    // row stays 已读未处理 inside the review window), the handled mark clears them.
    await b.runtime.sessions.add({
      id: 's6', summary: { title: 'Six', updatedAt: Date.now(), projectionValues: { sessionDigest: digest({ replySeq: 9 }) } },
    }, { current: false })
    expect(seat.view.getSnapshot().completedSessionIds).toEqual(['s6'])
    b.remote.emit('session-inbox/changed', [inbox({ sessions: [mark('s1', { pinned: true }), mark('s6', { lastSeenSeq: 9 })] })])
    expect(seat.view.getSnapshot().completedSessionIds).toEqual(['s6'])
    b.remote.emit('session-inbox/changed', [inbox({ sessions: [mark('s1', { pinned: true }), mark('s6', { lastSeenSeq: 9, handledAt: 1 })] })])
    expect(seat.view.getSnapshot().completedSessionIds).toEqual([])
    // The seat's settings writers reach the same scope as the settings page.
    await seat.setSidebarRows('auto')
    await seat.setAutoPinStatuses(['running', 'failed'])
    expect(b.pinsScope.set.mock.calls.slice(-2)).toEqual([['sidebarRows', 'auto'], ['autoPinStatuses', ['running', 'failed']]])
    // Pinning writes one mark per Session and resolves once every reply landed.
    await seat.setPinned(['s4' as SessionId, 's5' as SessionId], true)
    expect(b.calls.filter(call => call.method === 'setPinned').map(call => call.request)).toEqual([
      { sessionId: 's4', pinned: true }, { sessionId: 's5', pinned: true },
    ])
    const namespace = (b.remote as unknown as { sessionInbox: { setPinned: unknown } }).sessionInbox
    namespace.setPinned = () => Promise.resolve({ ok: false as const, error: { code: 'io', message: 'disk full' } })
    await expect(seat.setPinned(['s4' as SessionId], false)).rejects.toThrow('disk full')
  })

  it('rejects a pin while the inbox cannot be read', async () => {
    const b = await bench()
    await b.runtime.flush()
    // A reset re-reads the inbox; the failed read leaves the controller retryable, and the pin retries first.
    const namespace = (b.remote as unknown as { sessionInbox: { get: unknown } }).sessionInbox
    namespace.get = () => Promise.resolve({ ok: false as const, error: { code: 'io', message: 'host down' } })
    b.ctx.emit('connection/reset')
    await b.runtime.flush()
    const seat = b.ctx.get('sessionPins')!
    await expect(seat.setPinned(['s1' as SessionId], true)).rejects.toThrow('host down')
    expect(b.calls.filter(call => call.method === 'setPinned')).toHaveLength(0)
  })

  it('adopts pushed snapshots and re-reads after a connection reset', async () => {
    const b = await bench()
    await b.runtime.flush()
    const pushed = inbox({ reviewedAt: 42 })
    b.remote.emit('session-inbox/changed', [pushed])
    expect(b.panel().hooks.inbox.getSnapshot().snapshot).toBe(pushed)
    b.ctx.emit('connection/reset')
    await b.runtime.flush()
    expect(b.calls.map(call => call.method)).toEqual(['get', 'get'])
  })

  it('marks only a continuously exposed completed reply seen, not selection or an unanswered question', async () => {
    const b = await bench()
    await b.runtime.flush()
    await b.runtime.sessions.add({
      id: 's1',
      summary: { updatedAt: Date.now(), completed: true, title: 'One', projectionValues: { sessionDigest: digest({ replySeq: 9 }) } },
    })
    await b.runtime.flush()
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(b.calls.filter(call => call.method === 'markSeen')).toEqual([])
    b.exposure.set({ sessionId: 's1' as SessionId, seq: 9 })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(b.calls.filter(call => call.method === 'markSeen')).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(b.calls.filter(call => call.method === 'markSeen').map(call => call.request)).toEqual([{ sessionId: 's1', seq: 9 }])
    expect(b.panel().hooks.inbox.getSnapshot().snapshot.sessions[0]).toMatchObject({ lastSeenSeq: 9, handledAt: null, pinned: false })
    expect(b.runtime.sessions.list.getSnapshot().byId['s1' as SessionId]?.completed).toBe(false)
    expect(b.ctx.sessionPins.view.getSnapshot().completedSessionIds).toContain('s1')
    vi.useRealTimers()
    await b.runtime.sessions.add({
      id: 's3',
      summary: { running: true, projectionValues: { sessionDigest: digest({ replySeq: null, questionSeq: 4 }) } },
    })
    vi.useFakeTimers()
    b.exposure.set({ sessionId: 's3' as SessionId, seq: 4 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(b.calls.filter(call => call.method === 'markSeen')).toHaveLength(1)
  })

  it('resets exposure on interruption and never consumes a newer reply with an old timer', async () => {
    const b = await bench()
    await b.runtime.flush()
    await b.runtime.sessions.add({ id: 's1', summary: { projectionValues: { sessionDigest: digest({ replySeq: 9 }) } } })
    vi.useFakeTimers()
    b.exposure.set({ sessionId: 's1' as SessionId, seq: 9 })
    await vi.advanceTimersByTimeAsync(4_000)
    b.exposure.set(null)
    await vi.advanceTimersByTimeAsync(2_000)
    b.exposure.set({ sessionId: 's1' as SessionId, seq: 9 })
    await vi.advanceTimersByTimeAsync(4_000)
    b.runtime.sessions.list.update((draft) => {
      draft.byId['s1' as SessionId]!.projectionValues = { sessionDigest: digest({ replySeq: 19 }) }
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(b.calls.filter(call => call.method === 'markSeen')).toEqual([])
    b.exposure.set({ sessionId: 's1' as SessionId, seq: 19 })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(b.calls.filter(call => call.method === 'markSeen').map(call => call.request)).toEqual([{ sessionId: 's1', seq: 19 }])
  })

  it.each(['loading', 'unavailable'] as const)('does not infer viewing before authoritative preferences are available: %s', async (status) => {
    const b = await bench()
    await b.runtime.flush()
    await b.runtime.sessions.add({ id: 's1', summary: { projectionValues: { sessionDigest: digest({ replySeq: 9 }) } } })
    b.digestScope.publish({ status, value: undefined, writable: false })
    vi.useFakeTimers()
    b.exposure.set({ sessionId: 's1' as SessionId, seq: 9 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(b.calls.filter(call => call.method === 'markSeen')).toEqual([])
  })

  it('manual mode never consumes exposure and feature disposal cancels a pending interval', async () => {
    const b = await bench()
    await b.runtime.flush()
    await b.runtime.sessions.add({ id: 's1', summary: { projectionValues: { sessionDigest: digest({ replySeq: 9 }) } } })
    b.digestScope.publish({ status: 'ready', value: { ...DEFAULT_DIGEST_SETTINGS, readAcknowledgement: 'manual' }, revision: 1, writable: true })
    vi.useFakeTimers()
    b.exposure.set({ sessionId: 's1' as SessionId, seq: 9 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(b.calls.filter(call => call.method === 'markSeen')).toEqual([])
    b.digestScope.publish({ status: 'ready', value: { ...DEFAULT_DIGEST_SETTINGS, readGraceSeconds: 8 }, revision: 2, writable: true })
    await vi.advanceTimersByTimeAsync(7_999)
    expect(b.calls.filter(call => call.method === 'markSeen')).toEqual([])
    await b.feature.dispose()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(b.calls.filter(call => call.method === 'markSeen')).toEqual([])
  })

  it('routes explicit viewing independently of automatic settings and refuses a stale or unfinished reply', async () => {
    const b = await bench()
    await b.runtime.flush()
    const id = 's1' as SessionId
    await b.runtime.sessions.add({ id, summary: { projectionValues: { sessionDigest: digest({ replySeq: 9 }) } } })
    b.digestScope.publish({ status: 'unavailable', value: undefined, writable: false })
    const entry = b.ctx.slots.entries('conversation.session.header.actions').find(item => item.options.id === 'digest-read')!
    const face = (entry.inject as unknown as () => ReadAcknowledgementInjected)()
    expect(face.hooks.inbox).toBe(b.panel().hooks.inbox)
    await face.markReplySeen(id, 8)
    await face.markReplySeen('unknown' as SessionId, 9)
    b.runtime.sessions.list.update((draft) => { draft.byId[id]!.running = true })
    await face.markReplySeen(id, 9)
    b.runtime.sessions.list.update((draft) => {
      draft.byId[id]!.running = false
      draft.byId[id]!.projectionValues = { sessionDigest: digest({ replySeq: 9, outcome: 'error' }) }
    })
    await face.markReplySeen(id, 9)
    expect(b.calls.filter(call => call.method === 'markSeen')).toEqual([])
    b.runtime.sessions.list.update((draft) => {
      draft.byId[id]!.projectionValues = { sessionDigest: digest({ replySeq: 9 }) }
    })
    const write = vi.spyOn(b.ctx.remote.sessionInbox, 'markSeen')
    write.mockRejectedValueOnce(new Error('offline'))
    expect(await face.markReplySeen(id, 9)).toEqual({ ok: false, error: { code: 'runtime', message: 'offline' } })
    expect(b.panel().hooks.inbox.getSnapshot().snapshot.sessions).toEqual([])
    expect(await face.markReplySeen(id, 9)).toEqual({ ok: true })
    expect(b.panel().hooks.inbox.getSnapshot().snapshot.sessions[0]).toMatchObject({ lastSeenSeq: 9, handledAt: null, pinned: false })
    write.mockRestore()
  })

  it('synchronizes remote acknowledgement without consuming an uncovered completion', async () => {
    const b = await bench()
    await b.runtime.flush()
    await b.runtime.sessions.add({ id: 's1', summary: { completed: true, projectionValues: { sessionDigest: digest({ replySeq: 9 }) } } })
    await b.runtime.sessions.add({ id: 's2', summary: { completed: true, projectionValues: { sessionDigest: digest({ replySeq: 19 }) } } })
    b.remote.emit('session-inbox/changed', [inbox({ sessions: [mark('s1', { handledAt: 1 }), mark('s2', { lastSeenSeq: 9 })] })])
    expect(b.runtime.sessions.list.getSnapshot().byId['s1' as SessionId]?.completed).toBe(false)
    expect(b.runtime.sessions.list.getSnapshot().byId['s2' as SessionId]?.completed).toBe(true)
  })

  it('routes the panel verbs to the Remote and the runtime', async () => {
    const b = await bench()
    await b.runtime.flush()
    await b.runtime.sessions.add({ id: 's1', summary: { title: 'One' } })
    const face = b.panel()
    await face.setHandled('s1' as SessionId, true)
    await face.snooze('s1' as SessionId, 5)
    await face.setPinned('s1' as SessionId, true)
    await face.markReviewed()
    await face.addTodo({ sessionId: 's1' as SessionId, questionSeq: 2, text: 'x' })
    await face.fileTodo({ sessionId: 's1' as SessionId, questionSeq: 3, text: 'y' })
    await face.updateTodo('t' as never, { status: 'done' })
    await face.removeTodo('t' as never)
    await face.ensureInbox()
    expect(b.calls.map(call => call.method)).toEqual([
      'get', 'setHandled', 'snooze', 'setPinned', 'markReviewed', 'addTodo', 'addTodo', 'setHandled', 'updateTodo', 'removeTodo',
    ])
    face.openSession('s1' as SessionId)
    expect(b.runtime.sessions.calls.at(-1)).toEqual({ method: 'open', args: ['s1'] })
  })

  it('opens a question through the chat reveal seat and continues through the composer draft', async () => {
    const b = await bench()
    await b.runtime.flush()
    await b.runtime.sessions.add({ id: 's1', summary: { title: 'One' } })
    const reveal = vi.fn()
    const setDraft = vi.fn()
    b.ctx.provide('chatReveal', { reveal } as never)
    b.ctx.provide('conversation', { input: { for: () => ({ setDraft }) } } as never)
    const face = b.panel()
    face.openQuestion('s1' as SessionId, 4)
    expect(reveal).toHaveBeenCalledWith('s1', 4)
    face.continueSession('s1' as SessionId, 'go on')
    expect(setDraft).toHaveBeenCalledWith('go on')
    expect(b.runtime.sessions.calls.filter(call => call.method === 'open')).toHaveLength(2)
  })

  it('opens a session for continuation even when the composer seat is absent', async () => {
    const b = await bench()
    await b.runtime.flush()
    await b.runtime.sessions.add({ id: 's1', summary: { title: 'One' } })
    b.panel().continueSession('s1' as SessionId, 'x')
    expect(b.runtime.sessions.calls.filter(call => call.method === 'open')).toHaveLength(1)
  })

  it('provides the session-todo seat: one worded todo per session, each marked handled, then the list opens', async () => {
    const b = await bench()
    await b.runtime.flush()
    await b.runtime.sessions.add({
      id: 's1',
      summary: { title: 'One', projectionValues: { sessionDigest: digest({ question: `  ${'q'.repeat(130)}  `, questionSeq: 3 }) } },
    })
    await b.runtime.sessions.add({ id: 's2', summary: { title: 'Two', displayTitle: 'Two' } })
    const seat = b.ctx.get('sessionTodos')
    if (seat === undefined) throw new Error('sessionTodos not provided')
    // The panel's bound actions arrive once its inject factory runs (the outlet's job).
    b.runtime.renderRoot()
    const entry = b.ctx.slots.entries('center.overlay').find(e => e.options.id === 'digest')
    const instance = b.runtime.storeOf('center.overlay') as unknown as { actions: unknown; store: { getSnapshot: () => { open: boolean; tab: string } } }
    ;(entry!.inject as unknown as (actions: unknown) => unknown)(instance.actions)
    seat.add(['s1' as SessionId, 's2' as SessionId, 'missing' as SessionId])
    await b.runtime.flush()
    expect(b.calls.filter(call => call.method === 'addTodo').map(call => call.request)).toEqual([
      { sessionId: 's1', questionSeq: 3, text: `跟进：${'q'.repeat(120)}…` },
      { sessionId: 's2', questionSeq: null, text: '跟进：Two' },
      { sessionId: 'missing', questionSeq: null, text: '跟进：missing' },
    ])
    expect(b.calls.filter(call => call.method === 'setHandled').map(call => call.request)).toEqual([
      { sessionId: 's1', handled: true },
      { sessionId: 's2', handled: true },
      { sessionId: 'missing', handled: true },
    ])
    expect(instance.store.getSnapshot()).toMatchObject({ open: true, tab: 'todos' })
  })

  it('leaves the panel closed when every todo add fails, and before the panel is bound', async () => {
    const b = await bench()
    await b.runtime.flush()
    const seat = b.ctx.get('sessionTodos')!
    seat.add(['s1' as SessionId])
    await b.runtime.flush()
    expect(b.calls.filter(call => call.method === 'addTodo')).toHaveLength(1)
    b.runtime.renderRoot()
    const entry = b.ctx.slots.entries('center.overlay').find(e => e.options.id === 'digest')
    const instance = b.runtime.storeOf('center.overlay') as unknown as { actions: unknown; store: { getSnapshot: () => { open: boolean } } }
    ;(entry!.inject as unknown as (actions: unknown) => unknown)(instance.actions)
    const namespace = (b.remote as unknown as { sessionInbox: { addTodo: unknown } }).sessionInbox
    namespace.addTodo = () => Promise.resolve({ ok: true as const, value: { ok: false as const, error: { code: 'text-blank' as const } } })
    seat.add(['s1' as SessionId])
    await b.runtime.flush()
    expect(instance.store.getSnapshot().open).toBe(false)
  })

  it('copies text through the clipboard helper', async () => {
    const b = await bench()
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    try {
      await expect(b.panel().copyText('brief')).resolves.toBe(true)
      expect(writeText).toHaveBeenCalledWith('brief')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports the attention count into the document badge seat once it exists', async () => {
    const b = await bench()
    await b.runtime.flush()
    const set = vi.fn()
    class BadgeService extends Service {
      set = set
      constructor(serviceCtx: Context) {
        super(serviceCtx, 'documentBadge')
      }
    }
    const badge = b.ctx.plugin(BadgeService)
    await badge.await()
    await b.runtime.flush()
    expect(set).toHaveBeenLastCalledWith(0)
    await b.runtime.sessions.add({ id: 's1', summary: { title: 'One', projectionValues: { sessionDigest: digest() } } })
    await b.runtime.flush()
    expect(set).toHaveBeenLastCalledWith(1)
    b.remote.emit('session-inbox/changed', [inbox({ sessions: [mark('s1', { handledAt: 1 })] })])
    await b.runtime.flush()
    expect(set).toHaveBeenLastCalledWith(0)
    b.remote.emit('session-inbox/changed', [inbox()])
    await b.runtime.flush()
    expect(set).toHaveBeenLastCalledWith(1)
    // Archived sessions leave the count.
    b.runtime.workspaces.list.update((draft) => { draft.archivedSessionIds = ['s1' as SessionId] })
    await b.runtime.flush()
    expect(set).toHaveBeenLastCalledWith(0)
    await b.feature.dispose()
    expect(set).toHaveBeenLastCalledWith(0)
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const b = await bench()
    const translate = b.ctx.locale.bind(NS)
    expect(translate('nav.label')).toBe(zh['nav.label'])
    b.ctx.locale.setLocale('en')
    expect(translate('nav.label')).toBe(en['nav.label'])
    await b.feature.dispose()
    expect(translate('nav.label')).not.toBe(en['nav.label'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-digest invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(DigestInvariant)
    await fiber.await()
    expect(DigestInvariant.name).toBe('client-ui-digest-invariant')
    expect(DigestInvariant.inject).toEqual(['invariants'])
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
