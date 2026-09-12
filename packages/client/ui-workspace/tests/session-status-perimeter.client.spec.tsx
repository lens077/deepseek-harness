// @vitest-environment jsdom
/**
 * The decorative status perimeter on session, search, and archived rows: which
 * state it reports, when it animates, when the preference removes it, and that
 * status dots and labels stay in every mode.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ArchivedSessionItem, SearchResultItem, SessionNodeItem } from '../src/client/rows/Rows.tsx'
import type { SessionStatusIndicatorMode } from '../src/client/stores.ts'
import type { SearchResultNode, SessionNode } from '../src/client/tree.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as never
const sid = (id: string) => id as SessionId

function node(overrides: Partial<SessionNode> = {}): SessionNode {
  return {
    id: sid('row'), title: 'Row', blank: false, running: false, runningSubagentCount: 0,
    completed: false, failed: false, hasActiveSchedule: false, updatedAt: 0, ...overrides,
  }
}

function renderRow(overrides: Partial<SessionNode>, mode?: SessionStatusIndicatorMode) {
  return render(
    <SessionNodeItem
      node={node(overrides)} currentId={undefined} now={0} onOpen={vi.fn()}
      onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()}
      {...mode === undefined ? {} : { statusIndicatorMode: mode }}
      t={t}
    />,
  )
}

const perimeter = (container: HTMLElement, state?: string) => container.querySelector(
  state === undefined ? '[data-session-status-perimeter]' : `[data-session-status-perimeter="${state}"]`,
)

describe('session status perimeter', () => {
  it('animates an own run by default, keeps it static under the static preference, and omits it when hidden', () => {
    const animated = renderRow({ running: true })
    const overlay = perimeter(animated.container, 'running')
    expect(overlay?.getAttribute('data-motion')).toBe('animated')
    expect(overlay?.getAttribute('aria-hidden')).toBe('true')
    animated.unmount()

    const still = renderRow({ running: true }, 'static')
    expect(perimeter(still.container, 'running')?.getAttribute('data-motion')).toBe('static')
    still.unmount()

    const hidden = renderRow({ running: true }, 'hidden')
    expect(perimeter(hidden.container)).toBeNull()
    // The dot and its accessible label are not part of the preference.
    expect(hidden.container.querySelector('[data-state="ongoing"]')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
  })

  it('draws completion and error statically in every mode, with error outranking completion', () => {
    const done = renderRow({ completed: true })
    expect(perimeter(done.container, 'completed')?.getAttribute('data-motion')).toBe('static')
    done.unmount()

    const failed = renderRow({ failed: true, completed: true })
    expect(perimeter(failed.container, 'error')?.getAttribute('data-motion')).toBe('static')
    expect(perimeter(failed.container, 'completed')).toBeNull()
    expect(failed.container.querySelector('[data-state="error"]')).toBeTruthy()
    expect(screen.getByText('运行出错')).toBeTruthy()
  })

  it('lets an own run outrank a stale error, and draws nothing for pending or descendant-only activity', () => {
    const rerun = renderRow({ running: true, failed: true })
    expect(perimeter(rerun.container, 'running')).toBeTruthy()
    expect(perimeter(rerun.container, 'error')).toBeNull()
    rerun.unmount()

    const pending = renderRow({ running: true, pendingInteraction: 'approval' })
    expect(perimeter(pending.container)).toBeNull()
    expect(pending.container.querySelector('[data-state="warning"]')).toBeTruthy()
    pending.unmount()

    const delegated = renderRow({ runningSubagentCount: 2 })
    expect(perimeter(delegated.container)).toBeNull()
    expect(delegated.container.querySelector('[data-state="ongoing"]')).toBeTruthy()
  })

  it('applies the same policy to search results and archived rows', () => {
    const result: SearchResultNode = {
      id: sid('result'), title: 'Result', workspace: 'Project', running: true,
      runningSubagentCount: 0, completed: false, failed: false, hasActiveSchedule: false,
    }
    const search = render(<SearchResultItem result={result} currentId={undefined} onOpen={vi.fn()} t={t} />)
    expect(perimeter(search.container, 'running')?.getAttribute('data-motion')).toBe('animated')
    search.unmount()

    const searchHidden = render(
      <SearchResultItem result={result} currentId={undefined} onOpen={vi.fn()} statusIndicatorMode="hidden" t={t} />,
    )
    expect(perimeter(searchHidden.container)).toBeNull()
    searchHidden.unmount()

    const archived = render(
      <ArchivedSessionItem
        node={{ session: node({ failed: true }), workspace: 'Project' }}
        now={0} busy={false} onUnarchive={vi.fn()} onDelete={vi.fn()} statusIndicatorMode="static" t={t}
      />,
    )
    expect(perimeter(archived.container, 'error')?.getAttribute('data-motion')).toBe('static')
  })
})
