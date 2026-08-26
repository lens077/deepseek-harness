// @vitest-environment jsdom
// The browser plugin body: both seats registered and released with the fiber,
// the shared rail preference behind their inject faces, the transcript scroll
// `reveal` performs, and the history completion `Load all` drives.

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DelegationFiles, type DelegationFilesInjected } from '../src/client/DelegationFiles.tsx'
import { DiffExpansionRow, type DiffExpansionRowInjected } from '../src/client/DiffExpansionRow.tsx'
import { SessionFilesButton } from '../src/client/SessionFilesButton.tsx'
import { SessionFilesRail } from '../src/client/SessionFilesRail.tsx'
import type { SessionFilesButtonInjected } from '../src/client/SessionFilesButton.tsx'
import type { SessionFilesRailInjected } from '../src/client/SessionFilesRail.tsx'
import { apply, inject, revealFile } from '../src/client/index.ts'
import { RAIL_DEFAULT } from '../src/client/rail-store.ts'

const SID = 'session-files-apply' as SessionId

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
})

/** One settled `edit` whose result recorded a hunk for `path`. */
function changeNode(seq: number, path: string) {
  return {
    kind: 'tool-result', seq, isError: false, call: { name: 'edit', argsRaw: '{}' },
    callView: { card: 'diff', locations: [{ path }] },
    resultView: { card: 'diff', diffs: [{ path, oldText: 'before', newText: 'after' }] },
  }
}

/** A session whose history pages `pages` times before reporting completeness. */
function fakeSession(pages: number, nodes: readonly unknown[] = []) {
  let remaining = pages
  return {
    getSnapshot: () => ({
      hasMore: remaining > 0,
      nodes,
      runningCalls: [],
      running: false,
      chat: { timeline: { turnOrder: [1], turns: new Map([[1, { start: { seq: 0 } }]]) } },
    }),
    loadOlder: vi.fn(() => {
      remaining--
      return Promise.resolve()
    }),
  }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'conversation.session.tabs.leading': { kind: 'list', scope: 'session' },
      'conversation.session.rail': { kind: 'single', scope: 'session' },
      'tool.call.tail': { kind: 'list', scope: 'session' },
      'settings.general.item': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

// `null`, not `undefined`: an omitted argument takes the default, so a spec
// asking for "no session" with `undefined` would silently get one.
async function bench(session: ReturnType<typeof fakeSession> | null = fakeSession(0)) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('sessions', { binding: () => (session === null ? undefined : { session }) })
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope })
  ctx.provide('connection', {
    api: {
      subagents: {
        list: () => Promise.resolve({ result: { ok: true, value: { entries: [] } } }),
        history: () => Promise.resolve({ result: { ok: true, value: { events: [], hasMore: false } } }),
      },
    },
  })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber, session }
}

/** The descendant store behind the rail seat, for identity comparisons. */
function railFaceTree(b: { slots: SlotRegistry }): unknown {
  const rail = b.slots.entries('conversation.session.rail')[0]
  return (rail?.inject as unknown as (id: SessionId) => SessionFilesRailInjected)(SID).hooks.tree
}

