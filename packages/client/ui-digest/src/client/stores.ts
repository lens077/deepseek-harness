/**
 * The inbox surface's viewing store: whether the panel is open, which tab it
 * shows, the time window, the workspace filter, and whether handled rows are
 * listed. One handle is shared by the sidebar entry and the panel inside
 * `apply`, which is what lets the button toggle a surface it does not render.
 * Module level exports the factory only (a module-level handle would pin the
 * store identity across plugin reloads).
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { InboxWindow } from './select.ts'

/** The panel's four surfaces. */
export type InboxTab = 'inbox' | 'todos' | 'projects' | 'timeline'

/** Inbox viewing state persisted across surface remounts and reloads. */
type InboxViewState = {
  /** Whether the panel occupies the center column. */
  open: boolean
  tab: InboxTab
  window: InboxWindow
  /** Workspace filter: an id, `null` for ungrouped only, `undefined` for all. */
  workspace: string | null | undefined
  showHandled: boolean
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
    }),
    persist: 'dsh.digest.view.v2',
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
    },
  })
}
