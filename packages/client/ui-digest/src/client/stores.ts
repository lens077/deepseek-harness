/**
 * The inbox surface's viewing store: whether the panel is open, which tab it
 * shows, the time window, the workspace filter, whether handled rows are
 * listed, how the inbox is laid out, and whether cards show their reply.
 * One handle is shared by the sidebar entry and the panel inside `apply`,
 * which is what lets the button toggle a surface it does not render.
 * Module level exports the factory only (a module-level handle would pin the
 * store identity across plugin reloads).
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { InboxWindow } from './select.ts'
import type { WorkspaceRows } from './workspace-layout.ts'
import type { CardColumns } from './card-layout.ts'

/** The panel's four surfaces. */
export type InboxTab = 'inbox' | 'todos' | 'projects' | 'timeline'

/**
 * How the desktop inbox arranges its cards: `sections` stacks one section per
 * state top to bottom; `columns` is the board, one column per state side by
 * side.
 */
export type InboxLayout = 'sections' | 'columns'

/** Inbox viewing state persisted across surface remounts and reloads. */
type InboxViewState = {
  /** Whether the panel occupies the center column. */
  open: boolean
  tab: InboxTab
  window: InboxWindow
  /** Workspace filter: an id, `null` for ungrouped only, `undefined` for all. */
  workspace: string | null | undefined
  showHandled: boolean
  layout: InboxLayout
  /** Whether cards show the closing reply; off keeps the question and actions. */
  showReply: boolean
  /** Workspace strip row cap; expansion is temporary component state. */
  workspaceRows: WorkspaceRows
  /** Preferred card tracks per state group; narrower containers may fit fewer. */
  cardColumns: CardColumns
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type InboxViewActions = {
  toggle: (draft: InboxViewState) => void
  open: (draft: InboxViewState, tab?: InboxTab) => void
  close: (draft: InboxViewState) => void
  setTab: (draft: InboxViewState, tab: InboxTab) => void
  setWindow: (draft: InboxViewState, window: InboxWindow) => void
  setWorkspace: (draft: InboxViewState, workspace: string | null | undefined) => void
  toggleShowHandled: (draft: InboxViewState) => void
  setLayout: (draft: InboxViewState, layout: InboxLayout) => void
  toggleShowReply: (draft: InboxViewState) => void
  setWorkspaceRows: (draft: InboxViewState, rows: WorkspaceRows) => void
  setCardColumns: (draft: InboxViewState, columns: CardColumns) => void
}

/**
 * Create the inbox viewing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createDigestStore(): EngineStoreHandle<InboxViewState, InboxViewActions> {
  return defineStore({
    init: (): InboxViewState => ({
      open: false,
      tab: 'inbox',
      window: 'sinceReview',
      workspace: undefined,
      showHandled: false,
      layout: 'sections',
      showReply: true,
      workspaceRows: 'single',
      cardColumns: 5,
    }),
    persist: 'dsh.digest.view.v3',
    actions: {
      toggle: (d) => { d.open = !d.open },
      open: (d, tab?: InboxTab) => {
        d.open = true
        if (tab !== undefined) d.tab = tab
      },
      close: (d) => { d.open = false },
      setTab: (d, tab: InboxTab) => { d.tab = tab },
      setWindow: (d, window: InboxWindow) => { d.window = window },
      setWorkspace: (d, workspace: string | null | undefined) => { d.workspace = workspace },
      toggleShowHandled: (d) => { d.showHandled = !d.showHandled },
      setLayout: (d, layout: InboxLayout) => { d.layout = layout },
      toggleShowReply: (d) => { d.showReply = !d.showReply },
      setWorkspaceRows: (d, rows: WorkspaceRows) => { d.workspaceRows = rows },
      setCardColumns: (d, columns: CardColumns) => { d.cardColumns = columns },
    },
  })
}