describe('session-files browser plugin', () => {
  it('takes both seats and releases them with the fiber', async () => {
    const b = await bench()
    expect(inject).toEqual(['sessions', 'slots', 'locale', 'settingsScope', 'connection'])

    const button = b.slots.entries('conversation.session.tabs.leading')[0]
    expect(button?.component).toBe(SessionFilesButton)
    expect(button?.options).toMatchObject({ id: 'session-files' })
    expect(b.slots.entries('conversation.session.rail')[0]?.component).toBe(SessionFilesRail)

    const tail = b.slots.entries('tool.call.tail')[0]
    expect(tail?.component).toBe(DelegationFiles)
    expect(tail?.options).toMatchObject({ id: 'session-files-delegation' })
    const tailFace = (tail?.inject as unknown as () => DelegationFilesInjected)()
    expect(tailFace.hooks.tree).toBe(railFaceTree(b))
    expect(tailFace.label({ turn: 2, tool: 'edit', source: 'reviewer' })).toBe('reviewer · Turn 2 · edit')

    await b.fiber.dispose()
    expect(b.slots.entries('conversation.session.tabs.leading')).toHaveLength(0)
    expect(b.slots.entries('conversation.session.rail')).toHaveLength(0)
    expect(b.slots.entries('tool.call.tail')).toHaveLength(0)
  })

  it('takes the General settings seat and writes the expansion preference through it', async () => {
    const b = await bench()
    const row = b.slots.entries('settings.general.item')[0]
    expect(row?.component).toBe(DiffExpansionRow)
    expect(row?.options).toMatchObject({ id: 'session-files-diff-expansion' })

    const face = (row?.inject as unknown as () => DiffExpansionRowInjected)()
    expect(face.hooks.diffExpansion.getSnapshot()).toBe('all')
    face.setDiffExpansion('single')
    // The transcript reads the same source the Settings row writes.
    expect(b.ctx.chatFileDiffs.expansion.getSnapshot()).toBe('single')

    await b.fiber.dispose()
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)
  })

  it('shares one rail preference between the control and the pane', async () => {
    const b = await bench()
    const buttonFace = (b.slots.entries('conversation.session.tabs.leading')[0]?.inject as unknown as () => SessionFilesButtonInjected)()
    const railFace = (b.slots.entries('conversation.session.rail')[0]?.inject as unknown as (id: SessionId) => SessionFilesRailInjected)(SID)

    expect(railFace.hooks.rail.getSnapshot()).toEqual({ open: true, width: RAIL_DEFAULT })
    buttonFace.toggle()
    // The pane reads the write the control made: one preference, two seats.
    expect(railFace.hooks.rail.getSnapshot().open).toBe(false)
    railFace.setWidth(1000)
    expect(buttonFace.hooks.rail.getSnapshot().width).toBe(560)
  })

  it('pages the remaining history until the session reports none', async () => {
    const session = fakeSession(3)
    const b = await bench(session)
    const railFace = (b.slots.entries('conversation.session.rail')[0]?.inject as unknown as (id: SessionId) => SessionFilesRailInjected)(SID)
    railFace.loadAll()
    await vi.waitFor(() => { expect(session.loadOlder).toHaveBeenCalledTimes(3) })
  })

  it('reads the finished descendants when the panel opens', async () => {
    const b = await bench()
    const railFace = (b.slots.entries('conversation.session.rail')[0]?.inject as unknown as (id: SessionId) => SessionFilesRailInjected)(SID)
    railFace.loadTree()
    await vi.waitFor(() => {
      expect(railFace.hooks.tree.getSnapshot().bySession[SID]?.status).toBe('ready')
    })
  })

  it('stops paging when the session is gone', async () => {
    const b = await bench(null)
    const railFace = (b.slots.entries('conversation.session.rail')[0]?.inject as unknown as (id: SessionId) => SessionFilesRailInjected)(SID)
    // Resolves rather than looping or throwing: a mid-load navigation is not an error.
    expect(() => { railFace.loadAll() }).not.toThrow()
  })
})

describe('the chatFileDiffs face', () => {
  it('answers with this session\'s hunks for a changed path, labelled by turn and tool', async () => {
    const b = await bench(fakeSession(0, [changeNode(10, 'src/app.ts')]))
    expect(b.ctx.chatFileDiffs.forPath(SID, 'src/app.ts')).toEqual([
      { label: 'Turn 1 · edit', oldText: 'before', newText: 'after' },
    ])
  })

  it('answers empty for a path this session never changed', async () => {
    const b = await bench(fakeSession(0, [changeNode(10, 'src/app.ts')]))
    expect(b.ctx.chatFileDiffs.forPath(SID, 'src/other.ts')).toEqual([])
  })

  it('answers empty once the session is gone', async () => {
    const b = await bench(null)
    expect(b.ctx.chatFileDiffs.forPath(SID, 'src/app.ts')).toEqual([])
  })

  it('leaves with the fiber, so composing the plugin out turns the surface off', async () => {
    const b = await bench(fakeSession(0, [changeNode(10, 'src/app.ts')]))
    await b.fiber.dispose()
    expect(b.ctx.get('chatFileDiffs')).toBeUndefined()
  })
})

describe('revealFile', () => {
  it('scrolls to the last row carrying the path, and does nothing without one', () => {
    const scrolls: string[] = []
    document.body.innerHTML = `
      <div data-file="a.ts" id="first"></div>
      <div data-file="b.ts" id="other"></div>
      <div data-file="a.ts" id="last"></div>
    `
    for (const node of document.querySelectorAll('[data-file]')) {
      ;(node as HTMLElement).scrollIntoView = () => { scrolls.push(node.id) }
    }

    revealFile('a.ts')
    expect(scrolls).toEqual(['last'])
    // A file changed outside the loaded window has no row; the call is inert.
    revealFile('missing.ts')
    expect(scrolls).toEqual(['last'])
  })
})
