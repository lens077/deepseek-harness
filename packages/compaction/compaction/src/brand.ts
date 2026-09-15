import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity shared by one compact start/summary/checkpoint/end transaction. */
export type CompactionId = Branded<'CompactionId'>

/**
 * Brand an implementation-minted compaction identity.
 * @param id - opaque transaction identity.
 * @returns the same string, branded; no validation is performed.
 */
export function CompactionId(id: string): CompactionId {
  return id as CompactionId
}

/** Stable identity shared by every replacement one context-removal request landed. */
export type ContextRemovalId = Branded<'ContextRemovalId'>

/**
 * Brand an implementation-minted context-removal identity.
 * @param id - opaque removal identity.
 * @returns the same string, branded; no validation is performed.
 */
export function ContextRemovalId(id: string): ContextRemovalId {
  return id as ContextRemovalId
}
