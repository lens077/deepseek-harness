// @vitest-environment jsdom
/**
 * ui-digest plugin halves: the browser entry's dictionary, its two slot
 * registrations against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), the inbox wiring (push adoption, reconnect re-read,
 * the seen mark following the current session, the document badge, and the
 * navigation callbacks), the inert node entry, and the invariant companion's
 * ownership reservation.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { SlotTestRuntime, TestRemote, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import type { InboxSnapshot } from '@deepseek-ai/dsh-session-inbox/types'
import { apply, inject } from '../src/client/index.ts'
import type { DigestNavEntryInjected, DigestPanelInjected } from '../src/client/contract/slots.ts'
import { apply as applyNode } from '../src/index.ts'
import * as DigestInvariant from '../src/invariant.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import { digest, inbox, mark } from './fixtures.client.ts'

let runtime: SlotTestRuntime | undefined

// The viewing store persists whole-value in localStorage.
beforeEach(() => { localStorage.clear() })

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

/** Entry ids currently registered in one list slot. */
function entryIds(ctx: Context, slot: string): (string | undefined)[] {
  return ctx.slots.entries(slot as never).map(entry => entry.options.id)
}

/** Boot the browser half over the test runtime declaring both target holes. */
async function bench(initial: InboxSnapshot = inbox()) {
  runtime = await SlotTestRuntime.create()
  const ctx = runtime.ctx
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
    markSeen: answer('markSeen'),
    setHandled: answer('setHandled'),
    setPinned: answer('setPinned'),
    markReviewed: answer('markReviewed'),
    removeTodo: answer('removeTodo'),
    snooze: business('snooze'),
    addTodo: business('addTodo'),
    updateTodo: business('updateTodo'),
  }
  // The double carries no generated namespaces; the plugin reads
  // `ctx.remote.sessionInbox` off the provided object, so attach it there and
  // satisfy the `remote.sessionInbox` service edge separately.
  Object.assign(remote, { sessionInbox })
  ctx.provide('remote.sessionInbox', sessionInbox as never)
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await runtime.root.declare({
    'sidebar.nav.entry': { kind: 'list', scope: 'root' },
    'center.overlay': { kind: 'list', scope: 'root' },
  }, () => null)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('zh')
  const feature = await runtime.mount({ inject: [...inject], apply })
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
  return {
    ctx,
    runtime,
    remote,
    calls,
    feature,
    panel,
    nav,
    setSnapshot: (next: InboxSnapshot) => { snapshot = next },
  }
}

describe('ui-digest browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.sessionInbox'])
  })

  it('registers both seats, reads the inbox once, and fiber teardown removes them (HMR safety)', async () => {
    const b = await bench()
    expect(entryIds(b.ctx, 'sidebar.nav.entry')).toContain('digest')
    expect(entryIds(b.ctx, 'center.overlay')).toContain('digest')
    await b.runtime.flush()
    expect(b.calls.map(call => call.method)).toEqual(['get'])
    expect(b.nav().hooks.inbox).toBe(b.panel().hooks.inbox)
    expect(b.panel().hooks.inbox.getSnapshot().status).toBe('ready')
    await b.feature.dispose()
    expect(entryIds(b.ctx, 'sidebar.nav.entry')).not.toContain('digest')
    expect(entryIds(b.ctx, 'center.overlay')).not.toContain('digest')
  })

  it('adopts pushed snapshots and re-reads after a connection reset', async () => {
    const b = await bench()
    await b.runtime.flush()
    const pushed = inbox({ reviewedAt: 42 })
    b.remote.$dispatch('session-inbox/changed', [pushed])
    expect(b.panel().hooks.inbox.getSnapshot().snapshot).toBe(pushed)
    b.ctx.emit('connection/reset')
    await b.runtime.flush()
    expect(b.calls.map(call => call.method)).toEqual(['get', 'get'])
  })

  it('marks the current session seen at its newest landed seq', async () => {
    const b = await bench()
    await b.runtime.flush()
    await b.runtime.sessions.add({
      id: 's1',
      summary: { title: 'One', projectionValues: { sessionDigest: digest({ replySeq: 9 }) } },
    }, { current: true })
    await b.runtime.flush()
    expect(b.calls.filter(call => call.method === 'markSeen').map(call => call.request)).toEqual([{ sessionId: 's1', seq: 9 }])
    // A session without a landed seq, or one already covered, issues no call.
    b.setSnapshot(inbox({ sessions: [mark('s1', { lastSeenSeq: 9 })] }))
    b.remote.$dispatch('session-inbox/changed', [inbox({ sessions: [mark('s1', { lastSeenSeq: 9 })] })])
    await b.runtime.sessions.setCurrent(undefined)
    await b.runtime.sessions.add({ id: 's2', summary: { title: 'Two' } }, { current: true })
    await b.runtime.flush()
    await b.runtime.sessions.setCurrent('s1')
    await b.runtime.flush()
    expect(b.calls.filter(call => call.method === 'markSeen')).toHaveLength(1)
    // A question still being answered marks by its own seq.
    await b.runtime.sessions.add({
      id: 's3',
      summary: { title: 'Three', projectionValues: { sessionDigest: digest({ replySeq: null, questionSeq: 4 }) } },
    }, { current: true })
    await b.runtime.flush()
    expect(b.calls.filter(call => call.method === 'markSeen').map(call => call.request)).toEqual([
      { sessionId: 's1', seq: 9 }, { sessionId: 's3', seq: 4 },
    ])
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
    await face.updateTodo('t' as never, { status: 'done' })
    await face.removeTodo('t' as never)
    await face.ensureInbox()
    expect(b.calls.map(call => call.method)).toEqual([
      'get', 'setHandled', 'snooze', 'setPinned', 'markReviewed', 'addTodo', 'updateTodo', 'removeTodo',
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

  it('provides the session-todo seat: one worded todo per session, then the list opens', async () => {
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
    b.remote.$dispatch('session-inbox/changed', [inbox({ sessions: [mark('s1', { handledAt: 1 })] })])
    await b.runtime.flush()
    expect(set).toHaveBeenLastCalledWith(0)
    b.remote.$dispatch('session-inbox/changed', [inbox()])
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

describe('ui-digest node half', () => {
  it('contributes no host behavior', () => {
    expect(applyNode).not.toThrow()
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
