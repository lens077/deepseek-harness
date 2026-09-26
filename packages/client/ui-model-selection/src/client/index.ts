/**
 * Model selection plugin, browser half — THREE entries over ONE per-session
 * directory owned by ModelDirectoryResolver (`ctx.modelDirectories`). The /model popupSelect
 * contribution, the composer's named `conversation.input.model` seat, and the
 * quick-switch strip above the composer share one Host-generation
 * `session/modelCatalog` catalog, combine it with the Session's durable
 * model-selection projection, and submit through `session.selectModel`.
 * A switch made in any entry is what the others show next, and every accepted
 * selection is folded into the durable recent-model list the strip offers.
 * Failures ride each entry's own retry surface (popup shell error/retry; seat
 * menu inline error; strip toast) without forking the state. Addressed
 * subagent sessions expose no entry because those Agent-bound RPCs would
 * activate persisted history outside the direct-parent continuation path.
 */
// Type-only: the carrier types, the forwarded Host-event face and the ctx.remote merge.
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { CommandUiContract, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.model seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls ctx.settingsScope and the 'settings.general.item' SlotMap row.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MODEL_SELECTION_SETTINGS_NAMESPACE, type ModelSelectionSettings } from '../model-selection-settings.ts'
import type { ModelDirectory, ModelDirectoryState } from './directory.ts'
import { ModelDirectoryResolver } from './service.ts'
import type { ModelSelectInjected } from './slots.ts'
import { ModelSelect } from './ModelSelect.tsx'
import { QuickModelDock, type QuickModelSwitchInjected } from './QuickModelSwitch.tsx'
import { QuickSwitchRow, type QuickSwitchRowInjected } from './QuickSwitchRow.tsx'
import { QuickSwitchPolicy } from './quick-switch.ts'
import { en, zh, type ModelKey } from './locales.ts'

export { ModelDirectory } from './directory.ts'
export type { ModelDirectoryState } from './directory.ts'
export { ModelDirectoryResolver } from './service.ts'
export type { ModelSelectInjected } from './slots.ts'
export type { QuickModelSwitchInjected, QuickSwitchResult } from './QuickModelSwitch.tsx'
export type { QuickSwitchRowInjected } from './QuickSwitchRow.tsx'
export type { QuickModelChip, QuickSwitchState } from './quick-switch.ts'
export type { ModelKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The model selection surfaces' copy (/model popup + composer seat). */
    model: ModelKey
  }
}

/** One selectable row's id: an opaque row key (resolved by lookup, never parsed). */
function rowId(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}

/** Flatten the directory into popup rows; failure rows are listed for visibility but never selectable. */
function optionsOf(directory: ModelDirectoryState, t: TranslateNS<'model'>): SelectOption[] {
  const rows: SelectOption[] = []
  for (const group of directory.groups) {
    for (const model of group.models) {
      rows.push({
        id: rowId(group.id, model.id),
        label: model.name,
        detail: model.description !== undefined ? `${group.name} · ${model.description}` : group.name,
        ...(directory.current !== null
          && directory.current.provider === group.id
          && directory.current.model === model.id
          ? { active: true } : {}),
      })
    }
  }
  for (const failure of directory.failures) {
    rows.push({
      id: `failure/${failure.id}`,
      label: failure.name,
      detail: t('option.loadError', { message: failure.message }),
    })
  }
  return rows
}

/**
 * Resolve a picked row back to its model selection by matching against the loaded
 * groups (the same data the rows were built from — ids stay opaque).
 * @param state - the session's directory snapshot.
 * @param id - the picked row id.
 * @returns the row's model selection, or undefined for failure rows / stale ids.
 */
function selectionOf(state: ModelDirectoryState, id: string): ModelSelection | undefined {
  for (const group of state.groups) {
    for (const model of group.models) {
      if (rowId(group.id, model.id) !== id) continue
      const sameRoute = state.current?.provider === group.id && state.current.model === model.id
      const reasoningEffort = sameRoute
        ? state.current?.reasoningEffort ?? model.reasoning?.defaultEffort
        : model.reasoning?.defaultEffort
      return {
        provider: group.id,
        model: model.id,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
      }
    }
  }
  return undefined
}

/** Dictionary namespace owned by this plugin. */
const NS = 'model'

/** Required services: the contribution registry, the slot registry, locale, settings, and the service's own faces. */
export const inject = ['commandUi', 'locale', 'sessions', 'slots', 'settingsScope', 'remote', 'remote.session']

