import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import SessionInboxService, { inboxSessionRowSchema, inboxTodoRowSchema } from '../src/index.ts'
import type { InboxSnapshot, InboxTodoId } from '../src/index.ts'
import { setupHarness, type TestHarness } from './helpers.ts'

const harnesses: TestHarness[] = []

async function harness(maxTextBytes = 64): Promise<TestHarness> {
  const value = await setupHarness(maxTextBytes)
  harnesses.push(value)
  return value
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(harnesses.splice(0).map(value => value.dispose()))
})

const A = SessionId('session-a')
const B = SessionId('session-b')

function todoOf(result: { ok: boolean; value?: InboxSnapshot; error?: { code: string } }, index = 0) {
  if (!result.ok || result.value === undefined) throw new Error(`expected todo, got ${result.error?.code}`)
  const todo = result.value.todos[index]
  if (todo === undefined) throw new Error('no todo at index')
  return todo
}

describe('SessionInboxService public contract', () => {
  it('publishes the exact Gateway namespace and Remote method names', async () => {
    const { ctx } = await harness()
    expect(ctx.sessionInbox.typertRemote.namespace).toBe('sessionInbox')
    expect(remoteMethods(ctx.sessionInbox).map(marker => marker.method)).toEqual([
      'get', 'markSeen', 'setHandled', 'snooze', 'setPinned', 'markReviewed',
      'addTodo', 'updateTodo', 'removeTodo',
    ])
  })

  it('rejects a non-positive text budget at load and at construction', async () => {
    await expect(setupHarness(0)).rejects.toThrow(/expected number >= 1/u)
    expect(() => new SessionInboxService(new Context(), { maxTextBytes: 1.5 })).toThrow(/positive safe integer/u)
  })

  it('starts empty and serves the same snapshot after a no-op', async () => {
    const { ctx } = await harness()
    expect(ctx.sessionInbox.get()).toEqual({ reviewedAt: null, sessions: [], todos: [] })
    const changed = vi.fn()
    ctx.on('session-inbox/changed', changed)
    const after = await ctx.sessionInbox.setPinned({ sessionId: A, pinned: false })
    expect(after).toEqual({ reviewedAt: null, sessions: [], todos: [] })
    expect(changed).not.toHaveBeenCalled()
  })
})

