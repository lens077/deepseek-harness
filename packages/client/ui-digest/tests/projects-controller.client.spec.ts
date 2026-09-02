// @vitest-environment jsdom
/**
 * ProjectTodosController: one shared in-flight read, push adoption, rescan
 * state, document reads with carrier and business failures, and disposal.
 */
import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ProjectTodoReadResult, ProjectTodosSnapshot } from '@deepseek-ai/dsh-project-todos/types'
import { ProjectTodosController, type ProjectTodosRemote } from '../src/client/projects-controller.ts'
import { project, projectFile, projectItem, projectsSnapshot } from './fixtures.client.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

const ok = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
const carrierFail = <T>(): RemoteResult<T> => ({ ok: false, error: { code: 'unreachable', message: 'host down' } as never })

function remote(over: Partial<ProjectTodosRemote> = {}): ProjectTodosRemote & { calls: string[] } {
  const calls: string[] = []
  const snapshot = projectsSnapshot({ projects: [project('/p/a', [projectFile('/p/a/TODO.md', [projectItem('x')])])] })
  return {
    calls,
    get: () => {
      calls.push('get')
      return Promise.resolve(ok(snapshot))
    },
    rescan: () => {
      calls.push('rescan')
      return Promise.resolve(ok(snapshot))
    },
    readDocument: ({ path }) => {
      calls.push('readDocument')
      return Promise.resolve(ok<ProjectTodoReadResult>({ ok: true, value: { path, text: 'text', mtime: 1 } }))
    },
    ...over,
  }
}

describe('ProjectTodosController', () => {
  it('starts cold, loads once, and shares a concurrent load', async () => {
    const gate = deferred<RemoteResult<ProjectTodosSnapshot>>()
    const r = remote({ get: () => {
      r.calls.push('get')
      return gate.promise
    } })
    const c = new ProjectTodosController(r)
    const seen: string[] = []
    c.subscribe(() => { seen.push(c.getSnapshot().status) })
    expect(c.getSnapshot().status).toBe('cold')
    const first = c.ensure()
    const second = c.ensure()
    expect(c.getSnapshot()).toMatchObject({ status: 'loading', scanning: false })
    gate.resolve(ok(projectsSnapshot({ candidates: 9 })))
    expect(await first).toEqual({ ok: true })
    expect(await second).toEqual({ ok: true })
    expect(r.calls).toEqual(['get'])
    expect(c.getSnapshot().snapshot.candidates).toBe(9)
    expect(seen).toEqual(['loading', 'ready'])
    // Warm: ensure is free.
    await c.ensure()
    expect(r.calls).toEqual(['get'])
  })

  it('reports a carrier failure, stays retryable, and marks scanning during a rescan', async () => {
    const r = remote({ get: () => Promise.resolve(carrierFail()) })
    const c = new ProjectTodosController(r)
    expect(await c.ensure()).toEqual({ ok: false, error: { code: 'unreachable', message: 'host down' } })
    expect(c.getSnapshot()).toMatchObject({ status: 'error', error: 'host down' })
    const gate = deferred<RemoteResult<ProjectTodosSnapshot>>()
    r.rescan = () => gate.promise
    const pending = c.rescan()
    expect(c.getSnapshot()).toMatchObject({ status: 'loading', scanning: true })
    gate.resolve(ok(projectsSnapshot()))
    expect(await pending).toEqual({ ok: true })
    expect(c.getSnapshot()).toMatchObject({ status: 'ready', scanning: false, error: null })
  })

  it('adopts a pushed snapshot and keeps the scanning flag', async () => {
    const c = new ProjectTodosController(remote())
    const pushed = projectsSnapshot({ candidates: 4 })
    c.receive(pushed)
    expect(c.getSnapshot()).toMatchObject({ status: 'ready', snapshot: pushed, scanning: false })
    const gate = deferred<RemoteResult<ProjectTodosSnapshot>>()
    const r = remote({ rescan: () => gate.promise })
    const scanning = new ProjectTodosController(r)
    const pending = scanning.rescan()
    scanning.receive(pushed)
    expect(scanning.getSnapshot()).toMatchObject({ status: 'ready', snapshot: pushed, scanning: true })
    gate.resolve(ok(pushed))
    await pending
    expect(scanning.getSnapshot().scanning).toBe(false)
  })

  it('reads documents and describes carrier, business, and unknown failures', async () => {
    const r = remote()
    const c = new ProjectTodosController(r)
    await expect(c.readDocument('/p/a/TODO.md')).resolves.toEqual({ ok: true, value: { path: '/p/a/TODO.md', text: 'text', mtime: 1 } })
    r.readDocument = () => Promise.resolve(carrierFail())
    await expect(c.readDocument('/x')).resolves.toEqual({ ok: false, error: { code: 'unreachable', message: 'host down' } })
    r.readDocument = () => Promise.resolve(ok<ProjectTodoReadResult>({ ok: false, error: { code: 'not-listed', path: '/x' } }))
    await expect(c.readDocument('/x')).resolves.toEqual({ ok: false, error: { code: 'not-listed', message: 'this document is not in the last scan' } })
    r.readDocument = () => Promise.resolve(ok<ProjectTodoReadResult>({ ok: false, error: { code: 'read-failed', path: '/x', message: 'gone' } }))
    await expect(c.readDocument('/x')).resolves.toEqual({ ok: false, error: { code: 'read-failed', message: 'the document could not be read' } })
    r.readDocument = () => Promise.resolve(ok({ ok: false, error: { code: 'strange' } } as never))
    await expect(c.readDocument('/x')).resolves.toEqual({ ok: false, error: { code: 'strange', message: 'strange' } })
  })

  it('reports disposed for every later action and drops listeners and late replies', async () => {
    const gate = deferred<RemoteResult<ProjectTodosSnapshot>>()
    const r = remote({ get: () => gate.promise })
    const c = new ProjectTodosController(r)
    const listener = vi.fn()
    const unsubscribe = c.subscribe(listener)
    const silent = vi.fn()
    c.subscribe(silent)()
    const pending = c.refresh()
    c.dispose()
    gate.resolve(ok(projectsSnapshot()))
    expect(await pending).toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(c.getSnapshot().status).toBe('loading')
    c.receive(projectsSnapshot())
    expect(c.getSnapshot().status).toBe('loading')
    await expect(c.rescan()).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })
    await expect(c.readDocument('/x')).resolves.toMatchObject({ ok: false, error: { code: 'disposed' } })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(silent).not.toHaveBeenCalled()
    unsubscribe()
  })
})
