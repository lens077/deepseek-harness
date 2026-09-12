/** Per-session strip state: whether the drawing below the header is expanded. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Strip viewing state. */
export interface TaskFlowDockState {
  expanded: boolean
}

/** Declared write set for the strip. */
type TaskFlowDockActions = {
  setExpanded: (draft: TaskFlowDockState, expanded: boolean) => void
}

/**
 * Declare the per-session strip store; the expanded flag persists per Session.
 * @returns the store handle.
 */
export function createTaskFlowDockStore(): EngineStoreHandle<TaskFlowDockState, TaskFlowDockActions> {
  return defineStore({
    init: (): TaskFlowDockState => ({ expanded: true }),
    persist: 'dsh.task-flow.dock',
    actions: {
      setExpanded: (d, expanded: boolean) => { d.expanded = expanded },
    },
  })
}
