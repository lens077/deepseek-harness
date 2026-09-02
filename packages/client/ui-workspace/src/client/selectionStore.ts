/**
 * The workspace browser's session-row selection store: which rows are
 * multi-selected, plus the Explorer anchor and lead.
 *
 * Deliberately separate from the viewing store in `stores.ts` because
 * persistence is whole-value: that store declares `persist`, so any field
 * added to it survives a reload. A selection restored from a previous visit
 * would highlight rows the user never picked, so this store declares no
 * `persist` key and starts empty on every load. The enable flag itself is a
 * setting and does live in the persisted store.
 */
import { defineStore, type EngineStoreHandle, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { EMPTY_SELECTION, type SelectionState } from './selection.ts'

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type SessionSelectionActions = {
  /** Replace the whole selection (the pure model computes every transition). */
  setSelection: (draft: SelectionState, next: SelectionState) => void
  /** Drop every selected row, keeping no anchor or lead. */
  clearSelection: (draft: SelectionState) => void
}

/**
 * Create the session-row selection store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createSessionSelectionStore(): EngineStoreHandle<SelectionState, SessionSelectionActions> {
  return defineStore({
    init: (): SelectionState => EMPTY_SELECTION,
    actions: {
      setSelection: (d, next: SelectionState) => {
        d.selected = [...next.selected] as SessionId[]
        d.anchor = next.anchor
        d.lead = next.lead
      },
      clearSelection: (d) => {
        d.selected = []
        d.anchor = undefined
        d.lead = undefined
      },
    },
  })
}
