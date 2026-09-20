/**
 * The workspace browser's viewing store: the session-list grouping mode,
 * persisted across reloads. Module level exports the factory only (a
 * module-level handle would pin the store identity across plugin reloads);
 * register() receives the factory and the browser derives its PropsStore
 * share from the return type.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { PIN_SHORTCUT_DIGIT_PRESET, PIN_SHORTCUT_SLOTS, assignPinShortcut, type PinShortcutChord } from './pin-shortcuts.ts'

/** Browser-local order account for the hierarchy-free flat Session list. */
export const FLAT_SESSION_ORDER_KEY = '__flat_session_order__'

/** Session-list presentation: workspace sections, one flat list, or the archive set. */
export type SessionGroupBy = 'workspace' | 'flat' | 'archived'
/** Session order: user-arranged only, or user-arranged plus activity promotion. */
export type SessionOrderBy = 'manual' | 'updated'
/** Collapsed rows per Workspace, or automatic sizing from available height. */
export type CollapsedSessionCount = number | 'auto'
/**
 * Session-row status perimeter: `animated` rotates the running highlight,
 * `static` keeps the state-colored track without motion, and `hidden` omits
 * the perimeter while status dots and accessible labels remain.
 */
export type SessionStatusIndicatorMode = 'animated' | 'static' | 'hidden'

