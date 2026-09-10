/** Locale-routed labels shared by every task-flow drawing. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FlowLane, FlowLaneCounts, FlowNode, FlowSnapshot, FlowStatus } from './flow-contract.ts'
import type {} from './locales.ts'

/** Translator bound to the taskFlow namespace. */
export type TaskFlowTranslate = TranslateNS<'taskFlow'>

/** Status keys per drawn state. */
const STATUS_KEYS = {
  pending: 'status.pending',
  running: 'status.running',
  done: 'status.done',
  risk: 'status.risk',
  error: 'status.error',
  aborted: 'status.aborted',
  interrupted: 'status.interrupted',
} as const

/** Abort-cause keys per `AgentCancelCause` and non-completed turn end kinds. */
const ABORT_KEYS: Record<string, 'abort.user' | 'abort.parent' | 'abort.hook' | 'abort.disposed' | 'abort.legacy' | 'abort.max-tokens' | 'abort.blocked'> = {
  'user': 'abort.user',
  'parent': 'abort.parent',
  'hook': 'abort.hook',
  'disposed': 'abort.disposed',
  'legacy': 'abort.legacy',
  'max-tokens': 'abort.max-tokens',
  'blocked': 'abort.blocked',
}

/**
 * Format an elapsed span.
 * @param t - namespace translator.
 * @param ms - elapsed milliseconds; negative values clamp to zero.
 * @returns hours+minutes, minutes+seconds, or seconds copy.
 */
export function formatDuration(t: TaskFlowTranslate, ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return t('duration.hours', { h, m })
  if (m > 0) return t('duration.minutes', { m, s })
  return t('duration.seconds', { s })
}

/**
 * Elapsed span of one node or lane, live while it has no end.
 * @param start - start time, when known.
 * @param end - end time, when known.
 * @param now - current time for open spans.
 * @returns milliseconds, or undefined without a start.
 */
export function spanOf(start: number | undefined, end: number | undefined, now: number): number | undefined {
  if (start === undefined) return undefined
  return (end ?? now) - start
}

/**
 * Status copy for one drawn state.
 * @param t - namespace translator.
 * @param status - drawn state.
 * @returns localized label.
 */
export function statusLabel(t: TaskFlowTranslate, status: FlowStatus): string {
  return t(STATUS_KEYS[status])
}

/**
 * Terminal-node copy: the status plus the recorded cause when one is known.
 * @param t - namespace translator.
 * @param node - terminal node.
 * @returns localized label such as “Stopped (stopped manually)”.
 */
export function terminalLabel(t: TaskFlowTranslate, node: FlowNode): string {
  const status = statusLabel(t, node.status)
  if (node.failureCode === 'AUTH') return `${status} · ${t('failure.auth')}`
  if (node.detail === undefined) return status
  const key = ABORT_KEYS[node.detail]
  return key === undefined ? `${status} · ${node.detail}` : `${status}（${t(key)}）`
}

/**
 * Display title of one node; `steps` and `terminal` nodes carry locale-owned copy.
 * @param t - namespace translator.
 * @param node - drawn node.
 * @returns localized or verbatim title.
 */
export function nodeTitle(t: TaskFlowTranslate, node: FlowNode): string {
  switch (node.kind) {
    case 'prompt': return node.title === '' ? t('node.prompt') : node.title
    case 'steps': return t('node.steps')
    case 'terminal': return terminalLabel(t, node)
    case 'todo':
    case 'agent':
      return node.title
  }
}

/**
 * Secondary line of one node.
 * @param t - namespace translator.
 * @param node - drawn node.
 * @returns localized detail, or undefined when the node has none.
 */
export function nodeDetail(t: TaskFlowTranslate, node: FlowNode): string | undefined {
  if (node.kind === 'steps') return t('node.stepCount', { count: node.stepCount ?? 0 })
  if (node.kind === 'terminal') return undefined
  return node.detail
}

/**
 * Lane kind copy: main line, interjection, sequel, or a retry naming the lane it re-sent.
 * @param t - namespace translator.
 * @param lane - drawn lane.
 * @param lanes - lane table, resolving the retried lane's ordinal.
 * @returns for example “Interjection” or “Retry of #3”.
 */
export function laneKind(t: TaskFlowTranslate, lane: FlowLane, lanes: readonly FlowLane[]): string {
  const retried = lane.retryOfLaneId === undefined ? undefined : lanes.find(entry => entry.id === lane.retryOfLaneId)
  if (retried !== undefined) return t('lane.retryOf', { ordinal: t('lane.ordinal', { ordinal: retried.ordinal }) })
  switch (lane.kind) {
    case 'main': return t('lane.main')
    case 'interjection': return t('lane.interjection')
    case 'sequel': return t('lane.sequel')
  }
}

