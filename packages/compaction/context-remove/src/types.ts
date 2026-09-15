/**
 * Public types of the context-removal service.
 * @module @deepseek-ai/dsh-context-remove/types
 */

import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'
import type { ContextRemovalId } from '@deepseek-ai/dsh-compaction'

/** Expected failure classes for one explicit idle-session turn removal. */
export type ContextRemovalErrorCode =
  /** The agent is driving a turn, running maintenance, or a compaction bracket is open. */
  | 'busy'
  /** A requested turn is unknown, still open, already removed, partly compacted, or not a balanced span. */
  | 'unavailable'
  /** The agent cancelled the maintenance task before the replacements landed. */
  | 'cancelled'
  /** Every replacement landed, but the durability checkpoint failed. */
  | 'persistence'

/** Agent capability required to serialize a removal against driver turns. */
export interface ContextRemovalAgentContext {
  readonly session: Session
  /**
   * Run a non-turn maintenance operation only while the agent is idle,
   * withholding later waking input until it settles.
   * @param task - operation whose fulfillment or rejection is preserved, with an agent-owned cancellation signal.
   * @throws synchronously when the agent is already active.
   * @returns the task promise.
   */
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
}

/** One landed replacement: a contiguous group of removed turns. */
export interface ContextRemovalGroup {
  /** Removed turn numbers in this group, ascending. */
  readonly turns: readonly number[]
  /** Seq of the `compaction/prune` shadow-price event. */
  readonly pruneSeq: SessionSeq
  /** Seq of the empty-content replacement user message. */
  readonly checkpointSeq: SessionSeq
  /** Surface-node seqs the checkpoint shadowed, in surface order. */
  readonly shadowedSeqs: readonly SessionSeq[]
  /** Heuristic token price of the shadowed nodes under the token meter's fixed estimator. */
  readonly shadowedTokenCount: number
}

/** Result of one successful removal request. */
export interface ContextRemovalResult {
  readonly removalId: ContextRemovalId
  /** Every removed turn, ascending. */
  readonly turns: readonly number[]
  /** Landed replacements in surface order; adjacent turns share one group. */
  readonly groups: readonly ContextRemovalGroup[]
}
