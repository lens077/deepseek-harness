/**
 * Pure assembly of the task-flow snapshot from target Nodes and the Turn
 * timeline. Every fact comes from durable events: prompts open lanes, inbox
 * admissions classify a lane as an interjection or a fork, todo snapshots
 * form the spine, delegated agents fan out from the todo they served, and
 * `turn/end` reasons decide terminal states.
 */
import type {
  ConversationTimelineSnapshot, TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session/types'
import type {
  FlowAgentContribution, FlowConversationViewNode, FlowInboxContribution, FlowLane, FlowLaneKind, FlowNode,
  FlowPromptContribution, FlowSnapshot, FlowStatus, FlowSummary, FlowTodoContribution,
} from './flow-contract.ts'

/** Stable empty snapshot used before a Session has assembled task-flow Nodes. */
export const EMPTY_FLOW_SNAPSHOT: FlowSnapshot = {
  lanes: [],
  nodes: new Map(),
  summary: { total: 0, done: 0, running: false, status: 'idle' },
}

interface TurnOutcome {
  readonly status: 'open' | 'closed' | 'unknown'
  readonly end: SessionEvent<'turn/end'> | undefined
  readonly reason: TurnEndReason | undefined
  readonly startTime: number | undefined
  readonly endTime: number | undefined
  readonly stepCount: number
}

/** A prompt's turn is always in the timeline: its Location resolved through the same index. */
function outcomeOf(turn: TurnLocation): TurnOutcome {
  return {
    status: turn.status,
    end: turn.end,
    reason: turn.end?.data.reason,
    startTime: turn.start?.time,
    endTime: turn.end?.time,
    stepCount: turn.steps.length,
  }
}

/** Terminal status of a closed turn, or null when it completed normally. */
function terminalStatus(reason: TurnEndReason | undefined): FlowStatus | null {
  if (reason === undefined) return null
  return terminalStatusOf(reason)
}

function terminalStatusOf(reason: TurnEndReason): FlowStatus | null {
  switch (reason.kind) {
    case 'completed': return null
    case 'aborted': return 'aborted'
    case 'blocked': return 'error'
    case 'error': return 'error'
    case 'max-tokens': return 'error'
    case 'interrupted': return 'interrupted'
    default: return null
  }
}

function abortDetail(reason: TurnEndReason): string | undefined {
  if (reason.kind === 'aborted') return reason.reason.kind
  if (reason.kind === 'error') return reason.error.message
  if (reason.kind === 'max-tokens') return 'max-tokens'
  if (reason.kind === 'blocked') return 'blocked'
  return undefined
}

/** Status of work that was still running when its turn ended. */
function unfinishedStatus(outcome: TurnOutcome): FlowStatus {
  if (outcome.status === 'open') return 'running'
  return terminalStatus(outcome.reason) ?? 'pending'
}

function sortBySeq<T extends { readonly seq: number }>(values: T[]): T[] {
  return values.sort((left, right) => left.seq - right.seq)
}

interface TodoTiming {
  startTime?: number
  endTime?: number
}

/** First in_progress and completed sightings of one todo content across one turn's writes. */
function todoTiming(writes: readonly FlowTodoContribution[], content: string): TodoTiming {
  const timing: TodoTiming = {}
  for (const write of writes) {
    for (const todo of write.todos) {
      if (todo.content !== content) continue
      if (todo.status === 'in_progress' && timing.startTime === undefined) timing.startTime = write.time
      if (todo.status === 'completed') {
        timing.startTime ??= write.time
        timing.endTime ??= write.time
      }
    }
  }
  return timing
}

/** Index of the first in_progress item of the latest todo write before `seq`, matched into the final list. */
function servedTodoIndex(
  writes: readonly FlowTodoContribution[],
  latest: FlowTodoContribution,
  seq: number,
): number | undefined {
  let write: FlowTodoContribution | undefined
  for (const candidate of writes) {
    if (candidate.seq > seq) break
    write = candidate
  }
  const active = write?.todos.find(todo => todo.status === 'in_progress')
  if (active === undefined) return undefined
  const index = latest.todos.findIndex(todo => todo.content === active.content)
  return index < 0 ? undefined : index
}

interface LaneDraft {
  readonly lane: Omit<FlowLane, 'nodeIds' | 'status' | 'endTime'>
  /** The lane's opening prompt node, always its first node. */
  readonly prompt: FlowNode
  readonly nodes: FlowNode[]
  readonly outcome: TurnOutcome
}

/**
 * Assemble the task-flow snapshot.
 * @param nodes - every current target Node, in any order.
 * @param timeline - engine-owned Turn timeline.
 * @returns lanes, nodes, and the strip summary.
 */
export function buildFlowSnapshot(
  nodes: Iterable<FlowConversationViewNode>,
  timeline: ConversationTimelineSnapshot,
): FlowSnapshot {
  const prompts: (FlowPromptContribution & { readonly turn: number })[] = []
  const admissions = new Map<string, FlowInboxContribution>()
  const todosByTurn = new Map<number, FlowTodoContribution[]>()
  const agentsByTurn = new Map<number, FlowAgentContribution[]>()
  for (const node of nodes) {
    const data = node.data
    switch (data.kind) {
      case 'prompt':
        if (data.turn !== null) prompts.push({ ...data, turn: data.turn })
        break
      case 'inbox':
        for (const id of data.messageIds) admissions.set(id, data)
        break
      case 'todo':
        if (data.turn !== null) {
          const list = todosByTurn.get(data.turn) ?? []
          list.push(data)
          todosByTurn.set(data.turn, list)
        }
        break
      case 'agent': {
        const list = agentsByTurn.get(data.turn) ?? []
        list.push(data)
        agentsByTurn.set(data.turn, list)
        break
      }
    }
  }
  sortBySeq(prompts)
  for (const list of todosByTurn.values()) sortBySeq(list)
  for (const list of agentsByTurn.values()) sortBySeq(list)

  const drafts: LaneDraft[] = []
  const laneByTurn = new Map<number, LaneDraft>()
  const allNodes = new Map<string, FlowNode>()
  let mainLane: LaneDraft | undefined

  const place = (draft: LaneDraft, node: FlowNode): void => {
    draft.nodes.push(node)
    allNodes.set(node.id, node)
  }

  /** The spine node of `draft` open at `time`, else the latest one started before it, else its prompt. */
  const runningNodeAt = (draft: LaneDraft, time: number): FlowNode => {
    const openAt = (node: FlowNode): boolean => node.endTime === undefined || node.endTime >= time
    let found = draft.prompt
    let foundStart = Number.NEGATIVE_INFINITY
    for (const node of draft.nodes) {
      if (node.kind === 'agent' || node.kind === 'terminal' || node.startTime === undefined || node.startTime > time) continue
      const open = openAt(node)
      const foundOpen = openAt(found)
      if ((open && !foundOpen) || (open === foundOpen && node.startTime >= foundStart)) {
        found = node
        foundStart = node.startTime
      }
    }
    return found
  }

  for (const prompt of prompts) {
    const turn = prompt.turn
    const location = timeline.turns.get(turn)
    /* v8 ignore start -- a prompt's turn resolved through the same timeline index that assembled this snapshot */
    if (location === undefined) continue
    /* v8 ignore stop */
    const outcome = outcomeOf(location)
    const ordinal = timeline.turnOrder.indexOf(turn) + 1
    const existing = laneByTurn.get(turn)
    const admission = admissions.get(prompt.messageId)
    const promptNode: FlowNode = {
      id: `prompt:${prompt.messageId}`,
      laneId: '',
      kind: 'prompt',
      title: prompt.text,
      status: 'done',
      startTime: prompt.time,
      anchorSeq: prompt.seq,
      turn,
    }
    if (existing !== undefined) {
      // A second user message inside an open turn is a steer: one branch node hanging off the running spine node.
      const anchor = runningNodeAt(existing, prompt.time)
      const laneId = `steer:${prompt.messageId}`
      const steerPrompt: FlowNode = {
        ...promptNode,
        laneId,
        status: outcome.status === 'open' ? 'running' : terminalStatus(outcome.reason) ?? 'done',
      }
      const draft: LaneDraft = {
        lane: {
          id: laneId,
          kind: 'interjection',
          turn,
          ordinal,
          label: prompt.text,
          parentLaneId: existing.lane.id,
          anchorNodeId: anchor.id,
          startTime: prompt.time,
        },
        prompt: steerPrompt,
        nodes: [],
        outcome,
      }
      place(draft, steerPrompt)
      drafts.push(draft)
      continue
    }

    let kind: FlowLaneKind = 'fork'
    let parent: LaneDraft | undefined
    let anchor: FlowNode | undefined
    if (mainLane === undefined) {
      kind = 'main'
    } else if (admission?.duringTurn !== null && admission?.duringTurn !== undefined) {
      const during = laneByTurn.get(admission.duringTurn)
      if (during !== undefined) {
        kind = 'interjection'
        parent = during
        anchor = runningNodeAt(during, admission.time)
      } else {
        parent = mainLane
        anchor = mainLane.prompt
      }
    } else {
      parent = mainLane
      anchor = mainLane.prompt
    }
    const laneId = `turn:${turn}`
    const lanePrompt: FlowNode = { ...promptNode, laneId }
    const draft: LaneDraft = {
      lane: {
        id: laneId,
        kind,
        turn,
        ordinal,
        label: prompt.text,
        ...parent === undefined ? {} : { parentLaneId: parent.lane.id },
        ...anchor === undefined ? {} : { anchorNodeId: anchor.id },
        startTime: outcome.startTime ?? prompt.time,
      },
      prompt: lanePrompt,
      nodes: [],
      outcome,
    }
    place(draft, lanePrompt)
    laneByTurn.set(turn, draft)
    drafts.push(draft)
    mainLane ??= draft

    const writes = todosByTurn.get(turn) ?? []
    const latest = writes.at(-1)
    const agents = agentsByTurn.get(turn) ?? []
    if (latest !== undefined) {
      for (const [index, todo] of latest.todos.entries()) {
        const timing = todoTiming(writes, todo.content)
        const status: FlowStatus = todo.status === 'completed'
          ? 'done'
          : todo.status === 'in_progress' ? unfinishedStatus(outcome) : 'pending'
        place(draft, {
          id: `todo:${turn}:${index}`,
          laneId,
          kind: 'todo',
          title: todo.content,
          status,
          ...timing.startTime === undefined ? {} : { startTime: timing.startTime },
          ...status === 'done' && timing.endTime !== undefined ? { endTime: timing.endTime } : {},
          anchorSeq: latest.seq,
          turn,
        })
      }
    }
    for (const agent of agents) {
      const served = latest === undefined ? undefined : servedTodoIndex(writes, latest, agent.seq)
      const status: FlowStatus = agent.isError === true
        ? 'error'
        : agent.endTime === undefined ? unfinishedStatus(outcome) : 'done'
      place(draft, {
        id: `agent:${agent.callId}`,
        laneId,
        kind: 'agent',
        title: agent.label,
        detail: agent.toolName,
        status,
        startTime: agent.startTime,
        ...agent.endTime === undefined ? {} : { endTime: agent.endTime },
        anchorSeq: agent.seq,
        turn,
        ...served === undefined ? {} : { parentId: `todo:${turn}:${served}` },
        callId: agent.callId,
      })
    }
    if (latest === undefined && agents.length === 0) {
      place(draft, {
        id: `steps:${turn}`,
        laneId,
        kind: 'steps',
        title: '',
        status: outcome.status === 'closed' ? terminalStatus(outcome.reason) ?? 'done' : 'running',
        stepCount: outcome.stepCount,
        ...outcome.startTime === undefined ? {} : { startTime: outcome.startTime },
        ...outcome.endTime === undefined ? {} : { endTime: outcome.endTime },
        anchorSeq: prompt.seq,
        turn,
      })
    }
    const end = outcome.end
    const terminal = end === undefined ? null : terminalStatusOf(end.data.reason)
    if (end !== undefined && terminal !== null) {
      const detail = abortDetail(end.data.reason)
      place(draft, {
        id: `end:${turn}`,
        laneId,
        kind: 'terminal',
        title: '',
        ...detail === undefined ? {} : { detail },
        status: terminal,
        startTime: end.time,
        endTime: end.time,
        anchorSeq: end.seq,
        turn,
      })
    }
  }

  // Todo nodes carrying failed agents draw as at-risk spine nodes.
  for (const node of allNodes.values()) {
    if (node.kind !== 'agent' || node.status !== 'error' || node.parentId === undefined) continue
    const parent = allNodes.get(node.parentId)
    if (parent !== undefined && parent.status === 'done') allNodes.set(parent.id, { ...parent, status: 'risk' })
  }

  const lanes: FlowLane[] = drafts.map((draft) => {
    const terminal = terminalStatus(draft.outcome.reason)
    const status: FlowStatus = draft.outcome.status === 'open'
      ? 'running'
      : terminal ?? (draft.nodes.some(node => allNodes.get(node.id)?.status === 'risk') ? 'risk' : 'done')
    return {
      ...draft.lane,
      status,
      nodeIds: draft.nodes.map(node => node.id),
      ...draft.outcome.endTime === undefined ? {} : { endTime: draft.outcome.endTime },
    }
  })

  return { lanes, nodes: allNodes, summary: summarize(lanes, allNodes) }
}

function summarize(lanes: readonly FlowLane[], nodes: ReadonlyMap<string, FlowNode>): FlowSummary {
  let total = 0
  let done = 0
  let currentNodeId: string | undefined
  let currentSeq = -1
  for (const node of nodes.values()) {
    if (node.kind === 'prompt' || node.kind === 'terminal') continue
    total += 1
    if (node.status === 'done' || node.status === 'risk') done += 1
    if (node.status === 'running' && node.anchorSeq > currentSeq) {
      currentSeq = node.anchorSeq
      currentNodeId = node.id
    }
  }
  const running = lanes.some(lane => lane.status === 'running')
  const last = lanes.at(-1)
  const latestBranch = lanes.findLast(lane => lane.kind !== 'main')
  const startTimes = lanes.map(lane => lane.startTime)
  const endTimes = lanes.flatMap(lane => lane.endTime === undefined ? [] : [lane.endTime])
  return {
    total,
    done,
    running,
    status: last === undefined ? 'idle' : running ? 'running' : last.status,
    ...startTimes.length === 0 ? {} : { startTime: Math.min(...startTimes) },
    ...running || endTimes.length === 0 ? {} : { endTime: Math.max(...endTimes) },
    ...currentNodeId === undefined ? {} : { currentNodeId },
    ...latestBranch === undefined ? {} : { latestBranchLaneId: latestBranch.id },
  }
}
