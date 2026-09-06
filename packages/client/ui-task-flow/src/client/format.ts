/** Locale-routed labels shared by every task-flow drawing. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FlowLane, FlowNode, FlowStatus } from './flow-contract.ts'
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
 * Lane kind copy with its ordinal.
 * @param t - namespace translator.
 * @param lane - drawn lane.
 * @returns for example “#2 Interjection”.
 */
export function laneKindLabel(t: TaskFlowTranslate, lane: FlowLane): string {
  const kind = lane.kind === 'main' ? t('lane.main') : lane.kind === 'interjection' ? t('lane.interjection') : t('lane.fork')
  return `${t('lane.ordinal', { ordinal: lane.ordinal })} ${kind}`
}

/**
 * Where a branch lane hangs.
 * @param t - namespace translator.
 * @param lane - branch lane.
 * @param nodes - node table.
 * @returns localized anchor copy, or undefined for the main line or an unknown anchor.
 */
export function laneAnchorLabel(t: TaskFlowTranslate, lane: FlowLane, nodes: ReadonlyMap<string, FlowNode>): string | undefined {
  if (lane.anchorNodeId === undefined) return undefined
  const anchor = nodes.get(lane.anchorNodeId)
  if (anchor === undefined) return undefined
  const node = nodeTitle(t, anchor)
  return lane.kind === 'fork' ? t('lane.forkFrom', { node }) : t('lane.anchor', { node })
}

/**
 * Whether a status is a settled terminal outcome (draws with a terminal glyph).
 * @param status - drawn state.
 * @returns true for aborted, error, and interrupted.
 */
export function isTerminal(status: FlowStatus): boolean {
  return status === 'aborted' || status === 'error' || status === 'interrupted'
}