/**
 * Client plugin body: mount ModelDirectoryResolver, register the `model` dictionaries,
 * then register the /model popup contribution, the composer model seat, the
 * quick-switch strip, and its Settings row over the service.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-model-selection: dictionaries')

  // Non-slot faces (the command description, the popup option builder) read
  // through the bound translate; the seat component reads the standard seat.
  const t = ctx.locale.bind(NS)

  // The composer-block reason is this plugin's own copy, read at raise time so
  // a locale change reaches the next publish.
  ctx.plugin(ModelDirectoryResolver, { blockReason: () => t('blocked.composer') })

  const quickSwitch = new QuickSwitchPolicy(
    ctx.settingsScope.bind<ModelSelectionSettings>({ namespace: MODEL_SELECTION_SETTINGS_NAMESPACE }),
  )

  /**
   * Submit through the session's directory and, once the Host accepts,
   * remember the selection and the route it replaced. Recording follows the
   * accepted selection, not the request, so a refused route never enters the
   * strip; failures propagate to the caller's own surface.
   */
  const selectAndRecord = async (directory: ModelDirectory, selection: ModelSelection): Promise<void> => {
    const previous = directory.store.getSnapshot().current
    await directory.select(selection)
    quickSwitch.record(selection, previous)
  }

  // Entry 1: the /model popupSelect over the shared directory.
  ctx.inject(['commandUi', 'modelDirectories'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.effect(() => command.register({
      name: 'model',
      description: () => t('command.description'),
      available: session => sessions.subagentAddress(session.sessionId) === undefined,
      ui: {
        kind: 'popupSelect',
        options: async (session) => {
          if (sessions.subagentAddress(session.sessionId) !== undefined) {
            throw new Error('model selection is unavailable for addressed subagent sessions')
          }
          return optionsOf(await models.directoryFor(session.sessionId).load(), t)
        },
        onSelect: async (option, session) => {
          if (sessions.subagentAddress(session.sessionId) !== undefined) {
            throw new Error('model selection is unavailable for addressed subagent sessions')
          }
          const directory = models.directoryFor(session.sessionId)
          const selection = selectionOf(directory.store.getSnapshot(), option.id)
          if (selection === undefined) {
            throw new Error('this provider\'s catalog failed to load — pick a model from a loaded group')
          }
          await selectAndRecord(directory, selection)
        },
      },
    }), 'ui-model-selection: /model contribution')
  })

  // Entry 2: the composer's named model seat over the SAME directory.
  ctx.inject(['slots', 'modelDirectories'], (scope: ClientContext) => {
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model',
      locale: NS,
      inject: (sessionId): ModelSelectInjected => {
        const directory = models.directoryFor(sessionId)
        const available = sessions.subagentAddress(sessionId) === undefined
        return {
          available,
          directory: directory.store,
          load: () => {
            if (available) directory.load().catch(() => { /* surfaced on the store */ })
          },
          select: (selection: ModelSelection) => available
            ? selectAndRecord(directory, selection).then(() => true, () => false)
            : Promise.resolve(false),
        }
      },
    }, ModelSelect))
  })

  // Entry 3: the quick-switch strip above the composer, over the SAME
  // directory. It is the last dock entry so it sits directly above the card.
  ctx.inject(['slots', 'modelDirectories'], (scope: ClientContext) => {
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.slots.inject('conversation.input.dock', () => scope.slots.register({
      name: 'conversation.input.dock',
      id: 'model-quick-switch',
      order: 50,
      locale: NS,
      inject: (sessionId: SessionId): QuickModelSwitchInjected => {
        const directory = models.directoryFor(sessionId)
        const available = sessions.subagentAddress(sessionId) === undefined
        return {
          hooks: { modelDirectory: directory.store, quickSwitch: quickSwitch.state },
          available,
          // The directory refuses an unavailable session itself; the strip
          // does not render for one, so the refusal text only reaches a caller
          // holding this face directly.
          select: (selection: ModelSelection) => selectAndRecord(directory, selection).then(
            () => ({ accepted: true as const }),
            (error: unknown) => ({
              accepted: false as const,
              message: directory.store.getSnapshot().error ?? (error instanceof Error ? error.message : String(error)),
            }),
          ),
        }
      },
    }, QuickModelDock))
  })

  // The strip's on/off row in General Settings.
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'model-quick-switch',
    order: 16,
    locale: NS,
    inject: (): QuickSwitchRowInjected => ({
      hooks: { quickSwitch: quickSwitch.state },
      setQuickSwitch: (enabled) => { quickSwitch.setEnabled(enabled) },
    }),
  }, QuickSwitchRow))
}