describe('session marks', () => {
  it('raises the seen mark monotonically and publishes each real change', async () => {
    const { ctx } = await harness()
    const changed = vi.fn()
    ctx.on('session-inbox/changed', changed)
    const first = await ctx.sessionInbox.markSeen({ sessionId: A, seq: 10 })
    expect(first.sessions).toEqual([expect.objectContaining({ sessionId: A, lastSeenSeq: 10, pinned: false })])
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed.mock.calls[0]?.[0]).toBe(first)

    const lower = await ctx.sessionInbox.markSeen({ sessionId: A, seq: 4 })
    expect(lower.sessions[0]?.lastSeenSeq).toBe(10)
    const same = await ctx.sessionInbox.markSeen({ sessionId: A, seq: 10 })
    expect(same.sessions[0]?.lastSeenSeq).toBe(10)
    expect(changed).toHaveBeenCalledTimes(1)

    const higher = await ctx.sessionInbox.markSeen({ sessionId: A, seq: 11 })
    expect(higher.sessions[0]?.lastSeenSeq).toBe(11)
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('stamps handledAt from the clock and clears it on unhandle', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 })
    const { ctx } = await harness()
    const handled = await ctx.sessionInbox.setHandled({ sessionId: A, handled: true })
    expect(handled.sessions[0]).toEqual({
      sessionId: A, lastSeenSeq: null, handledAt: 1_700_000_000_000, snoozedUntil: null, pinned: false,
      updatedAt: 1_700_000_000_000,
    })
    const again = await ctx.sessionInbox.setHandled({ sessionId: A, handled: true })
    expect(again).toEqual(handled)
    const cleared = await ctx.sessionInbox.setHandled({ sessionId: A, handled: false })
    expect(cleared.sessions).toEqual([])
  })

  it('snoozes only into the future and clears with null', async () => {
    vi.useFakeTimers({ now: 1_000 })
    const { ctx } = await harness()
    await expect(ctx.sessionInbox.snooze({ sessionId: A, until: 1_000 })).resolves.toEqual({
      ok: false,
      error: { code: 'snooze-in-past', until: 1_000 },
    })
    const snoozed = await ctx.sessionInbox.snooze({ sessionId: A, until: 5_000 })
    if (!snoozed.ok) throw new Error('expected snooze success')
    expect(snoozed.value.sessions[0]?.snoozedUntil).toBe(5_000)
    const same = await ctx.sessionInbox.snooze({ sessionId: A, until: 5_000 })
    expect(same).toEqual(snoozed)
    const cleared = await ctx.sessionInbox.snooze({ sessionId: A, until: null })
    if (!cleared.ok) throw new Error('expected clear success')
    expect(cleared.value.sessions).toEqual([])
  })

  it('pins, keeps other marks, and deletes the row once every mark is cleared', async () => {
    const { ctx } = await harness()
    await ctx.sessionInbox.setPinned({ sessionId: A, pinned: true })
    const seen = await ctx.sessionInbox.markSeen({ sessionId: A, seq: 3 })
    expect(seen.sessions[0]).toEqual(expect.objectContaining({ pinned: true, lastSeenSeq: 3 }))
    const unpinned = await ctx.sessionInbox.setPinned({ sessionId: A, pinned: false })
    expect(unpinned.sessions[0]).toEqual(expect.objectContaining({ pinned: false, lastSeenSeq: 3 }))
    await ctx.sessionInbox.setPinned({ sessionId: B, pinned: true })
    const two = ctx.sessionInbox.get()
    expect(two.sessions.map(row => row.sessionId).sort()).toEqual([A, B])
  })

  it('records the review boundary from the clock', async () => {
    vi.useFakeTimers({ now: 42 })
    const { ctx } = await harness()
    const reviewed = await ctx.sessionInbox.markReviewed()
    expect(reviewed.reviewedAt).toBe(42)
    vi.setSystemTime(99)
    expect((await ctx.sessionInbox.markReviewed()).reviewedAt).toBe(99)
  })
})

