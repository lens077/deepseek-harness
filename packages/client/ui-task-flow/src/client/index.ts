/**
 * Task-flow plugin, browser half: the Event Definitions and view target that
 * fold the Session into a flow graph, the resident strip above the composer,
 * the `Flow` Conversation view, and the two style preference rows.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' and 'conversation.input.dock' SlotMap rows and the Conversation service.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the renderer-owned slots service.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session standard hooks seat.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the settings-scope service and the 'settings.general.item' SlotMap row.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { TASK_FLOW_SETTINGS_NAMESPACE, type TaskFlowSettings } from '../settings.ts'
import { TASK_FLOW_TARGET, type FlowSnapshot } from './flow-contract.ts'
import { registerFlowDefinitions } from './flow-definitions.ts'
import { EMPTY_FLOW_SNAPSHOT } from './flow-model.ts'
import { registerFlowView } from './flow-view.ts'
import { FlowStyleRow, type FlowStyleRowInjected } from './FlowStyleRow.tsx'
import { FlowFontSizeRow, type FlowFontSizeRowInjected } from './FlowFontSizeRow.tsx'
import { MobileDockRow, type MobileDockRowInjected } from './MobileDockRow.tsx'
import { en, zh } from './locales.ts'
import { createTaskFlowDockStore } from './stores.ts'
import { FlowStylePolicy } from './style-policy.ts'
import { TaskFlowDock, type TaskFlowDockInjected } from './TaskFlowDock.tsx'
import { TaskFlowView, type TaskFlowViewInjected } from './TaskFlowView.tsx'

export type { TaskFlowKey } from './locales.ts'
export type {
  FlowLane, FlowLaneKind, FlowNode, FlowSnapshot, FlowStatus, FlowSummary, UseTaskFlow,
} from './flow-contract.ts'
export type { FlowStyle } from './style-policy.ts'
export type { TaskFlowDockInjected } from './TaskFlowDock.tsx'
export type { TaskFlowViewInjected } from './TaskFlowView.tsx'
export type { FlowStyleRowInjected } from './FlowStyleRow.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'taskFlow'

/** Task-flow runtime configuration. */
export interface Config {
  /** Tool names whose calls draw as delegated-agent nodes. */
  agentToolNames?: string[]
}

/** Validated task-flow runtime configuration. */
export const Config: z<Config> = z.object({
  agentToolNames: z.array(z.string()).default(['subagent', 'subagent_fork', 'workflow', 'ralph']),
})

/** Required services: slots, Sessions, the Conversation assembly, Session hooks, settings scope, and copy. */
export const inject = ['slots', 'sessions', 'uiConversation', 'uiSession', 'settingsScope', 'locale']

/**
 * Client plugin body: register the Definitions, the view target, the strip,
 * the canvas view, and the Settings rows. Every registration rides its effect
 * wrapper, so plugin unload removes all of them.
 * @param ctx - client root context.
 * @param config - validated runtime configuration.
 */
export function apply(ctx: Context, config: Config = Config({})): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-task-flow: dictionaries')
  const t = ctx.locale.bind(NS)
  const style = new FlowStylePolicy(ctx.settingsScope.bind<TaskFlowSettings>({ namespace: TASK_FLOW_SETTINGS_NAMESPACE }))
  registerFlowDefinitions(ctx, config.agentToolNames as string[])
  registerFlowView(ctx)

  const sources = new WeakMap<SessionBinding, ObservableSnapshot<FlowSnapshot>>()
  const flowSource = (binding: SessionBinding): ObservableSnapshot<FlowSnapshot> => {
    let source = sources.get(binding)
    if (source === undefined) {
      const target = ctx.uiConversation.binding(binding).target(TASK_FLOW_TARGET)
      source = {
        getSnapshot: () => target.getSnapshot() ?? EMPTY_FLOW_SNAPSHOT,
        subscribe: listener => target.subscribe(listener),
      }
      sources.set(binding, source)
    }
    return source
  }
  ctx.uiSession.provide({
    hooks: ['taskFlow'],
    resolve: binding => ({ hooks: { taskFlow: flowSource(binding) } }),
  })

  const stop = (sessionId: SessionId) => (): void => {
    const conversation = ctx.sessions.scope(sessionId)?.get('conversation')
    if (conversation === undefined) return
    conversation.cancel().catch(() => {
      // Stop failure is published through Session promptError.
    })
  }

  const dockStore = createTaskFlowDockStore()
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'task-flow',
    order: 20,
    locale: NS,
    store: dockStore,
    inject: (sessionId: SessionId): TaskFlowDockInjected => ({
      hooks: { flowStyle: style.style, mobileDock: style.mobileDock },
      stop: stop(sessionId),
      openCanvas: () => { ctx.uiConversation.openView(sessionId, TASK_FLOW_TARGET) },
      inspect: (callId) => { ctx.uiConversation.openView(sessionId, 'trajectory', callId) },
      setDockVariant: (variant) => { style.setDock(variant) },
      setFontSize: (fontSize) => { style.setFontSize(fontSize) },
    }),
  }, TaskFlowDock))

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: TASK_FLOW_TARGET,
    order: 20,
    locale: NS,
    label: () => t('view.taskFlow'),
    inject: (sessionId: SessionId): TaskFlowViewInjected => ({
      hooks: { flowStyle: style.style },
      stop: stop(sessionId),
      setCanvasVariant: (variant) => { style.setCanvas(variant) },
    }),
  }, TaskFlowView))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'task-flow-font-size',
    order: 42,
    locale: NS,
    inject: (): FlowFontSizeRowInjected => ({
      hooks: { flowStyle: style.style },
      setFontSize: (fontSize) => { style.setFontSize(fontSize) },
    }),
  }, FlowFontSizeRow))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'task-flow-mobile',
    order: 9,
    locale: NS,
    inject: (): MobileDockRowInjected => ({
      hooks: { mobileDock: style.mobileDock },
      setMobileDock: (enabled) => { style.setMobileDock(enabled) },
    }),
  }, MobileDockRow))

  for (const target of ['dock', 'canvas'] as const) {
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item',
      id: `task-flow-${target}`,
      order: target === 'dock' ? 40 : 41,
      locale: NS,
      inject: (): FlowStyleRowInjected => ({
        hooks: { flowStyle: style.style },
        target,
        setVariant: (variant) => { if (target === 'dock') style.setDock(variant); else style.setCanvas(variant) },
      }),
    }, FlowStyleRow))
  }
}
