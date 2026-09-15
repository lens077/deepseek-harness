import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { isContextRemovalSource } from '@deepseek-ai/dsh-compaction/checkpoint'
import { isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { chatNode } from './common.ts'

/**
 * One landed context removal: the empty checkpoint that replaced a contiguous
 * group of completed turns in model history. The transcript keeps the removed
 * rows; this Node marks where the removal landed and which turns it covers.
 */
export interface ContextRemovalNode {
  readonly kind: 'context-removal'
  /** Seq of the checkpoint replacement event. */
  readonly seq: number
  /** Unix epoch ms of the checkpoint event. */
  readonly time: number
  /** Removed turn numbers, ascending. */
  readonly turns: readonly number[]
  /** Seqs of the removed turn-opening user messages, ascending. */
  readonly promptSeqs: readonly number[]
  /** Surface items the checkpoint shadowed, or null when the event cites none. */
  readonly shadowedItemCount: number | null
}

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Context-removal checkpoint marker. */
    'context-removal': ContextRemovalNode
  }
}

/** Context-removal checkpoint Definition: one Node per landed replacement. */
export const contextRemovalDefinition: ConversationNodeDefinition<ContextRemovalNode> = {
  kind: 'context-removal',
  target: 'chat',
  match: event => event.type === 'user/message'
    && isReplacementSurfaceEvent(event)
    && isContextRemovalSource(event.data.source)
    ? { id: `${event.data.source.removalId}:${String(event.seq)}`, role: 'start' }
    : null,
  start: (_context, match) => {
    const event = match.event
    if (event.type !== 'user/message' || !isContextRemovalSource(event.data.source)) {
      throw new Error('context-removal start requires a removal checkpoint')
    }
    const cited = event.sourceEventSeqs
    return {
      kind: 'context-removal',
      seq: event.seq,
      time: event.time,
      turns: event.data.source.turns,
      promptSeqs: event.data.source.promptSeqs,
      // The citation is the prune event plus every shadowed surface node.
      shadowedItemCount: cited === undefined ? null : Math.max(0, cited.length - 1),
    }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return chatNode(context, 'context-removal', context.state.seq, context.state)
  },
}

/**
 * Register the context-removal checkpoint contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerContextRemovalConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(contextRemovalDefinition)
}