/**
 * Lane kind copy with its ordinal.
 * @param t - namespace translator.
 * @param lane - drawn lane.
 * @param lanes - lane table, resolving the retried lane's ordinal.
 * @returns for example “#2 Interjection”.
 */
export function laneKindLabel(t: TaskFlowTranslate, lane: FlowLane, lanes: readonly FlowLane[]): string {
  return `${t('lane.ordinal', { ordinal: lane.ordinal })} ${laneKind(t, lane, lanes)}`
}

/**
 * Where an interjection hangs.
 * @param t - namespace translator.
 * @param lane - drawn lane.
 * @param nodes - node table.
 * @returns localized anchor copy, or undefined for main and sequel lanes or an unknown anchor.
 */
export function laneAnchorLabel(t: TaskFlowTranslate, lane: FlowLane, nodes: ReadonlyMap<string, FlowNode>): string | undefined {
  if (lane.kind !== 'interjection' || lane.anchorNodeId === undefined) return undefined
  const anchor = nodes.get(lane.anchorNodeId)
  if (anchor === undefined) return undefined
  return t('lane.anchor', { node: nodeTitle(t, anchor) })
}

/**
 * Spine progress of one lane: done over every spine and agent node.
 * @param lane - drawn lane.
 * @param nodes - node table.
 * @returns counts, with `total` 0 for a lane holding only its prompt.
 */
export function laneProgress(lane: FlowLane, nodes: ReadonlyMap<string, FlowNode>): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const id of lane.nodeIds) {
    const node = nodes.get(id)
    if (node === undefined || node.kind === 'prompt' || node.kind === 'terminal') continue
    total += 1
    if (node.status === 'done' || node.status === 'risk') done += 1
  }
  return { done, total }
}

/** Longest lane label kept in a header fact, in code units. */
const HEADER_LABEL_LIMIT = 24

function clipLabel(text: string): string {
  return text.length > HEADER_LABEL_LIMIT ? `${text.slice(0, HEADER_LABEL_LIMIT - 1)}…` : text
}

/**
 * Header copy naming the lane whose turn is open: its ordinal, clipped prompt,
 * and the running spine node with its step count or the lane's spine progress.
 * @param t - namespace translator.
 * @param snapshot - assembled task flow.
 * @returns localized copy, or undefined while no turn is open.
 */
export function currentFact(t: TaskFlowTranslate, snapshot: FlowSnapshot): string | undefined {
  const { summary } = snapshot
  const lane = summary.currentLaneId === undefined ? undefined : snapshot.lanes.find(entry => entry.id === summary.currentLaneId)
  if (lane === undefined) return undefined
  const parts = [`${t('lane.ordinal', { ordinal: lane.ordinal })} ${clipLabel(lane.label === '' ? t('node.prompt') : lane.label)}`]
  const node = summary.currentNodeId === undefined ? undefined : snapshot.nodes.get(summary.currentNodeId)
  if (node !== undefined && node.laneId === lane.id) {
    const progress = laneProgress(lane, snapshot.nodes)
    const detail = node.kind === 'steps' ? nodeDetail(t, node) : progress.total > 1 ? t('progress', progress) : undefined
    parts.push(detail === undefined ? clipLabel(nodeTitle(t, node)) : `${clipLabel(nodeTitle(t, node))} ${detail}`)
  }
  return t('current', { lane: parts.join(' · ') })
}

/**
 * Header elapsed copy: the open turn's span while one runs, otherwise the sum of closed turn spans.
 * @param t - namespace translator.
 * @param snapshot - assembled task flow.
 * @param now - current time for the open span.
 * @returns localized copy, or undefined before any lane exists.
 */
export function elapsedFact(t: TaskFlowTranslate, snapshot: FlowSnapshot, now: number): string | undefined {
  const { summary } = snapshot
  const lane = summary.currentLaneId === undefined ? undefined : snapshot.lanes.find(entry => entry.id === summary.currentLaneId)
  if (lane !== undefined) return t('elapsed.turn', { time: formatDuration(t, (lane.endTime ?? now) - lane.startTime) })
  if (snapshot.lanes.length === 0) return undefined
  return t('elapsed', { time: formatDuration(t, summary.activeMs) })
}

/**
 * Header lane counts: non-zero done, running, and stopped lane counts joined with a middle dot.
 * @param t - namespace translator.
 * @param counts - lane counts.
 * @returns localized copy; `count.done` with 0 when every count is zero.
 */
export function countsFact(t: TaskFlowTranslate, counts: FlowLaneCounts): string {
  const parts: string[] = []
  if (counts.running > 0) parts.push(t('count.running', { count: counts.running }))
  if (counts.done > 0) parts.push(t('count.done', { count: counts.done }))
  if (counts.stopped > 0) parts.push(t('count.stopped', { count: counts.stopped }))
  return parts.length === 0 ? t('count.done', { count: 0 }) : parts.join(' · ')
}
