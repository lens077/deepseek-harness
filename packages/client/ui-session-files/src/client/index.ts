/**
 * Session file rail, browser half: one control at the head of the view-tab row
 * and one resident pane beside the active view. Both read the same derivation
 * of the conversation snapshot, so the count on the button and the list in the
 * rail cannot disagree. All policy lives here — what counts as a change, what
 * counts as a read, how long the read list is kept — so composing this plugin
 * out of cordis.yml removes the surface entirely and leaves both seats empty.
 * The durable Files-visibility preference gates the same two seats at
 * runtime, chosen from the Conversation-layout settings section this package
 * registers; the transcript's produced-file chips stay either way.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ChatFileDiffs } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Declaration-merge only: it is what puts `tool.call.tail` in the slot map so
// the registration below typechecks against the seat ui-tool declares.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { segmentLabel, sessionFilesOf } from './session-files.ts'
import { ConversationLayoutSection } from './ConversationLayoutSection.tsx'
import { FilesVisibilityRow, type FilesVisibilityRowInjected } from './FilesVisibilityRow.tsx'
import { RailVisibilityPolicy } from './rail-visibility.ts'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { SessionFilesRailController } from './rail-store.ts'
import { SessionTreeController, type SubagentApi } from './tree-controller.ts'
import { DelegationFiles, type DelegationFilesInjected } from './DelegationFiles.tsx'
import { mergeTreeChanges } from './tree-files.ts'
import { DiffExpansionPolicy } from './diff-expansion.ts'
import { DiffExpansionRow, type DiffExpansionRowInjected } from './DiffExpansionRow.tsx'
import { SESSION_FILES_SETTINGS_NAMESPACE, type SessionFilesSettings } from '../diff-settings.ts'
import { SessionFilesButton, type SessionFilesButtonInjected } from './SessionFilesButton.tsx'
import { SessionFilesRail, type SessionFilesRailInjected } from './SessionFilesRail.tsx'
import { en, NS, zh, type SessionFilesKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** File rail copy. */
    'session-files': SessionFilesKey
  }
}

export {
  basename, changedPaths, defaultSelection, deriveSessionFiles, diffHunks, labelBudget,
  readPaths, READ_LIMIT, segmentLabel, segmentLineStats, sessionFilesOf, textLineCount, truncateHead, turnResolver,
} from './session-files.ts'
export type {
  SessionFileEntry, SessionFilesModel, SessionFileSegment,
} from './session-files.ts'
export {
  clampRailWidth, RAIL_DEFAULT, RAIL_MAX, RAIL_MIN, RAIL_PERSIST_KEY, SessionFilesRailController,
} from './rail-store.ts'
export type { SessionFilesRailState } from './rail-store.ts'
export { railRows, TREE_INDENT_PX } from './rail-rows.ts'
export type { RailDirRow, RailFileRow, RailRow } from './rail-rows.ts'
export { deriveTreeFiles, mergeTreeChanges } from './tree-files.ts'
export type { TreeFileChange, TreeHistoryEntry, TreeSource } from './tree-files.ts'
export { SessionTreeController } from './tree-controller.ts'
export type { SessionTreeEntry, SessionTreeState, SubagentApi } from './tree-controller.ts'
export { DiffExpansionPolicy, SectionFieldPolicy } from './diff-expansion.ts'
export { RailVisibilityPolicy } from './rail-visibility.ts'
export { ConversationLayoutSection } from './ConversationLayoutSection.tsx'
export type { ConversationLayoutItemOwnerProps, ConversationLayoutSectionProps } from './ConversationLayoutSection.tsx'
export { FilesVisibilityRow, type FilesVisibilityRowInjected } from './FilesVisibilityRow.tsx'
export { DiffExpansionRow, type DiffExpansionRowInjected } from './DiffExpansionRow.tsx'
export { DelegationFiles, childSessionOf } from './DelegationFiles.tsx'
export type { DelegationFilesInjected, DelegationFilesProps } from './DelegationFiles.tsx'
export { SessionFilesButton, type SessionFilesButtonInjected } from './SessionFilesButton.tsx'
export { SessionFilesRail, type SessionFilesRailInjected } from './SessionFilesRail.tsx'

/**
 * Bring one file's most recent recorded activity into view.
 *
 * Tool rows carry their file as `data-file`, so the transcript is queried
 * rather than indexed: the rail holds no reference to a rendered row, and a
 * row outside the loaded window simply has no match. Attributes are compared
 * instead of built into a selector so no path needs escaping.
 * @param path - the file-tool path exactly as the rail lists it.
 */
export function revealFile(path: string): void {
  let last: Element | undefined
  for (const candidate of document.querySelectorAll('[data-file]')) {
    if (candidate.getAttribute('data-file') === path) last = candidate
  }
  last?.scrollIntoView({ block: 'center' })
}

/** Required services for locale registration and the two seat contributions. */
export const inject = ['sessions', 'slots', 'locale', 'settingsScope', 'connection']

