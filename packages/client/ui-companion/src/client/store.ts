/** Browser-only companion interaction state, retained across responsive remounts. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { CompanionUsageScope } from './index.ts'

/** Viewport-relative position of the detached companion. */
export interface CompanionPosition { x: number; y: number }

type CompanionState = {
  mood: 'idle' | 'greeting' | 'sleeping'
  collapsed: boolean
  paused: boolean
  position: CompanionPosition | null
  usage: CompanionUsageScope | null
}

type CompanionActions = {
  interact: (state: CompanionState) => void
  toggleCollapsed: (state: CompanionState) => void
  toggleMotion: (state: CompanionState) => void
  move: (state: CompanionState, position: CompanionPosition) => void
  dock: (state: CompanionState) => void
  openUsage: (state: CompanionState, scope: CompanionUsageScope) => void
  closeUsage: (state: CompanionState) => void
}

/** Create one plugin-owned companion store; reload starts a fresh companion.
 * @returns an independent store handle for the sidebar contribution.
 */
export function createCompanionStore(): EngineStoreHandle<CompanionState, CompanionActions> {
  return defineStore({
    init: (): CompanionState => ({ mood: 'idle', collapsed: false, paused: false, position: null, usage: null }),
    actions: {
      interact: (state) => {
        state.mood = state.mood === 'idle' ? 'greeting' : state.mood === 'greeting' ? 'sleeping' : 'idle'
      },
      toggleCollapsed: (state) => { state.collapsed = !state.collapsed },
      toggleMotion: (state) => { state.paused = !state.paused },
      move: (state, position) => { state.position = position },
      dock: (state) => { state.position = null },
      openUsage: (state, scope) => { state.usage = scope },
      closeUsage: (state) => { state.usage = null },
    },
  })
}