describe('todos', () => {
  it('validates text before touching storage', async () => {
    const { ctx } = await harness(8)
    const changed = vi.fn()
    ctx.on('session-inbox/changed', changed)
    await expect(ctx.sessionInbox.addTodo({ sessionId: A, questionSeq: null, text: '   ' })).resolves.toEqual({
      ok: false,
      error: { code: 'text-blank' },
    })
    await expect(ctx.sessionInbox.addTodo({ sessionId: A, questionSeq: null, text: '这是很长的待办' })).resolves.toEqual({
      ok: false,
      error: { code: 'text-too-large', maxBytes: 8, actualBytes: 21 },
    })
    expect(changed).not.toHaveBeenCalled()
  })

  it('creates, updates, completes, and removes todos in creation order', async () => {
    vi.useFakeTimers({ now: 100 })
    const { ctx } = await harness()
    const first = todoOf(await ctx.sessionInbox.addTodo({ sessionId: A, questionSeq: 7, text: 'follow up' }))
    expect(first).toEqual(expect.objectContaining({
      sessionId: A, questionSeq: 7, text: 'follow up', status: 'open', createdAt: 100, updatedAt: 100, doneAt: null,
    }))
    const afterTwin = await ctx.sessionInbox.addTodo({ sessionId: B, questionSeq: null, text: 'same tick' })
    if (!afterTwin.ok) throw new Error('expected twin')
    const twin = afterTwin.value.todos.find(todo => todo.text === 'same tick')
    if (twin === undefined) throw new Error('twin missing')
    vi.setSystemTime(200)
    const second = todoOf(await ctx.sessionInbox.addTodo({ sessionId: B, questionSeq: null, text: 'later' }), 2)
    // Same-tick todos order by id so the list is stable across reads.
    const expectedOrder = [first.id, twin.id].sort((a, b) => a.localeCompare(b))
    expect(ctx.sessionInbox.get().todos.map(todo => todo.id)).toEqual([...expectedOrder, second.id])
    await ctx.sessionInbox.removeTodo({ id: twin.id })

    vi.setSystemTime(300)
    const done = await ctx.sessionInbox.updateTodo({ id: first.id, status: 'done' })
    expect(todoOf(done)).toEqual(expect.objectContaining({ status: 'done', doneAt: 300, updatedAt: 300 }))
    const untouched = await ctx.sessionInbox.updateTodo({ id: first.id, status: 'done' })
    expect(untouched).toEqual(done)
    vi.setSystemTime(400)
    const reopened = await ctx.sessionInbox.updateTodo({ id: first.id, status: 'open' })
    expect(todoOf(reopened)).toEqual(expect.objectContaining({ status: 'open', doneAt: null, updatedAt: 400 }))
    const renamed = await ctx.sessionInbox.updateTodo({ id: first.id, text: 'renamed' })
    expect(todoOf(renamed)).toEqual(expect.objectContaining({ text: 'renamed', status: 'open', doneAt: null }))

    await expect(ctx.sessionInbox.updateTodo({ id: first.id, text: ' ' })).resolves.toEqual({
      ok: false,
      error: { code: 'text-blank' },
    })
    const missing = 'missing' as InboxTodoId
    await expect(ctx.sessionInbox.updateTodo({ id: missing, text: 'x' })).resolves.toEqual({
      ok: false,
      error: { code: 'todo-not-found', id: missing },
    })

    const removed = await ctx.sessionInbox.removeTodo({ id: first.id })
    expect(removed.todos.map(todo => todo.id)).toEqual([second.id])
    const changed = vi.fn()
    ctx.on('session-inbox/changed', changed)
    await ctx.sessionInbox.removeTodo({ id: first.id })
    expect(changed).not.toHaveBeenCalled()
  })
})

describe('lifecycle', () => {
  it('survives a service restart on the same storage', async () => {
    const h = await harness()
    await h.ctx.sessionInbox.setPinned({ sessionId: A, pinned: true })
    const todo = todoOf(await h.ctx.sessionInbox.addTodo({ sessionId: A, questionSeq: 2, text: 'persist' }))
    await h.ctx.sessionInbox.markReviewed()
    const before = h.ctx.sessionInbox.get()
    await h.disposeInbox()
    await h.ctx.plugin(SessionInboxService, { maxTextBytes: 64 })
    expect(h.ctx.sessionInbox.get()).toEqual(before)
    expect(h.ctx.sessionInbox.get().todos[0]?.id).toBe(todo.id)
  })

  it('rejects mutations once disposal began and fails loud before init', async () => {
    const h = await harness()
    const service = h.ctx.sessionInbox
    await h.disposeInbox()
    await expect(service.markSeen({ sessionId: A, seq: 1 })).rejects.toThrow(/disposing/u)
    const fresh = new SessionInboxService(new Context(), { maxTextBytes: 8 })
    expect(() => fresh.get()).toThrow(/not initialized/u)
    await expect(fresh.markReviewed()).rejects.toThrow(/not initialized/u)
    await expect(fresh.addTodo({ sessionId: A, questionSeq: null, text: 'x' })).rejects.toThrow(/not initialized/u)
  })

  it('validates stored rows with the exported schemas', () => {
    const row = { lastSeenSeq: 1, handledAt: null, snoozedUntil: null, pinned: true, updatedAt: 1 }
    expect(inboxSessionRowSchema.safeParse(row).success).toBe(true)
    expect(inboxSessionRowSchema.safeParse({ ...row, lastSeenSeq: 1.5 }).success).toBe(false)
    expect(inboxTodoRowSchema.safeParse({
      id: 't', sessionId: 's', questionSeq: null, text: 'x', status: 'open', createdAt: 1, updatedAt: 1, doneAt: null,
    }).success).toBe(true)
  })
})