/**
 * Client plugin body: register the dictionaries, the tab-row control, and the rail.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new SessionFilesRailController()
  const connection = ctx.get('connection') as ConnectionHandle
  const tree = new SessionTreeController(
    (connection.api as unknown as { subagents: SubagentApi }).subagents,
  )
  ctx.effect(() => async () => { await tree.dispose() }, 'ui-session-files: descendant reads')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-session-files: dictionaries')

  // The inline-diff side of the same derivation: a surface that already lists a
  // turn's changed files asks this face what the session did to one of them.
  // Reached through ctx.get, so composing this plugin out turns that surface
  // off rather than breaking the package that draws it.
  const t = ctx.locale.bind(NS)
  const scope = ctx.settingsScope.bind<SessionFilesSettings>({ namespace: SESSION_FILES_SETTINGS_NAMESPACE })
  const expansionPolicy = new DiffExpansionPolicy(scope)
  const visibilityPolicy = new RailVisibilityPolicy(scope)

  /**
   * Keep one seat registered exactly while the Files surface is set to show.
   * The returned disposer removes the subscription and any live registration,
   * so the surrounding declaration lifetime still collects everything.
   * @param register - takes the seat; its disposer releases it.
   * @returns disposer for the gate and any live seat.
   */
  const seatWhileVisible = (register: () => () => void): () => void => {
    let seat: (() => void) | undefined
    const reconcile = (): void => {
      const visible = visibilityPolicy.visibility.getSnapshot() === 'show'
      if (visible === (seat !== undefined)) return
      if (visible) {
        seat = register()
        return
      }
      const dispose = seat
      seat = undefined
      dispose?.()
    }
    const unsubscribe = visibilityPolicy.visibility.subscribe(reconcile)
    reconcile()
    return () => {
      unsubscribe()
      const dispose = seat
      seat = undefined
      dispose?.()
    }
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'conversation-layout',
    // Below every shipped section (General 0, Models 10, Plugins 15, Agent
    // presets 20) and the installed vision bundle (30): a tuning page, not a
    // daily destination.
    order: 40,
    locale: NS,
    label: () => t('settings.layout.nav'),
    children: { 'settings.conversation-layout.item': { kind: 'list', scope: 'root' } },
  }, ConversationLayoutSection))
  ctx.slots.inject('settings.conversation-layout.item', () => ctx.slots.register({
    name: 'settings.conversation-layout.item',
    id: 'session-files-visibility',
    // The whole-surface switch reads before the per-diff behavior below it.
    order: 10,
    locale: NS,
    inject: (): FilesVisibilityRowInjected => ({
      hooks: { filesVisibility: visibilityPolicy.visibility },
      setFilesVisibility: (visibility) => { visibilityPolicy.set(visibility) },
    }),
  }, FilesVisibilityRow))
  ctx.slots.inject('settings.conversation-layout.item', () => ctx.slots.register({
    name: 'settings.conversation-layout.item',
    id: 'session-files-diff-expansion',
    order: 20,
    locale: NS,
    inject: (): DiffExpansionRowInjected => ({
      hooks: { diffExpansion: expansionPolicy.expansion },
      setDiffExpansion: (expansion) => { expansionPolicy.set(expansion) },
    }),
  }, DiffExpansionRow))

  const diffs: ChatFileDiffs = {
    expansion: expansionPolicy.expansion,
    forPath(sessionId, path) {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) return []
      // Merged, so a file only a subagent touched still has a diff to draw.
      const merged = mergeTreeChanges(
        sessionFilesOf(session.getSnapshot()),
        tree.store.getSnapshot().bySession[String(sessionId)]?.sources ?? [],
      )
      const entry = merged.changed.find(file => file.path === path)
      if (entry === undefined) return []
      return entry.segments.map(segment => ({
        label: segmentLabel(segment, t),
        oldText: segment.oldText,
        newText: segment.newText,
      }))
    },
    // Local only: a descendant's turn numbers are its own session's, so
    // merging them here would attribute a subagent's turn 3 to this session's.
    // The delegation call itself still lands in the parent turn that made it.
    forTurn(sessionId, turn) {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) return []
      return sessionFilesOf(session.getSnapshot()).byTurn.get(turn) ?? []
    },
  }
  ctx.provide('chatFileDiffs', diffs)

  ctx.slots.inject('conversation.session.tabs.leading', () => seatWhileVisible(() => ctx.slots.register({
    name: 'conversation.session.tabs.leading',
    id: 'session-files',
    locale: NS,
    inject: (): SessionFilesButtonInjected => ({
      hooks: { rail: controller.store },
      toggle: () => { controller.toggle() },
    }),
  }, SessionFilesButton)))

  ctx.slots.inject('tool.call.tail', () => ctx.slots.register({
    name: 'tool.call.tail',
    id: 'session-files-delegation',
    locale: NS,
    inject: (): DelegationFilesInjected => ({
      hooks: { tree: tree.store, diffExpansion: expansionPolicy.expansion },
      label: segment => segmentLabel(segment, t),
    }),
  }, DelegationFiles))

  ctx.slots.inject('conversation.session.rail', () => seatWhileVisible(() => ctx.slots.register({
    name: 'conversation.session.rail',
    locale: NS,
    inject: (sessionId: SessionId): SessionFilesRailInjected => ({
      hooks: { rail: controller.store, tree: tree.store },
      setWidth: (px) => { controller.setWidth(px) },
      loadTree: () => { void tree.refresh(sessionId, false) },
      loadAll: () => {
        void loadAllHistory(ctx, sessionId)
        void tree.refresh(sessionId, true)
      },
      reveal: revealFile,
    }),
  }, SessionFilesRail)))
}

/**
 * Page in the rest of this session's history.
 *
 * The rail's list only covers loaded history, so completeness is one explicit
 * request rather than an eager fetch on every open. Each page is awaited before
 * the next is asked for, and the loop ends when the session reports no more —
 * or when the session is gone, which is the case a mid-load navigation leaves.
 * @param ctx - client root context carrying the session registry.
 * @param sessionId - the session whose history is completed.
 */
async function loadAllHistory(ctx: ClientContext, sessionId: SessionId): Promise<void> {
  for (;;) {
    const session = ctx.sessions.binding(sessionId)?.session
    if (session === undefined || !session.getSnapshot().hasMore) return
    await session.loadOlder()
  }
}
