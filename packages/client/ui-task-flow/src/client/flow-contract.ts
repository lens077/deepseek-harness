/**
 * Task-flow data model: the target-owned Node payloads folded by this
 * package's Definitions and the assembled snapshot both drawings consume.
 */
import type { ConversationLocation, ConversationViewNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'

/** Conversation view target owned by this package. */
export const TASK_FLOW_TARGET = 'task-flow'

/** One user prompt that opens or steers a turn. */
export interface FlowPromptContribution {
  readonly kind: 'prompt'
  readonly messageId: string
  readonly seq: number
  readonly time: number
  /** Turn the prompt was logged in; null while its boundary is outside the loaded window. */
  readonly turn: number | null
  /** Plain-text preview of the prompt content. */
  readonly text: string
}

/** One durable inbox splice that admitted user messages. */
export interface FlowInboxContribution {
  readonly kind: 'inbox'
  readonly seq: number
  readonly time: number
  readonly messageIds: readonly string[]
  /** Turn that was open when the messages were admitted; null between turns. */
  readonly duringTurn: number | null
}

/** One whole-list todo snapshot. */
export interface FlowTodoContribution {
  readonly kind: 'todo'
  readonly seq: number
  readonly time: number
  readonly turn: number | null
  readonly todos: readonly TodoItem[]
}

/** One delegated-agent tool call with its settled outcome. */
export interface FlowAgentContribution {
  readonly kind: 'agent'
  readonly callId: string
  readonly toolName: string
  readonly label: string
  readonly seq: number
  readonly turn: number
  readonly step: number
  readonly startTime: number
  readonly endTime?: number
  readonly isError?: boolean
}

/** Target-owned Node payload union. */
export type FlowContribution =
  | FlowPromptContribution
  | FlowInboxContribution
  | FlowTodoContribution
  | FlowAgentContribution

/** Target envelope consumed by the task-flow snapshot builder. */
export interface FlowConversationViewNode extends ConversationViewNode {
  readonly target: typeof TASK_FLOW_TARGET
  readonly anchorSeq: number
  readonly location: ConversationLocation
  readonly data: FlowContribution
}

/** Drawn state of one node or route. */
export type FlowStatus = 'pending' | 'running' | 'done' | 'risk' | 'error' | 'aborted' | 'interrupted'

/**
 * How a route relates to the conversation: the first prompt, a prompt admitted
 * while a turn was running, or a follow-up prompt sent after the previous turn closed.
 */
export type FlowLaneKind = 'main' | 'interjection' | 'sequel'

/** One drawn node. */
export interface FlowNode {
  readonly id: string
  readonly laneId: string
  readonly kind: 'prompt' | 'todo' | 'agent' | 'steps' | 'terminal'
  /** Verbatim user or model text; empty for `steps` and `terminal` nodes, whose copy is locale-owned. */
  readonly title: string
  readonly detail?: string
  /** Terminal failure category; authentication errors never retain provider message text. */
  readonly failureCode?: string
  /** Agent steps covered by a `steps` node. */
  readonly stepCount?: number
  readonly status: FlowStatus
  readonly startTime?: number
  readonly endTime?: number
  /** Durable ordering evidence, also the Trajectory focus for agent nodes. */
  readonly anchorSeq: number
  readonly turn: number
  /** Spine node an agent fans out from. */
  readonly parentId?: string
  /** Delegated-agent tool call id, for Trajectory inspection. */
  readonly callId?: string
}

/** One route: the main line, an interjection hanging off a running node, or a sequel continuing the line. */
export interface FlowLane {
  readonly id: string
  readonly kind: FlowLaneKind
  readonly turn: number
  /** Position of the prompt among loaded prompts, shown as `#n`; gap-free from 1. */
  readonly ordinal: number
  readonly label: string
  readonly status: FlowStatus
  readonly parentLaneId?: string
  /** Node in the parent lane the route hangs from (interjections) or continues after (sequels). */
  readonly anchorNodeId?: string
  /** Lane whose prompt this sequel re-sent verbatim after that lane stopped. */
  readonly retryOfLaneId?: string
  /** Node ids in drawing order: prompt, spine nodes, optional terminal. */
  readonly nodeIds: readonly string[]
  readonly startTime: number
  readonly endTime?: number
}

/** Lane counts by settled state: `done` includes at-risk lanes, `stopped` every terminal state. */
export interface FlowLaneCounts {
  readonly done: number
  readonly running: number
  readonly stopped: number
}

/** Header facts for the collapsed strip. */
export interface FlowSummary {
  readonly lanes: FlowLaneCounts
  readonly running: boolean
  readonly status: FlowStatus | 'idle'
  /** Sum of closed turn spans, excluding idle time between turns. */
  readonly activeMs: number
  /** Lane whose turn is open. */
  readonly currentLaneId?: string
  /** Most recently started running spine node. */
  readonly currentNodeId?: string
  /** Latest interjection other than the current lane. */
  readonly latestBranchLaneId?: string
}

/** Assembled task-flow data consumed by the strip and the canvas. */
export interface FlowSnapshot {
  readonly lanes: readonly FlowLane[]
  readonly nodes: ReadonlyMap<string, FlowNode>
  readonly summary: FlowSummary
}

/** Selector hook over the current Conversation binding's task-flow target. */
export type UseTaskFlow = SnapshotSelectorHook<FlowSnapshot>

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    /** Independently assembled data consumed by the task-flow strip and canvas. */
    'task-flow': FlowSnapshot
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SessionStandardProps {
    /** Selector hook over the current Conversation binding's task-flow target. */
    useTaskFlow: UseTaskFlow
  }
}
