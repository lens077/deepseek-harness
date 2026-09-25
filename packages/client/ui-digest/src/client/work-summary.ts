/** Bounded card presentation derived from existing whole-session projections and visible jobs. */
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionJob } from '@deepseek-ai/dsh-api-session-controller/types'
import type { UsageLedgerProjection } from '@deepseek-ai/dsh-session-stats/client'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'

/** Agent checklist, cumulative work, and process-local jobs available to one card. */
export interface DigestWork {
  /** Null when the checklist is unavailable, unwritten, or empty. */
  readonly tasks: {
    readonly total: number
    readonly completed: number
    readonly activeCount: number
    /** First two active labels in plan order, capped at 180 code points each. */
    readonly active: readonly string[]
  } | null
  /** Closed cumulative steps, never a current step or task-completion percentage. */
  readonly steps: {
    readonly count: number
    /** True only for the whole-log stats fallback, which includes inherited history. */
    readonly includesInherited: boolean
  } | null
  /** Own-session cumulative calls and results; their difference is not a live tool count. */
  readonly tools: {
    readonly calls: number
    readonly results: number
    readonly errors: number
    /** Up to three names ordered by calls descending, then name ascending. */
    readonly names: readonly { readonly name: string; readonly calls: number }[]
    readonly additionalNames: number
  } | null
  /** Jobs visible to the Session may include unowned work. */
  readonly jobs: {
    /** Running and stopping jobs combined. */
    readonly activeCount: number
    readonly stoppingCount: number
    /** First two active labels in registration order, capped at 180 code points each. */
    readonly labels: readonly string[]
  }
}

/** Keep the ellipsis inside the preview's 180-code-point display budget. */
function preview(text: string): string {
  const points: string[] = []
  for (const point of text) {
    if (points.length === 180) return `${points.slice(0, 179).join('')}…`
    points.push(point)
  }
  return text
}

function tasksOf(todos: readonly TodoItem[] | null | undefined): DigestWork['tasks'] {
  if (todos == null || todos.length === 0) return null
  const active = todos.filter(todo => todo.status === 'in_progress')
  return {
    total: todos.length,
    completed: todos.filter(todo => todo.status === 'completed').length,
    activeCount: active.length,
    active: active.slice(0, 2).map(todo => preview(todo.content)),
  }
}

function toolsOf(ledger: UsageLedgerProjection | undefined): DigestWork['tools'] {
  if (ledger === undefined) return null
  const totals = ledger.tools.reduce((counts, tool) => ({
    calls: counts.calls + tool.calls,
    results: counts.results + tool.results,
    errors: counts.errors + tool.errors,
  }), { calls: 0, results: 0, errors: 0 })
  const names = [...ledger.tools]
    .sort((a, b) => b.calls - a.calls || Number(a.name > b.name) - Number(a.name < b.name))
    .slice(0, 3)
    .map(({ name, calls }) => ({ name, calls }))
  return { ...totals, names, additionalNames: ledger.tools.length - names.length }
}

/**
 * Summarize existing facts without loading history or inferring runtime activity from cumulative counts.
 * @param summary - Session list row carrying optional host-computed projections.
 * @param jobs - process-local jobs visible to this Session, including any unowned jobs.
 * @returns checklist previews, cumulative counts, and bounded active-job labels; absent projections stay unknown.
 */
export function workSummaryOf(summary: SessionSummary, jobs: readonly SessionJob[]): DigestWork {
  const values = summary.projectionValues
  const ledger = values?.usageLedger
  const stats = values?.sessionStats
  const activeJobs = jobs.filter(job => job.status === 'running' || job.status === 'stopping')
  return {
    tasks: tasksOf(values?.todos),
    steps: ledger !== undefined
      ? { count: ledger.activity.steps, includesInherited: false }
      : stats === undefined ? null : { count: stats.steps, includesInherited: true },
    tools: toolsOf(ledger),
    jobs: {
      activeCount: activeJobs.length,
      stoppingCount: activeJobs.filter(job => job.status === 'stopping').length,
      labels: activeJobs.slice(0, 2).map(job => preview(job.label)),
    },
  }
}
