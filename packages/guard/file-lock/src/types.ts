/**
 * Client-safe types of the file-lock policy: the user-editable settings
 * section, the durable `file-lock/*` session events, and the `fileLocks`
 * projection a UI reads.
 * @module @deepseek-ai/dsh-tool-call-file-lock/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/**
 * What a read does when its wait expires and no human can be asked: the
 * caller is a delegated agent, or no user-questions service is mounted.
 */
export type DelegatedReadTimeoutPolicy = 'wait' | 'read-now'

/** The user-editable section stored under the `file-lock` settings namespace. */
export interface FileLockSettings {
  /** Milliseconds a foreign read waits silently before the user is asked. */
  readonly readWaitMs: number
  /** Milliseconds a foreign write waits for the lease before it is refused. */
  readonly writeWaitMs: number
  /** Milliseconds after which a lease is released even though its turn has not ended. */
  readonly leaseTtlMs: number
  /** Read behavior after the wait expires when no human can be asked. */
  readonly delegatedReadTimeout: DelegatedReadTimeoutPolicy
}

/** Which file access a tool call performs, decided from its arguments. */
export type FileAccess = 'read' | 'write'

/** The session currently leasing a file, as recorded in events and shown to the model. */
export interface FileLockHolder {
  /** Session that took the lease. */
  readonly session: SessionId
  /** That session's workspace directory, when it has one. */
  readonly cwd?: string
  /** That session's title, when a title service is mounted and has one. */
  readonly title?: string
}

/** Why a wait for a foreign lease ended. */
export type FileLockWaitOutcome = 'released' | 'read-now' | 'refused' | 'aborted'

/** Who decided that a read proceeds against a live foreign lease. */
export type FileLockReadNowDecider = 'user' | 'policy'

/** Where the file-lock state of one waiting call stands. */
export type FileLockWaitPhase = 'waiting' | 'asked' | 'subscribed'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** This session leased `path` for modification until the current turn ends. */
    'file-lock/acquired': { path: string }
    /** A call of this session started waiting for another session's lease on `path`. */
    'file-lock/waiting': { path: string; access: FileAccess; holder: FileLockHolder }
    /** The silent read wait expired; the user was asked whether to read now or keep waiting. */
    'file-lock/asked': { path: string; holder: FileLockHolder; waitedMs: number }
    /** A read against a live foreign lease was decided: by the user's answer or by the delegated-read policy. */
    'file-lock/answered': { path: string; choice: 'read-now' | 'keep-waiting'; by: FileLockReadNowDecider }
    /** A read subscribed for the release of `path` with no time bound. */
    'file-lock/subscribed': { path: string; holder: FileLockHolder }
    /** The wait for `path` ended; the read or write then proceeded, was refused, or was cancelled. */
    'file-lock/settled': { path: string; access: FileAccess; outcome: FileLockWaitOutcome; waitedMs: number }
    /** Leases this session held were released before its turn ended. */
    'file-lock/released': { paths: string[]; reason: 'ttl' }
  }
}

/** One call of this session waiting for a foreign lease. */
export interface FileLockWaiting {
  readonly path: string
  readonly access: FileAccess
  readonly holder: FileLockHolder
  readonly phase: FileLockWaitPhase
  /** Epoch milliseconds of the `file-lock/waiting` event. */
  readonly since: number
}

/** Durable `fileLocks` projection state: what this session leases and what it waits for. */
export interface FileLocksProjectionState {
  /** Display paths this session leases in its open turn. */
  readonly held: readonly string[]
  /** The call currently waiting for a foreign lease, or null. */
  readonly waiting: FileLockWaiting | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Files this session leases and the foreign lease it waits for. */
    fileLocks: FileLocksProjectionState
  }
  interface SessionProjectionMap {
    /** Files this session leases and the foreign lease it waits for. */
    fileLocks: FileLocksProjectionState
  }
}
