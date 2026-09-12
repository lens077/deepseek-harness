/**
 * The `fileLocks` projection: leases a session holds in its open turn and the
 * foreign lease one of its calls waits for, folded from `file-lock/*` events
 * and cleared by `turn/end`.
 * @module @deepseek-ai/dsh-tool-call-file-lock/projection
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { FileLocksProjectionState, FileLockWaiting } from './types.ts'

const holderSchema = z.object({
  session: z.string().min(1),
  cwd: z.string().optional(),
  title: z.string().optional(),
})

const waitingSchema = z.object({
  path: z.string(),
  access: z.enum(['read', 'write']),
  holder: holderSchema,
  phase: z.enum(['waiting', 'asked', 'subscribed']),
  since: z.number(),
}) as unknown as z.ZodType<FileLockWaiting>

const stateSchema = z.object({
  held: z.array(z.string()),
  waiting: waitingSchema.nullable(),
}) as unknown as z.ZodType<FileLocksProjectionState>

const EMPTY: FileLocksProjectionState = Object.freeze({ held: [], waiting: null })

function phase(state: FileLocksProjectionState, next: FileLockWaiting['phase']): FileLocksProjectionState {
  return state.waiting === null ? state : { ...state, waiting: { ...state.waiting, phase: next } }
}

/**
 * Advance the file-lock state by one Session event.
 * @param state - state before the event.
 * @param event - next committed Session event.
 * @returns the original or advanced state.
 */
function applyFileLocks(state: FileLocksProjectionState, event: SessionEvent): FileLocksProjectionState {
  switch (event.type) {
    case 'turn/end':
      return state.held.length === 0 && state.waiting === null ? state : EMPTY
    case 'file-lock/acquired':
      return state.held.includes(event.data.path) ? state : { ...state, held: [...state.held, event.data.path] }
    case 'file-lock/released': {
      const held = state.held.filter(path => !event.data.paths.includes(path))
      return held.length === state.held.length ? state : { ...state, held }
    }
    case 'file-lock/waiting':
      return {
        ...state,
        waiting: { path: event.data.path, access: event.data.access, holder: event.data.holder, phase: 'waiting', since: event.time },
      }
    case 'file-lock/asked':
      return phase(state, 'asked')
    case 'file-lock/subscribed':
      return phase(state, 'subscribed')
    case 'file-lock/settled':
      return state.waiting === null ? state : { ...state, waiting: null }
    default:
      return state
  }
}

/** Projection definition registered by the plugin; exported for consumers that fold logs offline. */
export const fileLocksProjection = {
  key: 'fileLocks',
  stateVersion: 1,
  stateSchema,
  init: () => EMPTY,
  apply: applyFileLocks,
  wire: {
    viewSchema: stateSchema,
    view: state => state,
  },
} satisfies ProjectionDefinition<'fileLocks', FileLocksProjectionState>
