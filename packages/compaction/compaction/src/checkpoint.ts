/**
 * Checkpoint provenance for surface-replacing condensation: the correlated
 * source constructor and type every compaction backend uses for its summary
 * replacement user message, the source a context removal writes on its
 * empty-content replacement, and the predicates that recognize either
 * persisted checkpoint.
 *
 * The seam itself lives in `@deepseek-ai/dsh-compaction`, which re-exports these
 * contracts; this module is a pure type/value/predicate outlet (no cordis
 * imports, no module augmentation) so client and wire programs can name the
 * checkpoint source without loading the host plugin's Context merges — the
 * `dsh-commands/brand` shape.
 *
 * @module @deepseek-ai/dsh-compaction/checkpoint
 */

import type { MessageSource } from '@deepseek-ai/dsh-llm/message'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { CompactionId, ContextRemovalId } from './brand.ts'

const COMPACT_CHECKPOINT_MARKER = Object.freeze({ kind: 'plugin', plugin: 'compact' } as const)

/** Message provenance carried by a concrete compaction checkpoint. */
export type CompactionCheckpointSource = typeof COMPACT_CHECKPOINT_MARKER & {
  readonly compactionId: CompactionId
  readonly sourceCommandId?: CommandId
}

/**
 * Create checkpoint provenance correlated with one compaction transaction.
 * @param compactionId - owning compaction identity.
 * @param sourceCommandId - initiating manual command, when present.
 * @returns immutable checkpoint source.
 */
export function compactCheckpointSource(
  compactionId: CompactionId,
  sourceCommandId?: CommandId,
): CompactionCheckpointSource {
  return Object.freeze({
    ...COMPACT_CHECKPOINT_MARKER,
    compactionId,
    ...sourceCommandId === undefined ? {} : { sourceCommandId },
  })
}

/**
 * Test whether a persisted message source identifies a compaction checkpoint.
 * @param source - source restored from a surface user message.
 * @returns whether the source carries the backend-independent checkpoint marker.
 */
export function isCompactCheckpointSource(source: MessageSource): boolean {
  return source.kind === 'plugin' && source.plugin === COMPACT_CHECKPOINT_MARKER.plugin
}

const CONTEXT_REMOVAL_MARKER = Object.freeze({ kind: 'plugin', plugin: 'context-remove' } as const)

/**
 * Message provenance carried by one context-removal checkpoint. The checkpoint
 * message has empty content, so it projects to no wire message; the source is
 * the only place the removed turns are named on the surface.
 */
export type ContextRemovalSource = typeof CONTEXT_REMOVAL_MARKER & {
  readonly removalId: ContextRemovalId
  /** Turns whose complete surface span this checkpoint replaced, ascending. */
  readonly turns: readonly number[]
  /** Log seqs of the turn-opening user messages inside the replaced span, ascending. */
  readonly promptSeqs: readonly number[]
}

/**
 * Create checkpoint provenance for one contiguous group of removed turns.
 * @param removalId - owning removal request identity.
 * @param turns - removed turn numbers, ascending.
 * @param promptSeqs - removed turn-opening user message seqs, ascending.
 * @returns immutable checkpoint source.
 */
export function contextRemovalSource(
  removalId: ContextRemovalId,
  turns: readonly number[],
  promptSeqs: readonly number[],
): ContextRemovalSource {
  return Object.freeze({
    ...CONTEXT_REMOVAL_MARKER,
    removalId,
    turns: Object.freeze([...turns]),
    promptSeqs: Object.freeze([...promptSeqs]),
  })
}

/**
 * Test whether a persisted message source identifies a context-removal checkpoint.
 * @param source - source restored from a surface user message.
 * @returns whether the source carries the removal marker with well-formed turn data.
 */
export function isContextRemovalSource(source: MessageSource): source is ContextRemovalSource {
  if (source.kind !== 'plugin' || source.plugin !== CONTEXT_REMOVAL_MARKER.plugin) return false
  const candidate = source as Partial<ContextRemovalSource>
  return typeof candidate.removalId === 'string'
    && Array.isArray(candidate.turns)
    && candidate.turns.every(turn => typeof turn === 'number')
    && Array.isArray(candidate.promptSeqs)
    && candidate.promptSeqs.every(seq => typeof seq === 'number')
}
