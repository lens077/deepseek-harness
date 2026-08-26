/**
 * The rail's own geometry and open state, persisted for the browser rather than
 * per session: the reader who closes the rail wants it closed everywhere, and
 * the width they dragged is a property of their window, not of one conversation.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Rail drag clamp floor. */
export const RAIL_MIN = 240
/** Rail drag clamp ceiling. */
export const RAIL_MAX = 560
/** Rail width before any drag. */
export const RAIL_DEFAULT = 300

/** localStorage key holding the whole rail preference. */
export const RAIL_PERSIST_KEY = 'dsh.session-files.rail'

/** Reader preference for the file rail. */
export interface SessionFilesRailState {
  /** Open on first use; thereafter whatever the reader last chose. */
  open: boolean
  /** Dragged width in px, inside the clamp range. */
  width: number
}

const INITIAL: SessionFilesRailState = { open: true, width: RAIL_DEFAULT }

/**
 * Clamp a requested width into the rail's contract range.
 * @param px - requested width.
 * @returns the clamped width, rounded to whole pixels.
 */
export function clampRailWidth(px: number): number {
  return Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(px)))
}

/** Owns the persisted rail preference and the writes the rail and its button make. */
export class SessionFilesRailController {
  /** uSES-safe preference source read by the rail and its toggle. */
  readonly store: SnapshotStore<SessionFilesRailState>

  /** @param persistKey - localStorage key; tests pass their own to stay isolated. */
  constructor(persistKey: string = RAIL_PERSIST_KEY) {
    this.store = createSnapshotStore(INITIAL, { persist: { name: persistKey } })
  }

  /** Flip the rail open or closed. */
  toggle(): void {
    this.store.update((state) => {
      state.open = !state.open
    })
  }

  /**
   * Adopt a dragged width, clamped.
   * @param px - requested width in px.
   */
  setWidth(px: number): void {
    const width = clampRailWidth(px)
    this.store.update((state) => {
      state.width = width
    })
  }
}
