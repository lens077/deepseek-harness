/**
 * Task-flow Event Definitions: four independent state machines that fold user
 * prompts, inbox admissions, todo snapshots, and delegated-agent tool calls into
 * target-owned Nodes. Each Definition keys its Context by a durable id carried
 * on the event, so replay in ascending log seq is deterministic.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationLocation, ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
  ConversationStartMatch,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type {} from '@deepseek-ai/dsh-agent/types'
import type {} from '@deepseek-ai/dsh-tool-todo/client'
import {
  TASK_FLOW_TARGET, type FlowAgentContribution, type FlowContribution, type FlowConversationViewNode,
  type FlowInboxContribution, type FlowPromptContribution, type FlowTodoContribution,
} from './flow-contract.ts'

/** Longest prompt preview kept on a node, in code units. */
const PREVIEW_LIMIT = 80

/** Argument fields read, in order, for a delegated-agent node title. */
const AGENT_NAME_FIELDS = ['description', 'label', 'objective', 'text_prompt', 'prompt'] as const

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

function turnOf(location: ConversationLocation): number | null {
  return location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : null
}

/**
 * Collapse content blocks to one bounded single-line preview.
 * @param content - user message blocks.
 * @returns the joined text blocks, whitespace-normalized and capped.
 */
export function previewText(content: readonly ContentBlock[]): string {
  const text = content
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1)}…` : text
}

/**
 * Pick the delegated-agent title from its raw tool arguments.
 * @param argsRaw - JSON arguments as logged.
 * @param fallback - title when no known field carries text.
 * @returns the first non-empty label field, bounded like a prompt preview.
 */
export function agentLabel(argsRaw: string, fallback: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(argsRaw)
  } catch {
    // Truncated or malformed arguments keep the tool name as the title.
    return fallback
  }
  if (typeof parsed !== 'object' || parsed === null) return fallback
  const record = parsed as Record<string, unknown>
  for (const field of AGENT_NAME_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && value.trim() !== '') {
      return previewText([{ type: 'text', text: value }])
    }
  }
  const meta = record['meta']
  if (typeof meta === 'object' && meta !== null) {
    const name = (meta as Record<string, unknown>)['name']
    if (typeof name === 'string' && name.trim() !== '') return previewText([{ type: 'text', text: name }])
  }
  return fallback
}

function flowNode(
  context: ConversationNodeContext,
  anchorSeq: number,
  data: FlowContribution,
): FlowConversationViewNode {
  return {
    key: context.key,
    kind: context.kind,
    id: context.id,
    target: TASK_FLOW_TARGET,
    anchorSeq,
    location: locationOf(context),
    data,
  }
}

/** User prompts, one Context per message id; steering and queued prompts share the Definition. */
export const promptDefinition: ConversationNodeDefinition<FlowPromptContribution> = {
  kind: 'task-flow-prompt',
  target: TASK_FLOW_TARGET,
  match: event => event.type === 'user/message'
    && isAppendSurfaceEvent(event)
    && event.data.source.kind === 'user'
    ? { id: String(event.data.id), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'user/message') throw new Error('task-flow-prompt start requires user/message')
    return {
      kind: 'prompt',
      messageId: String(match.event.data.id),
      seq: match.event.seq,
      time: match.event.time,
      turn: turnOf(match.location),
      text: previewText(match.event.data.content),
    }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : flowNode(context, context.state.seq, { ...context.state, turn: turnOf(locationOf(context)) }),
}

/** Inbox admissions, one Context per splice; records which turn was open at admission. */
export const inboxDefinition: ConversationNodeDefinition<FlowInboxContribution> = {
  kind: 'task-flow-inbox',
  target: TASK_FLOW_TARGET,
  match: event => event.type === 'agent/inbox/spliced' && event.data.inserted.length > 0
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'agent/inbox/spliced') throw new Error('task-flow-inbox start requires agent/inbox/spliced')
    return {
      kind: 'inbox',
      seq: match.event.seq,
      time: match.event.time,
      messageIds: match.event.data.inserted.map(message => String(message.id)),
      duringTurn: turnOf(match.location),
    }
  },
  update: context => context.state,
  publication: () => 'none',
  buildViewNode: context => context.state === undefined
    ? null
    : flowNode(context, context.state.seq, { ...context.state, duringTurn: turnOf(locationOf(context)) }),
}

/** Whole-list todo snapshots, one Context per write. */
export const todoDefinition: ConversationNodeDefinition<FlowTodoContribution> = {
  kind: 'task-flow-todo',
  target: TASK_FLOW_TARGET,
  match: event => event.type === 'todo/write' ? { id: String(event.seq), role: 'start' } : null,
  start: (_context, match) => {
    if (match.event.type !== 'todo/write') throw new Error('task-flow-todo start requires todo/write')
    return {
      kind: 'todo',
      seq: match.event.seq,
      time: match.event.time,
      turn: turnOf(match.location),
      todos: match.event.data.todos,
    }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : flowNode(context, context.state.seq, { ...context.state, turn: turnOf(locationOf(context)) }),
}

function settleAgent(state: FlowAgentContribution, match: ConversationMatch): FlowAgentContribution {
  if (match.event.type !== 'tool/result') return state
  const data = match.event.data
  const isError = data.error !== undefined || data.message.content[0].isError === true
  return { ...state, endTime: match.event.time, ...isError ? { isError: true } : {} }
}

/**
 * Build the delegated-agent Definition for the configured tool names: one
 * Context per call id, settled by its result.
 * @param toolNames - tool names whose calls draw as agent nodes.
 * @returns the Definition.
 */
export function createAgentDefinition(toolNames: readonly string[]): ConversationNodeDefinition<FlowAgentContribution> {
  const names = new Set(toolNames)
  return {
    kind: 'task-flow-agent',
    target: TASK_FLOW_TARGET,
    match: (event) => {
      if (event.type === 'tool/call') {
        return names.has(event.data.name) ? { id: String(event.data.callId), role: 'start' } : null
      }
      if (event.type === 'tool/result') {
        return { id: String(event.data.message.source.callId), role: 'update' }
      }
      return null
    },
    start: (_context, match: ConversationStartMatch) => {
      if (match.event.type !== 'tool/call') throw new Error('task-flow-agent start requires tool/call')
      const data = match.event.data
      return {
        kind: 'agent',
        callId: String(data.callId),
        toolName: data.name,
        label: agentLabel(data.arguments, data.name),
        seq: match.event.seq,
        turn: data.turn,
        step: data.step,
        startTime: match.event.time,
      }
    },
    update: (context, match) => settleAgent(context.state, match),
    buildViewNode: context => context.state === undefined ? null : flowNode(context, context.state.seq, context.state),
  }
}

/**
 * Register every task-flow Definition.
 * @param ctx - owning Client context.
 * @param agentToolNames - tool names whose calls draw as agent nodes.
 */
export function registerFlowDefinitions(ctx: Context, agentToolNames: readonly string[]): void {
  ctx.uiConversation.events.register(promptDefinition)
  ctx.uiConversation.events.register(inboxDefinition)
  ctx.uiConversation.events.register(todoDefinition)
  ctx.uiConversation.events.register(createAgentDefinition(agentToolNames))
}
