/** Bounded running-card facts derived from existing Session list projections. */
import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionJob } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionStatsProjection, UsageLedgerProjection } from '@deepseek-ai/dsh-session-stats/client'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import { workSummaryOf } from '../src/client/work-summary.ts'

function summary(projectionValues?: SessionSummary['projectionValues']): SessionSummary {
  return {
    id: 'work-summary' as SessionSummary['id'],
    displayTitle: 'Work summary',
    running: true,
    blank: false,
    updatedAt: 1,
    ...(projectionValues === undefined ? {} : { projectionValues }),
  }
}

function ledger(overrides: Partial<UsageLedgerProjection> = {}): UsageLedgerProjection {
  return {
    models: [],
    tools: [],
    activity: {
      turns: 0, steps: 0, turnMs: 0, llmMs: 0, ttftMs: 0, ttftRequests: 0,
      decodeMs: 0, decodeTokens: 0, retries: 0, retryDelayMs: 0, turnErrors: 0, interruptions: 0,
    },
    cacheBreaks: { total: 0, systemChanged: 0, toolsChanged: 0, routeChanged: 0 },
    unreportedAttempts: 0,
    ...overrides,
  }
}

function stats(steps: number): SessionStatsProjection {
  return { turns: 1, steps, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 }
}

function job(label: string, status: SessionJob['status']): SessionJob {
  return { id: label as SessionJob['id'], kind: 'bash', label, status, startedAt: 1 }
}

describe('workSummaryOf', () => {
  it.each([undefined, {}])('keeps absent projections unknown rather than inventing zero progress (%j)', (values) => {
    expect(workSummaryOf(summary(values), [])).toEqual({
      tasks: null,
      steps: null,
      tools: null,
      jobs: { activeCount: 0, stoppingCount: 0, labels: [] },
    })
  })

  it.each([{ todos: null }, { todos: [] }] satisfies { todos: TodoItem[] | null }[])(
    'omits an unwritten or empty checklist (%j)', ({ todos }) => {
      expect(workSummaryOf(summary({ todos }), []).tasks).toBeNull()
    },
  )

  it('counts every parallel task while sampling two active labels in plan order', () => {
    const todos: TodoItem[] = [
      { content: 'Inspect the source', status: 'completed' },
      { content: 'Implement the helper', status: 'in_progress' },
      { content: 'Watch the background build', status: 'in_progress' },
      { content: 'Review the API', status: 'in_progress' },
      { content: 'Verify in the browser', status: 'pending' },
    ]
    expect(workSummaryOf(summary({ todos }), []).tasks).toEqual({
      total: 5, completed: 1, activeCount: 3,
      active: ['Implement the helper', 'Watch the background build'],
    })
  })

  it('retains checklist counts when no task is active without inferring completion', () => {
    expect(workSummaryOf(summary({ todos: [
      { content: 'Done', status: 'completed' },
      { content: 'Next', status: 'pending' },
    ] }), []).tasks).toEqual({ total: 2, completed: 1, activeCount: 0, active: [] })
  })

  it('keeps an exact-length task and clips longer Unicode labels including the ellipsis in the budget', () => {
    const exact = 'x'.repeat(180)
    expect(workSummaryOf(summary({ todos: [
      { content: exact, status: 'in_progress' },
      { content: '🧪'.repeat(181), status: 'in_progress' },
    ] }), []).tasks?.active).toEqual([exact, `${'🧪'.repeat(179)}…`])
  })

  it.each([0, 7])('prefers own-session ledger steps over inherited whole-log totals (%i)', (steps) => {
    const usageLedger = ledger()
    usageLedger.activity.steps = steps
    expect(workSummaryOf(summary({ usageLedger, sessionStats: stats(90) }), []).steps)
      .toEqual({ count: steps, includesInherited: false })
  })

  it.each([0, 12])('marks the stats-only fallback as including inherited history (%i)', (steps) => {
    expect(workSummaryOf(summary({ sessionStats: stats(steps) }), []).steps)
      .toEqual({ count: steps, includesInherited: true })
  })

  it('reports a present empty ledger as known zero tool usage', () => {
    expect(workSummaryOf(summary({ usageLedger: ledger() }), []).tools).toEqual({
      calls: 0, results: 0, errors: 0, names: [], additionalNames: 0,
    })
  })

  it('totals every tool and samples the three most called names with deterministic ties', () => {
    const usageLedger = ledger({ tools: [
      { name: 'read', calls: 5, results: 4, errors: 0, toolMs: 20 },
      { name: 'write', calls: 2, results: 0, errors: 0, toolMs: 0 },
      { name: 'edit', calls: 5, results: 2, errors: 1, toolMs: 10 },
      { name: 'grep', calls: 3, results: 2, errors: 0, toolMs: 5 },
      { name: 'bash', calls: 5, results: 5, errors: 1, toolMs: 50 },
    ] })
    const before = structuredClone(usageLedger)
    expect(workSummaryOf(summary({ usageLedger }), []).tools).toEqual({
      calls: 20, results: 13, errors: 2,
      names: [{ name: 'bash', calls: 5 }, { name: 'edit', calls: 5 }, { name: 'read', calls: 5 }],
      additionalNames: 2,
    })
    expect(usageLedger).toEqual(before)
  })

  it('does not label unmatched cumulative calls as currently active tools', () => {
    const usageLedger = ledger({ tools: [{ name: 'read', calls: 4, results: 1, errors: 1, toolMs: 1 }] })
    expect(workSummaryOf(summary({ usageLedger }), []).tools).toEqual({
      calls: 4, results: 1, errors: 1,
      names: [{ name: 'read', calls: 4 }], additionalNames: 0,
    })
  })

  it('counts running and stopping visible jobs, excludes settled ones, and bounds labels', () => {
    const jobs = [
      job('Already done', 'completed'),
      job('Build', 'running'),
      job('Stopping test', 'stopping'),
      job('Failed check', 'failed'),
      job('Review', 'running'),
      job('Killed process', 'killed'),
    ]
    const before = structuredClone(jobs)
    expect(workSummaryOf(summary(), jobs).jobs).toEqual({
      activeCount: 3, stoppingCount: 1, labels: ['Build', 'Stopping test'],
    })
    expect(jobs).toEqual(before)
  })

  it('returns no active jobs when every visible job settled', () => {
    expect(workSummaryOf(summary(), [job('Done', 'completed'), job('Failed', 'failed'), job('Killed', 'killed')]).jobs)
      .toEqual({ activeCount: 0, stoppingCount: 0, labels: [] })
  })

  it('clips long job labels without splitting Unicode code points', () => {
    const labels = workSummaryOf(summary(), [
      job('🛠'.repeat(180), 'running'), job('y'.repeat(181), 'stopping'),
    ]).jobs.labels
    expect(labels).toEqual(['🛠'.repeat(180), `${'y'.repeat(179)}…`])
    expect(labels.map(label => Array.from(label).length)).toEqual([180, 180])
  })
})
