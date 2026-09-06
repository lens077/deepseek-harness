// @vitest-environment jsdom
/**
 * ui-task-flow browser half over the real Slot runtime and the real
 * Conversation assembly: the plugin registers its Definitions, view target,
 * dock entry, Flow view tab, and Settings rows; the injected faces stop the
 * Session, open the canvas through the Conversation shell, and inspect a call
 * in Trajectory; a Session's events reach the provided `taskFlow` hook; and
 * every registration leaves with the plugin fiber. The node half registers
 * the settings namespace only when a settings provider exists.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ISession, SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionBehaviorOverrides } from '@deepseek-ai/dsh-client-test-runtime'
import {
  apply as applyConversation, inject as conversationInject, type ConversationSessionInjected,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import {
  apply, Config, inject, type FlowStyleRowInjected, type TaskFlowDockInjected, type TaskFlowViewInjected,
} from '../src/client/index.ts'
import { apply as nodeApply, TASK_FLOW_SETTINGS_NAMESPACE } from '../src/index.ts'
import type { FlowSnapshot } from '../src/client/flow-contract.ts'
import { EMPTY_FLOW_SNAPSHOT } from '../src/client/flow-model.ts'

const ROOT = 'root-1' as SessionId

let runtime: SlotTestRuntime | undefined

afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
})

function at(seq: number, type: string, data: unknown, extra: Record<string, unknown> = {}): SessionLiveEventEntry {
  return { type: 'event', event: { seq, time: seq * 1_000, type, data, ...extra } as SessionEvent }
}

const EVENTS: readonly SessionLiveEventEntry[] = [
  at(1, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [{ id: 'm1', role: 'user', content: [], source: { kind: 'user' } }] }),
  at(2, 'turn/start', { turn: 1 }),
  at(3, 'user/message', { id: 'm1', role: 'user', content: [{ type: 'text', text: 'build it' }], source: { kind: 'user' } }, { surfaceOp: 'append' }),
  at(4, 'step/start', { turn: 1, step: 1 }),
  at(5, 'todo/write', { todos: [{ content: 'plan', status: 'in_progress' }] }),
  at(6, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'subagent', arguments: JSON.stringify({ description: 'reviewer' }) }),
]

async function bench() {
  runtime = await SlotTestRuntime.create()
  const settingsStub = stubSettingsScope()
  const bind = vi.fn(() => settingsStub.scope)
  runtime.ctx.provide('settingsScope', { bind } as never)
  runtime.ctx.provide('uiWorkspace', { connectWorkspace: vi.fn(async () => ROOT) } as never)
  const session = {
    loadOlder: vi.fn<ISession['loadOlder']>(() => Promise.resolve()),
    prompt: vi.fn<ISession['prompt']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
    cancel: vi.fn<ISession['cancel']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
  } satisfies SessionBehaviorOverrides
  await runtime.sessions.add({ id: ROOT, summary: { title: 'R', displayTitle: 'R', cwd: '/proj' }, session }, { current: false })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.root.declare({
    'conversation': { kind: 'single', scope: 'session-maybe' },
    'settings.general.item': { kind: 'list', scope: 'root' },
  }, (_props: { renderSlot?: unknown }) => null)
  await runtime.mount({ inject: [...conversationInject], apply: applyConversation })
  const feature = await runtime.mount({ inject: [...inject], apply: (ctx: Context) => { apply(ctx, Config({ agentToolNames: ['subagent'] })) } })
  runtime.renderRoot()
  const rt = runtime
  const mountShell = () => {
    const entry = rt.slots.entries('conversation.session')[0]!
    const instance = rt.storeOf('conversation.session', ROOT) as unknown as {
      actions: unknown
      store: { getSnapshot(): { view: string | null; viewRequest: unknown } }
    }
    ;(entry.inject as unknown as (sessionId: SessionId, actions: unknown) => ConversationSessionInjected)(ROOT, instance.actions)
    return instance.store
  }
  const dockInjected = () => {
    const entry = rt.slots.entries('conversation.input.dock').find(candidate => candidate.options.id === 'task-flow')!
    return (entry.inject as unknown as (sessionId: SessionId) => TaskFlowDockInjected)(ROOT)
  }
  const viewInjected = () => {
    const entry = rt.slots.entries('conversation.view').find(candidate => candidate.options.id === 'task-flow')!
    return (entry.inject as unknown as (sessionId: SessionId) => TaskFlowViewInjected)(ROOT)
  }
  const rowInjected = (id: string) => {
    const entry = rt.slots.entries('settings.general.item').find(candidate => candidate.options.id === id)!
    return (entry.inject as unknown as () => FlowStyleRowInjected)()
  }
  return { runtime: rt, feature, session, settingsStub, bind, mountShell, dockInjected, viewInjected, rowInjected }
}

describe('ui-task-flow browser plugin', () => {
  it('registers Definitions, the view target, the dock entry, the Flow tab, and two Settings rows', async () => {
    const b = await bench()
    const kinds = b.runtime.ctx.uiConversation.events.entries().map(definition => definition.kind)
    expect(kinds).toEqual(expect.arrayContaining(['task-flow-prompt', 'task-flow-inbox', 'task-flow-todo', 'task-flow-agent']))
    expect(b.runtime.ctx.uiConversation.views.entries().map(definition => definition.target)).toContain('task-flow')
    expect(b.runtime.slots.entries('conversation.input.dock').map(entry => entry.options.id)).toContain('task-flow')
    const tab = b.runtime.slots.entries('conversation.view').find(entry => entry.options.id === 'task-flow')!
    expect(tab.options).toMatchObject({ order: 20 })
    expect(tab.locale).toBe('taskFlow')
    expect(['流程', 'Flow']).toContain((tab.options as { label: () => string }).label())
    const rows = () => b.runtime.slots.entries('settings.general.item').map(entry => entry.options.id).filter(id => id?.startsWith('task-flow'))
    expect(rows()).toEqual(['task-flow-mobile', 'task-flow-dock', 'task-flow-canvas', 'task-flow-font-size'])
    expect(b.bind).toHaveBeenCalledWith({ namespace: TASK_FLOW_SETTINGS_NAMESPACE })

    await b.feature.dispose()
    expect(b.runtime.ctx.uiConversation.events.entries().map(definition => definition.kind)).not.toContain('task-flow-prompt')
    expect(b.runtime.ctx.uiConversation.views.entries().map(definition => definition.target)).not.toContain('task-flow')
    expect(b.runtime.slots.entries('conversation.input.dock').map(entry => entry.options.id)).not.toContain('task-flow')
    expect(b.runtime.slots.entries('conversation.view').map(entry => entry.options.id)).not.toContain('task-flow')
    expect(rows()).toHaveLength(0)
  })

  it('folds Session events into the provided taskFlow hook and routes the injected faces', async () => {
    const b = await bench()
    await b.runtime.sessions.replaceEvents(ROOT, EVENTS)
    const source = b.runtime.ctx.uiConversation.binding(ROOT).target('task-flow')
    const unsubscribe = source.subscribe(() => {})
    const snapshot = source.getSnapshot() as FlowSnapshot
    expect(snapshot.lanes.map(lane => lane.id)).toEqual(['turn:1'])
    expect(snapshot.lanes[0]!.nodeIds).toEqual(['prompt:m1', 'todo:1:0', 'agent:c1'])
    expect(snapshot.nodes.get('agent:c1')).toMatchObject({ title: 'reviewer', status: 'running', parentId: 'todo:1:0' })
    unsubscribe()

    const store = b.mountShell()
    const dock = b.dockInjected()
    dock.openCanvas()
    expect(store.getSnapshot()).toMatchObject({ view: 'task-flow', viewRequest: null })
    dock.inspect('c1')
    expect(store.getSnapshot()).toMatchObject({ view: 'trajectory', viewRequest: { view: 'trajectory', focus: 'c1' } })
    dock.stop()
    await Promise.resolve()
    expect(b.session.cancel).toHaveBeenCalledTimes(1)
    b.session.cancel.mockImplementationOnce(() => Promise.resolve({ ok: false, error: { code: 'x', message: 'refused' } } as never))
    dock.stop()
    await Promise.resolve()
    await Promise.resolve()
    expect(b.session.cancel).toHaveBeenCalledTimes(2)

    dock.setFontSize(14)
    expect(b.settingsStub.set).toHaveBeenCalledWith('fontSize', 14)
    expect(dock.hooks.flowStyle.getSnapshot()).toEqual({ dock: 'rail', canvas: 'cards', fontSize: 14 })
    dock.setFontSize(11)
    dock.setDockVariant('lanes')
    expect(b.settingsStub.set).toHaveBeenCalledWith('dockVariant', 'lanes')
    const view = b.viewInjected()
    view.setCanvasVariant('rail')
    expect(b.settingsStub.set).toHaveBeenCalledWith('canvasVariant', 'rail')
    expect(view.hooks.flowStyle.getSnapshot()).toEqual({ dock: 'lanes', canvas: 'rail', fontSize: 11 })
    view.stop()
    await Promise.resolve()
    expect(b.session.cancel).toHaveBeenCalledTimes(3)

    const dockRow = b.rowInjected('task-flow-dock')
    const canvasRow = b.rowInjected('task-flow-canvas')
    expect(dockRow.target).toBe('dock')
    expect(canvasRow.target).toBe('canvas')
    dockRow.setVariant('cards')
    canvasRow.setVariant('lanes')
    expect(dockRow.hooks.flowStyle.getSnapshot()).toEqual({ dock: 'cards', canvas: 'lanes', fontSize: 11 })

    const provided = b.runtime.ctx.uiSession.adapter.resolve(ROOT)!.hooks.taskFlow as ObservableSnapshot<FlowSnapshot>
    expect(b.runtime.ctx.uiSession.adapter.resolve(ROOT)!.hooks.taskFlow).toBe(provided)
    expect((provided.getSnapshot()).lanes.map(lane => lane.id)).toEqual(['turn:1'])
    const listener = vi.fn()
    const release = provided.subscribe(listener)
    await b.runtime.sessions.replaceEvents(ROOT, [])
    expect(listener).toHaveBeenCalled()
    expect(provided.getSnapshot().lanes).toEqual([])
    release()
    const second = 'root-2' as SessionId
    await b.runtime.sessions.add({ id: second, summary: { title: 'S', displayTitle: 'S', cwd: '/proj' } }, { current: false })
    const idle = b.runtime.ctx.uiSession.adapter.resolve(second)!.hooks.taskFlow as ObservableSnapshot<FlowSnapshot>
    expect(idle.getSnapshot()).toBe(EMPTY_FLOW_SNAPSHOT)

    await b.runtime.sessions.remove(ROOT)
    dock.stop()
    await Promise.resolve()
    expect(b.session.cancel).toHaveBeenCalledTimes(3)
  })
})

describe('ui-task-flow node plugin', () => {
  it('registers the settings namespace only when a settings provider exists', async () => {
    const ctx = new Context()
    const register = vi.fn()
    const fiber = ctx.plugin({ apply: nodeApply })
    await fiber.await()
    expect(register).not.toHaveBeenCalled()
    ctx.provide('settings', { register })
    await Promise.resolve()
    await Promise.resolve()
    expect(register).toHaveBeenCalledWith(TASK_FLOW_SETTINGS_NAMESPACE, expect.anything())
    await ctx.fiber.dispose()
  })
})
