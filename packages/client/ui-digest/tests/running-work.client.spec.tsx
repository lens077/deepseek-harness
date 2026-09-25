// @vitest-environment jsdom
/** Running-card content distinguishes active tasks from session-cumulative work. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { InboxCard } from '../src/client/InboxCard.tsx'
import { selectInbox } from '../src/client/select.ts'
import { workSummaryOf } from '../src/client/work-summary.ts'
import { NOW, digest, inbox, row, t } from './fixtures.client.ts'

afterEach(cleanup)

const actions = {
  open: vi.fn(), continueWork: vi.fn(), toggleHandled: vi.fn(), addTodo: vi.fn(), togglePinned: vi.fn(), snoozeUntilTomorrow: vi.fn(),
}

function item() {
  return selectInbox([row('running', { running: true, projectionValues: { sessionDigest: digest({ reply: null, outcome: null }), todos: [
    { content: '检查工作区布局', status: 'completed' },
    { content: '验证卡片的网格对齐', status: 'in_progress' },
    { content: '等待浏览器构建', status: 'in_progress' },
    { content: '更新说明', status: 'pending' },
  ] } })], [], inbox(), { now: NOW, window: 'all', workspace: undefined, showHandled: false, ungroupedLabel: '未分组' }).sections[0]!.items[0]!
}

describe('running-card work', () => {
  it('shows the current agent checklist even when final-result previews are hidden', () => {
    render(<InboxCard item={item()} focused={false} actions={actions} pinning={true} showReply={false} t={t} />)
    expect(screen.getByText('验证卡片的网格对齐')).toBeTruthy()
    expect(screen.getByText('等待浏览器构建')).toBeTruthy()
    expect(screen.getByText('任务完成 1 / 4')).toBeTruthy()
    expect(screen.getByText('当前任务')).toBeTruthy()
    expect(screen.getByText('等待 agent 记录下一步进展。')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('labels cumulative counters and visible background jobs separately from active tasks', () => {
    const current = item()
    current.work = { ...current.work!,
      steps: { count: 18, includesInherited: false },
      tools: { calls: 24, results: 22, errors: 1, names: [{ name: 'bash', calls: 8 }, { name: 'read', calls: 6 }], additionalNames: 2 },
      jobs: { activeCount: 3, stoppingCount: 1, labels: ['构建 Web', '检查类型'] },
    }
    render(<InboxCard item={current} focused={false} actions={actions} pinning={true} showReply={true} t={t} />)
    expect(screen.getByText('会话累计 18 步')).toBeTruthy()
    expect(screen.getByText('工具调用 24 次 · 返回 22 次')).toBeTruthy()
    expect(screen.getByText('失败 1 次')).toBeTruthy()
    expect(screen.getByText('可见后台任务 3 项')).toBeTruthy()
    expect(screen.getByText('正在停止 1 项')).toBeTruthy()
    expect(screen.getByText('构建 Web')).toBeTruthy()
    expect(screen.getByText('另有 1 项')).toBeTruthy()
    expect(screen.queryByText(/2 个工具正在运行/)).toBeNull()
  })

  it('reports additional active tasks and truncation without exposing a missing update as text', () => {
    const current = item()
    current.work = { ...current.work!, tasks: { total: 5, completed: 1, activeCount: 3, active: ['任务 A', '任务 B'] } }
    current.reply = '正在检查构建产物'
    current.replyTruncated = true
    const view = render(<InboxCard item={current} focused={false} actions={actions} pinning={true} showReply={true} t={t} />)
    expect(screen.getByText('另有 1 项进行中')).toBeTruthy()
    expect(screen.getByText('正在检查构建产物…')).toBeTruthy()
    current.reply = null
    view.rerender(<InboxCard item={current} focused={false} actions={actions} pinning={true} showReply={true} t={t} />)
    expect(screen.getByText('等待 agent 记录下一步进展。')).toBeTruthy()
  })

  it('distinguishes whole-log fallback counts and does not turn missing task data into zero percent', () => {
    const current = item()
    current.work = workSummaryOf(row('missing', { projectionValues: {} }), [])
    current.work = { ...current.work, steps: { count: 12, includesInherited: true } }
    const view = render(<InboxCard item={current} focused={false} actions={actions} pinning={true} showReply={true} t={t} />)
    expect(screen.getByText('含继承历史累计 12 步')).toBeTruthy()
    expect(screen.queryByText('任务完成 0 / 0')).toBeNull()
    expect(view.container.textContent).not.toContain('%')
  })
})
