/**
 * The `task-flow` Conversation view target: one incremental builder per
 * Session that keeps the current target Nodes by key and reassembles the
 * snapshot on every publication.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationTimelineSnapshot, ConversationViewBuilder, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TASK_FLOW_TARGET, type FlowConversationViewNode, type FlowSnapshot } from './flow-contract.ts'
import { buildFlowSnapshot, EMPTY_FLOW_SNAPSHOT } from './flow-model.ts'

/**
 * Create one Session-owned task-flow builder.
 * @returns a builder whose snapshot is the complete reassembly of its current Nodes.
 */
export function createFlowViewBuilder(): ConversationViewBuilder<FlowConversationViewNode, FlowSnapshot> {
  const current = new Map<string, FlowConversationViewNode>()
  const assemble = (timeline: ConversationTimelineSnapshot): FlowSnapshot => buildFlowSnapshot(current.values(), timeline)
  return {
    empty: EMPTY_FLOW_SNAPSHOT,
    replace: ({ nodes, timeline }) => {
      current.clear()
      for (const node of nodes) current.set(node.key, node)
      return assemble(timeline)
    },
    apply: ({ upserts, timeline }) => {
      for (const node of upserts) current.set(node.key, node)
      return assemble(timeline)
    },
  }
}

/** Registry contribution for the task-flow target. */
export const flowViewDefinition: ConversationViewDefinition<FlowConversationViewNode, FlowSnapshot> = {
  target: TASK_FLOW_TARGET,
  create: createFlowViewBuilder,
  isActive: snapshot => snapshot.lanes.length > 0,
}

/**
 * Register the task-flow view target.
 * @param ctx - owning Client context.
 */
export function registerFlowView(ctx: Context): void {
  ctx.uiConversation.views.register(flowViewDefinition)
}
