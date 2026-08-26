// The descendant reader: the shallow pass a panel opens with, the deep pass
// `Load all` drives, what each one leaves unread, the failure and disposal
// paths, and the request sharing that keeps a remount from fanning out twice.

import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { SessionTreeController, type SubagentApi } from '../src/client/tree-controller.ts'
import type { TreeHistoryEntry } from '../src/client/tree-files.ts'

const ROOT = 'root' as SessionId

interface Child {
  kind: 'child'
  id: SessionId
  mode: 'one-shot'
  activity: 'running' | 'inactive'
  hasChildren: boolean
  label?: string
}

function child(id: string, overrides: Partial<Child> = {}): Child {
  return { kind: 'child', id: id as SessionId, mode: 'one-shot', activity: 'inactive', hasChildren: false, ...overrides }
}

/** One page recording a change to `path`. */
function page(path: string, seq = 10): TreeHistoryEntry[] {
  return [
    { event: { type: 'turn/start', seq: seq - 2, time: seq - 2, data: { turn: 1 } } },
    {
      event: { type: 'tool/call', seq: seq - 1, time: seq - 1, data: { callId: 'c1', name: 'edit' } },
      view: { card: 'diff', locations: [{ path }] },
    },
    {
      event: {
        type: 'tool/result',
        seq,
        time: seq,
        data: { message: { content: [{}], source: { callId: 'c1' } } },
      },
      view: { card: 'diff', diffs: [{ path, oldText: 'a', newText: 'b' }] },
    },
  ]
}

interface BenchOptions {
  catalogs?: Record<string, unknown[]>
  pages?: Record<string, Array<{ events: TreeHistoryEntry[]; hasMore: boolean }>>
  listFails?: boolean
  historyFails?: boolean
}

function bench(options: BenchOptions = {}) {
  const catalogs = options.catalogs ?? {}
  const pages = options.pages ?? {}
  const cursors = new Map<string, number>()
  const list = vi.fn(({ parentSessionId }: { parentSessionId: SessionId }) => Promise.resolve({
    result: options.listFails === true
      ? { ok: false, value: { entries: [] }, error: { message: 'catalog unavailable' } }
      : { ok: true, value: { entries: (catalogs[String(parentSessionId)] ?? []) as never[] } },
  }))
  const history = vi.fn(({ childSessionId }: { childSessionId: SessionId }) => {
    if (options.historyFails === true) {
      return Promise.resolve({ result: { ok: false, value: { events: [], hasMore: false }, error: { message: 'gone' } } })
    }
    const key = String(childSessionId)
    const queue = pages[key] ?? [{ events: [], hasMore: false }]
    const at = cursors.get(key) ?? 0
    cursors.set(key, at + 1)
    return Promise.resolve({ result: { ok: true, value: queue[Math.min(at, queue.length - 1)] as never } })
  })
  const api = { list, history } as unknown as SubagentApi
  return { api, list, history, controller: new SessionTreeController(api) }
}

const entryOf = (controller: SessionTreeController) => controller.store.getSnapshot().bySession[ROOT]

describe('SessionTreeController shallow pass', () => {
  it('reads finished first-level children and labels them by catalog label', async () => {
    const b = bench({
      catalogs: { root: [child('a', { label: 'reviewer' })] },
      pages: { a: [{ events: page('src/app.ts'), hasMore: false }] },
    })
    await b.controller.refresh(ROOT, false)
    const entry = entryOf(b.controller)
    expect(entry?.status).toBe('ready')
    expect(entry?.partial).toBe(false)
    expect(entry?.sources).toHaveLength(1)
    expect(entry?.sources[0]).toMatchObject({ label: 'reviewer' })
    expect(entry?.sources[0]?.files[0]?.segments[0]).toMatchObject({ source: 'reviewer' })
  })

  it('numbers a child the catalog did not name', async () => {
    const b = bench({
      catalogs: { root: [child('a')] },
      pages: { a: [{ events: page('a.ts'), hasMore: false }] },
    })
    await b.controller.refresh(ROOT, false)
    expect(entryOf(b.controller)?.sources[0]?.label).toBe('#1')
  })

  it('leaves running children, diagnostics, deeper levels, and further pages unread', async () => {
    const b = bench({
      catalogs: {
        root: [
          child('running', { activity: 'running' }),
          { kind: 'diagnostic', id: 'broken', reason: 'corrupt' },
          child('deep', { hasChildren: true }),
        ],
      },
      pages: { deep: [{ events: page('deep.ts'), hasMore: true }] },
    })
    await b.controller.refresh(ROOT, false)
    const entry = entryOf(b.controller)
    expect(entry?.partial).toBe(true)
    expect(entry?.sources.map(source => source.sessionId)).toEqual(['deep'])
    // One page per child, and nothing asked of the running one.
    expect(b.history).toHaveBeenCalledTimes(1)
  })

  it('publishes a child that changed nothing without a source row', async () => {
    const b = bench({ catalogs: { root: [child('idle')] } })
    await b.controller.refresh(ROOT, false)
    expect(entryOf(b.controller)?.sources).toEqual([])
  })
})