/** Workspace browser viewing state persisted across surface remounts and reloads. */
type WorkspaceViewState = {
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  collapsedSessionCount: CollapsedSessionCount
  /**
   * Fold state the user set by toggling a group header (or expanded by
   * starting a Session from its ＋), keyed by Workspace group identity. A
   * group without an entry follows the current Session; reveals never write
   * here, so a fold outlives Sessions opened inside it from other surfaces.
   */
  groupExpansion: Record<string, boolean>
  /** Shared editable order per Workspace group plus the browser-local flat-list account. */
  sessionOrderByAccount: Record<string, string[]>
  /** Last observed update timestamps per order account for one-time promotion events. */
  sessionUpdatedAtByAccount: Record<string, Record<string, number>>
  /**
   * Browser-local nested placement for the Ungrouped bucket (child Session id
   * → parent Session id). A real Workspace records nesting on its Host
   * record; Sessions outside every Workspace have no such record, so a
   * nested fork of an Ungrouped source is remembered here instead.
   */
  ungroupedNestedUnder: Record<string, string>
  /**
   * Whether Shift/Ctrl range and toggle selection is active on session rows.
   * Disabled restores plain single-click-opens behavior and ignores the
   * modifier keys entirely.
   */
  multiSelect: boolean
  /** Presentation of the running/completed/error perimeter on Session rows. */
  sessionStatusIndicatorMode: SessionStatusIndicatorMode
  /** Whether the sidebar pinned area shows only its header. */
  pinnedCollapsed: boolean
  /**
   * Sessions the user removed from the pinned area while they were listed
   * only by status (Session id → the auto-pin status key at removal). The
   * removal holds while the Session's matched statuses stay the same and
   * lapses once they change or the user pins it.
   */
  pinnedAutoDismissed: Record<string, string>
  /**
   * Whether the pinned-area shortcuts answer keydown events in this tab.
   * Off keeps the bindings for later.
   */
  pinnedShortcutsEnabled: boolean
  /**
   * One chord per pinned-area position, first row first; `null` leaves the
   * position without a key. Browser-local: the bindings never reach the Host.
   */
  pinnedShortcuts: (PinShortcutChord | null)[]
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type WorkspaceViewActions = {
  setPinnedShortcutsEnabled: (draft: WorkspaceViewState, enabled: boolean) => void
  setPinnedShortcut: (draft: WorkspaceViewState, slot: number, chord: PinShortcutChord | null) => void
  setPinnedShortcuts: (draft: WorkspaceViewState, chords: readonly (PinShortcutChord | null)[]) => void
  setGroupBy: (draft: WorkspaceViewState, mode: SessionGroupBy) => void
  setOrderBy: (draft: WorkspaceViewState, mode: SessionOrderBy) => void
  setCollapsedSessionCount: (draft: WorkspaceViewState, count: CollapsedSessionCount) => void
  setMultiSelect: (draft: WorkspaceViewState, enabled: boolean) => void
  setSessionStatusIndicatorMode: (draft: WorkspaceViewState, mode: SessionStatusIndicatorMode) => void
  setPinnedCollapsed: (draft: WorkspaceViewState, collapsed: boolean) => void
  dismissAutoPinned: (draft: WorkspaceViewState, sessionId: string, statusKey: string) => void
  clearAutoPinDismissal: (draft: WorkspaceViewState, sessionId: string) => void
  setGroupExpanded: (draft: WorkspaceViewState, key: string, expanded: boolean) => void
  retainAccountKeys: (draft: WorkspaceViewState, workspaceKeys: readonly string[]) => void
  syncSessionOrderAccount: (
    draft: WorkspaceViewState,
    accountKey: string,
    order: string[],
    updatedAt: Record<string, number>,
  ) => void
  setSessionOrder: (draft: WorkspaceViewState, accountKey: string, order: string[]) => void
  setUngroupedNesting: (draft: WorkspaceViewState, childId: string, parentId: string) => void
}

/**
 * Create the workspace browser viewing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createWorkspaceViewStore(): EngineStoreHandle<WorkspaceViewState, WorkspaceViewActions> {
  return defineStore({
    init: (): WorkspaceViewState => ({
      groupBy: 'workspace',
      orderBy: 'updated',
      collapsedSessionCount: 5,
      groupExpansion: {},
      sessionOrderByAccount: {},
      sessionUpdatedAtByAccount: {},
      ungroupedNestedUnder: {},
      multiSelect: true,
      sessionStatusIndicatorMode: 'animated',
      pinnedCollapsed: false,
      pinnedAutoDismissed: {},
      pinnedShortcutsEnabled: true,
      pinnedShortcuts: [...PIN_SHORTCUT_DIGIT_PRESET],
    }),
    // A stored value merges over init(), so a field addition keeps the key;
    // only a change to an existing field's meaning or type bumps it, because
    // every bump discards the user's folds, orders, and preferences.
    persist: 'dsh.workspace.view.v12',
    actions: {
      setPinnedShortcutsEnabled: (d, enabled: boolean) => { d.pinnedShortcutsEnabled = enabled },
      setPinnedShortcut: (d, slot: number, chord: PinShortcutChord | null) => {
        d.pinnedShortcuts = assignPinShortcut(d.pinnedShortcuts, slot, chord)
      },
      setPinnedShortcuts: (d, chords: readonly (PinShortcutChord | null)[]) => {
        d.pinnedShortcuts = Array.from({ length: PIN_SHORTCUT_SLOTS }, (_, slot) => chords[slot] ?? null)
      },
      setGroupBy: (d, mode: SessionGroupBy) => { d.groupBy = mode },
      setOrderBy: (d, mode: SessionOrderBy) => { d.orderBy = mode },
      setCollapsedSessionCount: (d, count: CollapsedSessionCount) => { d.collapsedSessionCount = count },
      setMultiSelect: (d, enabled: boolean) => { d.multiSelect = enabled },
      setSessionStatusIndicatorMode: (d, mode: SessionStatusIndicatorMode) => {
        d.sessionStatusIndicatorMode = mode
      },
      setPinnedCollapsed: (d, collapsed: boolean) => { d.pinnedCollapsed = collapsed },
      dismissAutoPinned: (d, sessionId: string, statusKey: string) => { d.pinnedAutoDismissed[sessionId] = statusKey },
      clearAutoPinDismissal: (d, sessionId: string) => {
        d.pinnedAutoDismissed = Object.fromEntries(
          Object.entries(d.pinnedAutoDismissed).filter(([key]) => key !== sessionId),
        )
      },
      setGroupExpanded: (d, key: string, expanded: boolean) => { d.groupExpansion[key] = expanded },
      retainAccountKeys: (d, workspaceKeys: readonly string[]) => {
        const retained = new Set(workspaceKeys)
        d.groupExpansion = Object.fromEntries(
          Object.entries(d.groupExpansion).filter(([key]) => retained.has(key)),
        )
        d.sessionOrderByAccount = Object.fromEntries(
          Object.entries(d.sessionOrderByAccount).filter(([key]) => retained.has(key)),
        )
        d.sessionUpdatedAtByAccount = Object.fromEntries(
          Object.entries(d.sessionUpdatedAtByAccount).filter(([key]) => retained.has(key)),
        )
      },
      syncSessionOrderAccount: (d, accountKey: string, order: string[], updatedAt: Record<string, number>) => {
        d.sessionOrderByAccount[accountKey] = order
        d.sessionUpdatedAtByAccount[accountKey] = updatedAt
      },
      setSessionOrder: (d, accountKey: string, order: string[]) => {
        d.sessionOrderByAccount[accountKey] = order
      },
      setUngroupedNesting: (d, childId: string, parentId: string) => {
        d.ungroupedNestedUnder[childId] = parentId
      },
    },
  })
}
