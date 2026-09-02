/**
 * Inbox selection rules: how rows are classified, which the window admits,
 * how sections and chips are built, the per-question timeline, the joined
 * todo rows, and the Markdown brief.
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  dayKey, questionSeqOf, renderBrief, selectInbox, selectTimeline, selectTodos, startOfDay, windowSince,
  type BriefLabels, type InboxSelectOptions,
} from '../src/client/select.ts'
import { DAY, HOUR, NOW, digest, inbox, mark, row, todo, workspace } from './fixtures.client.ts'

const options = (over: Partial<InboxSelectOptions> = {}): InboxSelectOptions => ({
  now: NOW, window: 'all', workspace: undefined, showHandled: false, ungroupedLabel: '未分组', ...over,
})

function sectionKeys(selection: ReturnType<typeof selectInbox>): string[] {
  return selection.sections.map(section => `${section.key}:${section.items.map(item => item.sessionId).join(',')}`)
}

describe('selectInbox classification', () => {
  it('sections waiting, failed, unread, seen, and running rows in that order', () => {
    const rows = [
      row('seen'),
      row('unread', { updatedAt: NOW }),
      row('failed', { projectionValues: { sessionDigest: digest({ outcome: 'error' }) } }),
      row('open', { projectionValues: { sessionDigest: digest({ outcome: null, reply: null, replySeq: null }) } }),
      row('running', { running: true }),
      row('bare', { running: true, projectionValues: {} }),
      row('waiting', { pendingInteraction: { kind: 'approval' } as never }),
      row('blank', { blank: true }),
      row('sub', { origin: 'subagent' }),
      row('empty', { projectionValues: { sessionDigest: digest({ question: null }) } }),
      row('nodigest', { projectionValues: {} }),
    ]
    const marks = inbox({ sessions: [mark('seen', { lastSeenSeq: 3 })] })
    const selection = selectInbox(rows, [], marks, options())
    expect(sectionKeys(selection)).toEqual([
      'needsYou:waiting',
      'failed:failed,open',
      'unread:unread',
      'seen:seen',
      'running:running,bare',
    ])
    expect(selection.attentionCount).toBe(4)
    expect(selection.waitingCount).toBe(1)
    expect(selection.runningCount).toBe(2)
    expect(selection.sections[4]?.items[1]).toMatchObject({
      question: null, questionSeq: null, reply: null, outcome: null, changedFiles: [], changedFileCount: 0,
      questionTruncated: false, replyTruncated: false,
    })
    expect(selection.snoozedCount).toBe(0)
    const failed = selection.sections[1]?.items[0]
    expect(failed).toMatchObject({ category: 'failed', unread: true, outcome: 'error', handled: false })
  })

  it('treats a reply above the seen mark as unread and a question without reply by its own seq', () => {
    const rows = [
      row('a', { projectionValues: { sessionDigest: digest({ replySeq: 5 }) } }),
      row('b', { projectionValues: { sessionDigest: digest({ replySeq: null, questionSeq: 2 }) } }),
      row('c', { projectionValues: { sessionDigest: digest({ replySeq: null, questionSeq: null }) } }),
    ]
    const marks = inbox({ sessions: [mark('a', { lastSeenSeq: 5 }), mark('b', { lastSeenSeq: 1 })] })
    const selection = selectInbox(rows, [], marks, options())
    expect(sectionKeys(selection)).toEqual(['unread:b', 'seen:a,c'])
  })

  it('hides handled rows unless asked, and counts snoozed rows without listing them', () => {
    const rows = [row('handled'), row('snoozed'), row('resurfaced')]
    const marks = inbox({ sessions: [
      mark('handled', { handledAt: NOW - HOUR }),
      mark('snoozed', { snoozedUntil: NOW + HOUR }),
      mark('resurfaced', { snoozedUntil: NOW - 1 }),
    ] })
    const hidden = selectInbox(rows, [], marks, options())
    expect(sectionKeys(hidden)).toEqual(['unread:resurfaced'])
    expect(hidden.snoozedCount).toBe(1)
    expect(hidden.attentionCount).toBe(1)
    const shown = selectInbox(rows, [], marks, options({ showHandled: true }))
    expect(sectionKeys(shown)).toEqual(['unread:resurfaced', 'handled:handled'])
  })

  it('moves pinned rows to the front while keeping their category, and never pins a running row away', () => {
    const rows = [row('pinned'), row('run', { running: true }), row('other', { updatedAt: NOW })]
    const marks = inbox({ sessions: [mark('pinned', { pinned: true }), mark('run', { pinned: true })] })
    const selection = selectInbox(rows, [], marks, options())
    expect(sectionKeys(selection)).toEqual(['pinned:pinned', 'unread:other', 'running:run'])
    expect(selection.sections[0]?.items[0]).toMatchObject({ pinned: true, category: 'unread' })
  })
})

describe('selectInbox window and filters', () => {
  it('admits actionable rows regardless of the window but bounds context rows', () => {
    const old = NOW - 3 * DAY
    const rows = [
      row('oldSeen', { updatedAt: old }),
      row('oldUnread', { updatedAt: old }),
      row('oldRunning', { running: true, updatedAt: old }),
      row('newSeen', { updatedAt: NOW - HOUR }),
    ]
    const marks = inbox({ reviewedAt: NOW - DAY, sessions: [mark('oldSeen', { lastSeenSeq: 3 }), mark('newSeen', { lastSeenSeq: 3 })] })
    const since = selectInbox(rows, [], marks, options({ window: 'sinceReview' }))
    expect(sectionKeys(since)).toEqual(['unread:oldUnread', 'seen:newSeen'])
    expect(since.since).toBe(NOW - DAY)
    expect(since.runningCount).toBe(1)
    const all = selectInbox(rows, [], marks, options({ window: 'all' }))
    expect(sectionKeys(all)).toEqual(['unread:oldUnread', 'seen:newSeen,oldSeen', 'running:oldRunning'])
  })

  it('resolves each window bound', () => {
    expect(windowSince('sinceReview', NOW, 123)).toBe(123)
    expect(windowSince('sinceReview', NOW, null)).toBe(NOW - DAY)
    expect(windowSince('today', NOW, null)).toBe(startOfDay(NOW))
    expect(windowSince('week', NOW, null)).toBe(startOfDay(NOW) - 6 * DAY)
    expect(windowSince('all', NOW, null)).toBeNull()
    expect(dayKey(NOW)).toBe('2026-09-16')
  })

  it('counts attention per workspace in sidebar order and filters by workspace or ungrouped', () => {
    const rows = [row('a'), row('b'), row('c', { running: true }), row('u')]
    const workspaces = [workspace('w2', ['b']), workspace('w1', ['a', 'c']), workspace('w0', [])]
    const all = selectInbox(rows, workspaces, inbox(), options())
    expect(all.workspaces).toEqual([
      { workspaceId: 'w2', title: 'ws-w2', attention: 1, running: 0 },
      { workspaceId: 'w1', title: 'ws-w1', attention: 1, running: 1 },
      { workspaceId: null, title: '未分组', attention: 1, running: 0 },
    ])
    expect(sectionKeys(selectInbox(rows, workspaces, inbox(), options({ workspace: 'w1' })))).toEqual(['unread:a', 'running:c'])
    expect(sectionKeys(selectInbox(rows, workspaces, inbox(), options({ workspace: null })))).toEqual(['unread:u'])
    // Chips are unaffected by the filter.
    expect(selectInbox(rows, workspaces, inbox(), options({ workspace: null })).workspaces).toHaveLength(3)
  })

  it('carries the changed-file record and workspace title onto the item', () => {
    const rows = [row('a', { projectionValues: { sessionDigest: digest({ changedFiles: ['x.ts'], changedFileCount: 2 }) } })]
    const item = selectInbox(rows, [workspace('w', ['a'], 'Alpha')], inbox(), options()).sections[0]?.items[0]
    expect(item).toMatchObject({ changedFiles: ['x.ts'], changedFileCount: 2, workspaceTitle: 'Alpha', workspaceId: 'w' })
    // A workspace without a title falls back to the ungrouped label rather than an empty heading.
    const orphan = selectInbox(rows, [{ ...workspace('w', ['a']), title: undefined as unknown as string }], inbox(), options())
    expect(orphan.sections[0]?.items[0]?.workspaceTitle).toBe('未分组')
  })
})

describe('selectTimeline', () => {
  it('places every retained question on its day, newest first, marking the current one', () => {
    const rows = [
      row('a', { projectionValues: { sessionDigest: digest({
        questionAt: NOW - HOUR,
        history: [
          { seq: 0, at: NOW - DAY - HOUR, text: 'yesterday', truncated: true, outcome: 'completed', repliedAt: null, changedFileCount: 1 },
        ],
      }) } }),
      row('b', { projectionValues: { sessionDigest: digest({ questionAt: NOW - 2 * DAY, questionSeq: 9 }) } }),
      row('c', { projectionValues: { sessionDigest: digest({ question: null, questionSeq: null, questionAt: null }) } }),
      row('d', { projectionValues: {} }),
      row('e', { blank: true }),
    ]
    const days = selectTimeline(rows, [workspace('w', ['a'])], null, '未分组')
    expect(days.map(day => `${day.key}:${day.entries.map(entry => `${entry.sessionId}@${entry.seq}${entry.current ? '*' : ''}`).join(',')}`))
      .toEqual(['2026-09-16:a@1*', '2026-09-15:a@0', '2026-09-14:b@9*'])
    expect(days[1]?.entries[0]).toMatchObject({ text: 'yesterday', truncated: true, changedFileCount: 1, workspaceTitle: 'ws-w' })
    expect(days[2]?.entries[0]?.workspaceTitle).toBe('未分组')
    // The bound drops earlier questions and earlier current questions alike.
    const bounded = selectTimeline(rows, [], NOW - DAY, '未分组')
    expect(bounded.map(day => day.key)).toEqual(['2026-09-16'])
  })
})

describe('selectTodos', () => {
  it('joins todos with their session and question, open first then newest done', () => {
    const rows = [row('a', { projectionValues: { sessionDigest: digest({
      questionSeq: 7,
      question: 'current',
      history: [{ seq: 2, at: NOW - DAY, text: 'earlier', truncated: false, outcome: 'completed', repliedAt: null, changedFileCount: 0 }],
    }) } })]
    const snapshot = inbox({ todos: [
      todo('t1', 'a', { questionSeq: 2, createdAt: 1 }),
      todo('t2', 'a', { questionSeq: 7, createdAt: 2 }),
      todo('t3', 'a', { questionSeq: null, createdAt: 3 }),
      todo('t4', 'a', { questionSeq: 99, createdAt: 4 }),
      todo('t5', 'gone', { createdAt: 5 }),
      todo('d1', 'a', { status: 'done', doneAt: 10, createdAt: 0 }),
      todo('d2', 'a', { status: 'done', doneAt: null, updatedAt: 20, createdAt: 0 }),
    ] })
    const joined = selectTodos(snapshot, rows, [workspace('w', ['a'])], '未分组')
    expect(joined.map(item => item.todo.id)).toEqual(['t5', 't4', 't3', 't2', 't1', 'd2', 'd1'])
    const byId = new Map(joined.map(item => [item.todo.id as string, item]))
    expect(byId.get('t1')?.questionText).toBe('earlier')
    expect(byId.get('t2')?.questionText).toBe('current')
    expect(byId.get('t3')?.questionText).toBe('current')
    expect(byId.get('t4')?.questionText).toBeNull()
    expect(byId.get('t5')).toMatchObject({ title: null, workspaceTitle: null, questionText: null })
    expect(byId.get('t1')).toMatchObject({ title: 'title-a', workspaceTitle: 'ws-w' })
    // A session without a digest still joins its title.
    const bare = selectTodos(inbox({ todos: [todo('t', 'b')] }), [row('b', { projectionValues: {} })], [], '未分组')
    expect(bare[0]).toMatchObject({ title: 'title-b', workspaceTitle: '未分组', questionText: null })
  })
})

describe('renderBrief', () => {
  const labels: BriefLabels = {
    title: '晨报',
    since: '起点',
    sections: {
      pinned: '置顶', needsYou: '等你回复', failed: '失败', unread: '未读', seen: '已读', running: '运行中', handled: '已处理',
    },
    outcomes: {
      completed: '已完成', error: '出错', aborted: '已取消', blocked: '被阻止', 'max-tokens': '上限', interrupted: '中断', open: '未结束',
    },
    files: count => `改了 ${count} 个文件`,
    todos: '待办',
    none: '没有需要处理的任务。',
  }

  it('renders sections, items, and open todos as Markdown', () => {
    const rows = [
      row('a', { projectionValues: { sessionDigest: digest({ question: 'multi\nline  question', changedFileCount: 2 }) } }),
      row('r', { running: true, projectionValues: { sessionDigest: digest({ question: null }) } }),
      row('q', { projectionValues: { sessionDigest: digest({ question: null, outcome: 'error' }) } }),
    ]
    const selection = selectInbox(rows, [workspace('w', ['a'], 'Alpha')], inbox({ reviewedAt: 1_000 }), options({ window: 'sinceReview' }))
    const todos = selectTodos(inbox({ todos: [todo('t', 'a', { text: 'follow up', createdAt: 1 }), todo('g', 'gone', { createdAt: 2 }), todo('d', 'a', { status: 'done' })] }), rows, [], '未分组')
    const text = renderBrief(selection, todos, labels, at => `T${at}`)
    expect(text).toBe([
      '# 晨报',
      '',
      '起点: T1000',
      '',
      '## 未读 (1)',
      '',
      '- [Alpha] title-a — multi line question (已完成) · 改了 2 个文件',
      '',
      '## 运行中 (1)',
      '',
      '- [未分组] title-r',
      '',
      '## 待办 (2)',
      '',
      '- [ ] todo-g',
      '- [ ] follow up — title-a',
      '',
    ].join('\n'))
  })

  it('states emptiness and skips the since line without a bound', () => {
    const selection = selectInbox([], [], inbox(), options({ window: 'all' }))
    expect(renderBrief(selection, [], labels, String)).toBe('# 晨报\n\n没有需要处理的任务。\n')
    const truncated = selectInbox(
      [row('a', { projectionValues: { sessionDigest: digest({ questionTruncated: true, outcome: null }) } })],
      [], inbox(), options({ window: 'all' }),
    )
    expect(renderBrief(truncated, [], labels, String)).toContain('修一下登录的 bug… (未结束)')
  })
})

describe('questionSeqOf', () => {
  it('reads the newest question seq or null at every missing level', () => {
    expect(questionSeqOf(undefined)).toBeNull()
    const bare = row('a')
    delete bare.projectionValues
    expect(questionSeqOf(bare)).toBeNull()
    expect(questionSeqOf(row('a', { projectionValues: {} }))).toBeNull()
    expect(questionSeqOf(row('a', { projectionValues: { sessionDigest: digest({ questionSeq: null }) } }))).toBeNull()
    expect(questionSeqOf(row('a', { projectionValues: { sessionDigest: digest({ questionSeq: 8 }) } }))).toBe(8)
  })
})

describe('id typing', () => {
  it('keeps session ids branded through the item', () => {
    const item = selectInbox([row('z')], [], inbox(), options()).sections[0]?.items[0]
    const id: SessionId | undefined = item?.sessionId
    expect(id).toBe('z')
  })
})
