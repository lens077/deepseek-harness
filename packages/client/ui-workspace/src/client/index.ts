/**
 * Workspace plugin, browser half. Two registrations: WorkspaceBrowser fills
 * the sidebar shell's `sidebar.workspaces` hole (the whole browsing region),
 * and WorkspacePicker fills the conversation hero's picker hole
 * (`conversation.hero.workspace` — both hero forms). Both read real Host
 * Workspaces through the global useWorkspaces hook. The picker declares its
 * Workspace directory-flow child; the browser declares Workspace and Session
 * directory-flow children for a composed picker package (see the contract
 * module doc). Export discipline:
 * packages/client/AGENTS.md.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the Controller service merges.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_SESSION_PINS_VIEW,
  type SessionPinsView, type WorkspaceBrowserInjected, type WorkspacePickerInjected,
} from './contract/slots.ts'
import { UiWorkspaceService } from './navigation.ts'
import { createWorkspaceViewStore } from './stores.ts'
import { createSessionSelectionStore } from './selectionStore.ts'
import type { SelectionState } from './selection.ts'
import { WorkspaceBrowser } from './rows/WorkspaceBrowser.tsx'
import { WorkspacePicker } from './WorkspacePicker.tsx'
import { SessionCountSettingsRow } from './SessionCountSettingsRow.tsx'
import { MultiSelectSettingsRow } from './MultiSelectSettingsRow.tsx'
import { SessionStatusSettingsRow } from './SessionStatusSettingsRow.tsx'
import { en, zh, type WorkspaceKey } from './locales.ts'

export type { UiWorkspace } from './navigation.ts'
export type {
  DirectoryFlowOwnerProps, DirectoryFlowSlotName, DirectoryPickingHooks, DirectoryPickingInjected,
  SessionPins, SessionPinsView, SessionTodos,
  WorkspaceBrowserInjected, WorkspaceBrowserProps, WorkspacePickerInjected, WorkspacePickerProps,
} from './contract/slots.ts'
export type { WorkspaceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface GlobalStandardProps {
    /** Selector hook over the pure Workspace Controller snapshot. */
    useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>
  }

  interface LocaleNamespaceMap {
    /** The workspace browsing region and pick/create flow copy. */
    workspace: WorkspaceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'workspace'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * the ui-sidebar / ui-conversation applies, whose activation order relative
 * to this one is NOT constrained: dsh.client.inject edges are informational
 * (loading/prefetch metadata, never apply sequencing) and neither owner
 * provides a waitable service. apply therefore depends on each slot
 * declaration through `slots.inject()` instead of assuming order.
 */
export const inject = [
  'slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker',
]

/**
 * Register the browser and picker once their slot declarations are on the
 * ledger. Inject factories return plain callbacks; data reads use the
 * framework's global hooks.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const sessionPinsMirror = createSnapshotStore<SessionPinsView>(DEFAULT_SESSION_PINS_VIEW)
  ctx.inject(['sessionPins'], (pinCtx) => {
    pinCtx.effect(() => {
      const sync = (): void => { sessionPinsMirror.set(pinCtx.sessionPins.view.getSnapshot()) }
      sync()
      const dispose = pinCtx.sessionPins.view.subscribe(sync)
      return () => {
        dispose()
        sessionPinsMirror.set(DEFAULT_SESSION_PINS_VIEW)
      }
    }, 'ui-workspace: session pins')
  })
  const sessions = ctx.get('sessions') as ISessions
  const workspaces = ctx.get('workspaces') as IWorkspaces
  const uiWorkspace = new UiWorkspaceService(
    ctx, ctx.remote.directoryPicker, workspaces, sessions)
  ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list } })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace: dictionaries')

  const searchSessions: WorkspaceBrowserInjected['searchSessions'] = async (query, signal) => {
    const result = await sessions.search(query, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  // Stable per-surface occupancy sources (the renderer's hook cache keys by
  // source identity): true while the surface's directory-flow hole is filled.
  const flowSource = (hole:
    | 'sidebar.workspaces.directoryFlow'
    | 'sidebar.workspaces.sessionDirectoryFlow'
    | 'conversation.hero.workspace.directoryFlow',
  ): HostObservable<boolean> => ({
    getSnapshot: () => ctx.slots.entries(hole).length > 0,
    subscribe: listener => ctx.slots.subscribe(hole, listener),
  })
  const workspaceViewStore = createWorkspaceViewStore()
  // The browser's second store: session-row multi-selection. The register
  // store seat already carries the persisted viewing store, and persistence is
  // whole-value, so the selection lives in its own non-persisted instance and
  // reaches the component through the reserved `hooks` compartment.
  const sessionSelection = createSessionSelectionStore().create()
  const browserFlowSource = flowSource('sidebar.workspaces.directoryFlow')
  const sessionDirectoryFlowSource = flowSource('sidebar.workspaces.sessionDirectoryFlow')
  const pickerFlowSource = flowSource('conversation.hero.workspace.directoryFlow')
  const hostInfo: HostObservable<RemoteHostFacts> = {
    getSnapshot: () => ctx.remote.$host,
    subscribe: listener => ctx.on('connection/reset', listener),
  }
  const browserInjected = (): WorkspaceBrowserInjected => ({
    // Explicit group actions keep their target; unscoped New Session inherits
    // the current Session Workspace before the recent-Workspace fallback.
    startSession: (workspaceId) => { uiWorkspace.startSession(workspaceId) },
    startScratchSession: () => {
      uiWorkspace.startScratchSession().catch((reason: unknown) => {
        console.warn('new session failed:', reason)
      })
    },
    open: (sessionId) => { sessions.open(sessionId) },
    searchSessions,
    searchResultLimit: sessions.searchResultLimit,
    renameSession: async (sessionId, title) => {
      // Row → session-face hop: rename is a per-session verb (ISession), not
      // a list-service verb; the binding resolves any listed session.
      const session = sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error.message)
    },
    sessionDirectories: sessionId => ctx.sessions.directories(sessionId),
    replaceSessionDirectories: (sessionId, additionalDirectories) =>
      ctx.sessions.replaceDirectories(sessionId, additionalDirectories),
    forkSession: async (sessionId, placement) => {
      try {
        const childId = await ctx.sessions.fork({
          sessionId,
          increaseTitle: true,
          ...(placement === undefined ? {} : { placement }),
        })
        ctx.sessions.open(childId)
        return childId
      } catch {
        // Fork or child-rename failure keeps the current selection.
        return undefined
      }
    },
    renameWorkspace: async (workspaceId, title) => { await workspaces.rename(workspaceId, title) },
    deleteWorkspace: async (workspaceId) => { await workspaces.delete(workspaceId) },
    insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
      await workspaces.insertBefore(workspaceId, beforeWorkspaceId)
    },
    archiveSession: async (sessionId) => { await ctx.workspaces.archiveSession(sessionId) },
    archiveSessions: async (sessionIds) => { await ctx.workspaces.archiveSessions(sessionIds) },
    unarchiveSession: async (sessionId) => { await ctx.workspaces.unarchiveSession(sessionId) },
    deleteSession: sessionId => ctx.sessions.delete(sessionId),
    addTodos: (sessionIds) => { ctx.get('sessionTodos')?.add(sessionIds) },
    todosAvailable: () => ctx.get('sessionTodos') !== undefined,
    setPinned: async (sessionIds, pinned) => {
      const provider = ctx.get('sessionPins')
      if (provider === undefined) throw new Error('session pinning is unavailable')
      await provider.setPinned(sessionIds, pinned)
    },
    setSessionMembership: (workspaceId, sessionIds, member) =>
      ctx.workspaces.setSessionMembership(workspaceId, sessionIds, member),
    insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
      await workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    },
    createWorkspace: input => ctx.workspaces.create(input),
    setSessionSelection: (next: SelectionState) => { sessionSelection.actions.setSelection(next) },
    clearSessionSelection: () => { sessionSelection.actions.clearSelection() },
    hooks: {
      directoryFlow: browserFlowSource,
      sessionDirectoryFlow: sessionDirectoryFlowSource,
      hostInfo,
      sessionSelection: {
        getSnapshot: () => sessionSelection.getSnapshot(),
        subscribe: listener => sessionSelection.subscribe(listener),
      },
      sessionPins: {
        getSnapshot: () => sessionPinsMirror.getSnapshot(),
        subscribe: listener => sessionPinsMirror.subscribe(listener),
      },
    },
  })
  const pickerInjected = (): WorkspacePickerInjected => ({
    createWorkspace: input => workspaces.create(input),
    hooks: { directoryFlow: pickerFlowSource },
  })
  // Each registration declares its directory-flow child in the same call;
  // slot injection follows both the owner and declaration HMR lifetimes.
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register(
    {
      name: 'sidebar.workspaces',
      children: {
        'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
        'sidebar.workspaces.sessionDirectoryFlow': { kind: 'single', scope: 'root' },
      },
      store: workspaceViewStore,
      inject: browserInjected,
      locale: NS,
    },
    WorkspaceBrowser,
  ))
  ctx.slots.inject('settings.general.item', function* () {
    yield ctx.slots.register({
      name: 'settings.general.item',
      id: 'workspace-session-count',
      order: 25,
      store: workspaceViewStore,
      inject: () => ({}),
      locale: NS,
    }, SessionCountSettingsRow)
    yield ctx.slots.register({
      name: 'settings.general.item',
      id: 'workspace-multi-select',
      order: 26,
      store: workspaceViewStore,
      inject: () => ({}),
      locale: NS,
    }, MultiSelectSettingsRow)
    yield ctx.slots.register({
      name: 'settings.general.item',
      id: 'workspace-session-status',
      order: 27,
      store: workspaceViewStore,
      inject: () => ({}),
      locale: NS,
    }, SessionStatusSettingsRow)
  })
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register(
    {
      name: 'conversation.hero.workspace',
      children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
      inject: pickerInjected,
      locale: NS,
    },
    WorkspacePicker,
  ))
}