describe('SessionTreeController deep pass', () => {
  it('recurses the tree, pages each descendant, and names them by ancestry', async () => {
    const b = bench({
      catalogs: {
        root: [child('parent', { label: 'planner', hasChildren: true })],
        parent: [child('grandchild', { label: 'worker' })],
      },
      pages: {
        parent: [
          { events: page('later.ts', 20), hasMore: true },
          { events: page('earlier.ts', 10), hasMore: false },
        ],
        grandchild: [{ events: page('deep.ts'), hasMore: false }],
      },
    })
    await b.controller.refresh(ROOT, true)
    const entry = entryOf(b.controller)
    expect(entry?.partial).toBe(false)
    expect(entry?.sources.map(source => source.label)).toEqual(['planner', 'planner / worker'])
    // Both pages of the parent folded into one read.
    expect(entry?.sources[0]?.files.map(file => file.path)).toEqual(['earlier.ts', 'later.ts'])
  })

  it('reads a running child too, and stops at the page cap', async () => {
    const b = bench({
      catalogs: { root: [child('busy', { activity: 'running' })] },
      // Always more: the cap is what ends this, and it reports the truth.
      pages: { busy: [{ events: page('busy.ts'), hasMore: true }] },
    })
    await b.controller.refresh(ROOT, true)
    expect(entryOf(b.controller)?.partial).toBe(true)
    expect(b.history.mock.calls.length).toBeGreaterThan(1)
  })

  it('stops paging a child whose page carried no older anchor', async () => {
    const b = bench({
      catalogs: { root: [child('empty')] },
      pages: { empty: [{ events: [], hasMore: true }] },
    })
    await b.controller.refresh(ROOT, true)
    expect(entryOf(b.controller)?.partial).toBe(true)
    expect(b.history).toHaveBeenCalledTimes(1)
  })
})

describe('SessionTreeController lifecycle', () => {
  it('shares one operation per session and depth', async () => {
    const b = bench({ catalogs: { root: [child('a')] } })
    const first = b.controller.refresh(ROOT, false)
    expect(b.controller.refresh(ROOT, false)).toBe(first)
    await first
    // A deep request is its own operation, not the shallow one already run.
    expect(b.controller.refresh(ROOT, true)).not.toBe(first)
    await b.controller.refresh(ROOT, true)
  })

  it('keeps what it had and reports a catalog failure', async () => {
    const good = bench({
      catalogs: { root: [child('a', { label: 'kept' })] },
      pages: { a: [{ events: page('a.ts'), hasMore: false }] },
    })
    await good.controller.refresh(ROOT, false)
    expect(entryOf(good.controller)?.sources).toHaveLength(1)

    const failing = bench({ listFails: true })
    await failing.controller.refresh(ROOT, false)
    expect(entryOf(failing.controller)).toMatchObject({ status: 'error', error: 'catalog unavailable', partial: true })
  })

  it('reports a transcript failure', async () => {
    const b = bench({ catalogs: { root: [child('a')] }, historyFails: true })
    await b.controller.refresh(ROOT, false)
    expect(entryOf(b.controller)).toMatchObject({ status: 'error', error: 'gone' })
  })

  it('names the RPC when a failure carried no message, on either call', async () => {
    const listApi = {
      list: () => Promise.resolve({ result: { ok: false, value: { entries: [] } } }),
      history: () => Promise.resolve({ result: { ok: true, value: { events: [], hasMore: false } } }),
    } as unknown as SubagentApi
    const onList = new SessionTreeController(listApi)
    await onList.refresh(ROOT, false)
    expect(entryOf(onList)?.error).toBe('subagent.list failed')

    const historyApi = {
      list: () => Promise.resolve({ result: { ok: true, value: { entries: [child('a')] } } }),
      history: () => Promise.resolve({ result: { ok: false, value: { events: [], hasMore: false }, error: {} } }),
    } as unknown as SubagentApi
    const onHistory = new SessionTreeController(historyApi)
    await onHistory.refresh(ROOT, false)
    expect(entryOf(onHistory)?.error).toBe('subagent.history failed')
  })

  it('reports a rejection that was not an Error', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection is exactly the arm under test
    const api = { list: () => Promise.reject('catalog exploded') } as unknown as SubagentApi
    const controller = new SessionTreeController(api)
    await controller.refresh(ROOT, false)
    expect(entryOf(controller)).toMatchObject({ status: 'error', error: 'catalog exploded' })
  })

  it('publishes nothing for a read the disposal aborted', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const api = {
      list: async () => {
        await gate
        throw new Error('aborted mid-flight')
      },
    } as unknown as SubagentApi
    const controller = new SessionTreeController(api)
    const running = controller.refresh(ROOT, false)
    const disposal = controller.dispose()
    release?.()
    await Promise.all([running, disposal])
    // The loading publication stands; the failure of an aborted read is not news.
    expect(entryOf(controller)).toMatchObject({ status: 'loading' })
  })

  it('goes quiet on disposal and ignores later requests', async () => {
    const b = bench({ catalogs: { root: [child('a')] } })
    const running = b.controller.refresh(ROOT, false)
    await b.controller.dispose()
    await running
    await b.controller.refresh(ROOT, false)
    // The post-disposal request never reached the catalog.
    expect(b.list).toHaveBeenCalledTimes(1)
  })
})
