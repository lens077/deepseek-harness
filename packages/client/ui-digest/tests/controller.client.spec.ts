/**
 * Inbox controller: one shared read, snapshot adoption from replies and
 * pushes, business and carrier failures surfaced as results, the seen-mark
 * short-circuit, and disposal.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InboxSnapshot, InboxTodoId } from '@deepseek-ai/dsh-session-inbox/types'
import { InboxController, type InboxRemote } from '../src/client/controller.ts'
import { inbox, mark, todo } from './fixtures.client.ts'

const A = 'a' as SessionId

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

function remoteStub(snapshot: InboxSnapshot = inbox()): { remote: InboxRemote; calls: string[] } {
  const calls: string[] = []
  const reply = (name: string) => vi.fn(async () => {
    calls.push(name)
    return ok(snapshot)
  })
  const business = (name: string) => vi.fn(async () => {
    calls.push(name)
    return ok({ ok: true as const, value: snapshot })
  })
  return {
    calls,
    remote: {
      get: reply('get'),
      markSeen: reply('markSeen'),
      setHandled: reply('setHandled'),
      snooze: business('snooze'),
      setPinned: reply('setPinned'),
      markReviewed: reply('markReviewed'),
      addTodo: business('addTodo'),
      updateTodo: business('updateTodo'),
      removeTodo: reply('removeTodo'),
    },
  }
}

describe('InboxController', () => {
  it('starts cold, loads once for concurrent callers, and publishes the snapshot', async () => {
    const snapshot = inbox({ reviewedAt: 5 })
    const { remote, calls } = remoteStub(snapshot)
    const controller = new InboxController(remote)
    const seen: string[] = []
    controller.subscribe(() => { seen.push(controller.getSnapshot().status) })
    expect(controller.getSnapshot()).toMatchObject({ status: 'cold', error: null })
    const [first, second] = await Promise.all([controller.ensure(), controller.ensure()])
    expect(first).toEqual({ ok: true })
    expect(second).toEqual({ ok: true })
    expect(calls).toEqual(['get'])
    expect(seen).toEqual(['loading', 'ready'])
    expect(controller.getSnapshot().snapshot).toBe(snapshot)
    await expect(controller.ensure()).resolves.toEqual({ ok: true })
    expect(calls).toEqual(['get'])
  })

  it('reports a carrier failure on load and stays retryable', async () => {
    const { remote } = remoteStub()
    const get = remote.get as ReturnType<typeof vi.fn>
    get.mockResolvedValueOnce({ ok: false, error: { code: 'offline', message: 'no host' } })
    const controller = new InboxController(remote)
    await expect(controller.refresh()).resolves.toEqual({ ok: false, error: { code: 'offline', message: 'no host' } })
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', error: 'no host' })
    await expect(controller.refresh()).resolves.toEqual({ ok: true })
    expect(controller.getSnapshot().status).toBe('ready')
  })

  it('adopts pushed snapshots and every mutation reply', async () => {
    const { remote, calls } = remoteStub()
    const controller = new InboxController(remote)
    const pushed = inbox({ sessions: [mark('a', { pinned: true })] })
    controller.receive(pushed)
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', snapshot: pushed })
    await expect(controller.setHandled(A, true)).resolves.toEqual({ ok: true })
    await expect(controller.setPinned(A, false)).resolves.toEqual({ ok: true })
    await expect(controller.markReviewed()).resolves.toEqual({ ok: true })
    await expect(controller.removeTodo('t' as InboxTodoId)).resolves.toEqual({ ok: true })
    await expect(controller.snooze(A, 10)).resolves.toEqual({ ok: true })
    await expect(controller.addTodo({ sessionId: A, questionSeq: null, text: 'x' })).resolves.toEqual({ ok: true })
    await expect(controller.updateTodo('t' as InboxTodoId, { status: 'done' })).resolves.toEqual({ ok: true })
    expect(calls).toEqual(['setHandled', 'setPinned', 'markReviewed', 'removeTodo', 'snooze', 'addTodo', 'updateTodo'])
    expect(controller.getSnapshot().snapshot.sessions).toEqual([])
  })

  it('skips markSeen when the known mark already covers the seq', async () => {
    const { remote, calls } = remoteStub()
    const controller = new InboxController(remote)
    controller.receive(inbox({ sessions: [mark('a', { lastSeenSeq: 8 })] }))
    await expect(controller.markSeen(A, 8)).resolves.toEqual({ ok: true })
    await expect(controller.markSeen(A, 3)).resolves.toEqual({ ok: true })
    expect(calls).toEqual([])
    await expect(controller.markSeen(A, 9)).resolves.toEqual({ ok: true })
    await expect(controller.markSeen('b' as SessionId, 1)).resolves.toEqual({ ok: true })
    expect(calls).toEqual(['markSeen', 'markSeen'])
  })

  it('surfaces business failures with readable text and carrier failures verbatim', async () => {
    const { remote } = remoteStub()
    const addTodo = remote.addTodo as ReturnType<typeof vi.fn>
    addTodo.mockResolvedValueOnce(ok({ ok: false, error: { code: 'text-blank' } }))
    addTodo.mockResolvedValueOnce(ok({ ok: false, error: { code: 'text-too-large', maxBytes: 1, actualBytes: 2 } }))
    addTodo.mockResolvedValueOnce(ok({ ok: false, error: { code: 'weird' } }))
    addTodo.mockResolvedValueOnce({ ok: false, error: { code: 'offline', message: 'gone' } })
    const updateTodo = remote.updateTodo as ReturnType<typeof vi.fn>
    updateTodo.mockResolvedValueOnce(ok({ ok: false, error: { code: 'todo-not-found', id: 't' } }))
    const snooze = remote.snooze as ReturnType<typeof vi.fn>
    snooze.mockResolvedValueOnce(ok({ ok: false, error: { code: 'snooze-in-past', until: 1 } }))
    const setPinned = remote.setPinned as ReturnType<typeof vi.fn>
    setPinned.mockResolvedValueOnce({ ok: false, error: { code: 'offline', message: 'gone' } })
    const controller = new InboxController(remote)
    const request = { sessionId: A, questionSeq: null, text: '' }
    expect((await controller.addTodo(request))).toMatchObject({ ok: false, error: { code: 'text-blank', message: 'a todo needs some text' } })
    expect((await controller.addTodo(request))).toMatchObject({ ok: false, error: { code: 'text-too-large', message: 'the todo text is too long' } })
    expect((await controller.addTodo(request))).toMatchObject({ ok: false, error: { code: 'weird', message: 'weird' } })
    expect((await controller.addTodo(request))).toEqual({ ok: false, error: { code: 'offline', message: 'gone' } })
    expect((await controller.updateTodo('t' as InboxTodoId, {}))).toMatchObject({ ok: false, error: { code: 'todo-not-found', message: 'this todo no longer exists' } })
    expect((await controller.snooze(A, 1))).toMatchObject({ ok: false, error: { code: 'snooze-in-past', message: 'the snooze time is already past' } })
    expect((await controller.setPinned(A, true))).toEqual({ ok: false, error: { code: 'offline', message: 'gone' } })
    expect(controller.getSnapshot().status).toBe('cold')
  })

  it('reports disposed after dispose and ignores late replies and pushes', async () => {
    const { remote } = remoteStub()
    const gate = Promise.withResolvers<Awaited<ReturnType<InboxRemote['get']>>>()
    const get = remote.get as ReturnType<typeof vi.fn<InboxRemote['get']>>
    get.mockImplementationOnce(() => gate.promise)
    const controller = new InboxController(remote)
    const pending = controller.refresh()
    controller.dispose()
    gate.resolve(ok(inbox({ todos: [todo('t', 'a')] })))
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })
    controller.receive(inbox({ reviewedAt: 1 }))
    expect(controller.getSnapshot().snapshot.reviewedAt).toBeNull()
    await expect(controller.refresh()).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })
    await expect(controller.setHandled(A, true)).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })
    await expect(controller.addTodo({ sessionId: A, questionSeq: null, text: 'x' })).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })
  })
})
