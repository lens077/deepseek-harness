// @vitest-environment jsdom
// apply wiring: the conversation service provided, the chat view registered
// as the first 'conversation.view' ring entry declaring the whole-Tool seat,
// the slot registrations land against a root entry's children declarations
// (the AppFrame role), and the shared store handle rides all strict session
// entries. Tool composition belongs to ui-tool and its machinery spec.

import { describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime, usePinnedBrowserLanguages, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-conversation/client'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

const ROOT = 'root-1' as SessionId
const CHILD = 'child-1' as SessionId

async function bench() {
  const runtime = await SlotTestRuntime.create()
  runtime.provide('connection', { api: { settings: {} }, isLoopback: false })
  // The plugin injects both; these specs exercise no settings path.
  runtime.provide('remote', { $on: () => () => {} })
  runtime.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await runtime.sessions.add({ id: ROOT, summary: { title: 'R', displayTitle: 'R' } }, { current: false })
  await runtime.sessions.add(
    { id: CHILD, summary: { title: 'C', displayTitle: 'C', parentId: ROOT } }, { current: false })
  runtime.provide('layout', { openDetails: vi.fn(), closeDetails: vi.fn() })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.slots.installLocale(locale)

  // Declared by ui-layout's root entry in production; the test root declares
  // them here so the contributions land.
  await runtime.root.declare({
    'conversation': { kind: 'single', scope: 'session-maybe' },
    'details': { kind: 'single', scope: 'session' },
    'settings.general.item': { kind: 'list', scope: 'root' },
  }, (_p: { renderSlot?: unknown }) => null)

  const feature = await runtime.mount({ inject: [...inject], apply })
  return { runtime, feature, slots: runtime.slots }
}

/** First stored entry for a key (inject/store live directly on StoredEntry). */
function renderEntryOf(slots: Awaited<ReturnType<typeof bench>>['slots'], key: 'conversation' | 'conversation.session' | 'conversation.session.header' | 'conversation.view' | 'details') {
  return slots.entries(key)[0] as undefined | { inject?: unknown; store?: unknown }
}

describe('apply wiring', () => {
  it('provides the conversation service', async () => {
    const b = await bench()
    expect(b.runtime.ctx.get('conversation')).toBeDefined()
    await b.runtime.dispose()
  })

  it('registers the chat view and its keyed business-node seat', async () => {
    const b = await bench()
    const entries = b.slots.entries('conversation.view')
    expect(entries.map(e => e.options.id)).toEqual(['chat'])
    // Label is a locale thunk resolving through the zh dictionary.
    expect(resolveSlotLabel(entries[0]?.options.label)).toBe('对话')
    expect(entries[0]?.options.order).toBe(0)
    // Declaring is claiming: the chat entry's registration put the hole on
    // the ledger with the contract's kind/scope.
    const nodeSlot = b.slots.spec('conversation.chat.node')
    expect(nodeSlot).toMatchObject({ kind: 'keyed', scope: 'session' })
    expect(nodeSlot?.inject?.hooks?.turnData).toBeTypeOf('function')
    await b.runtime.dispose()
  })

  it('occupies the slots + the ring; session entries share one store handle', async () => {
    const b = await bench()
    const conversation = renderEntryOf(b.slots, 'conversation')
    const conversationSession = renderEntryOf(b.slots, 'conversation.session')
    const conversationHeader = renderEntryOf(b.slots, 'conversation.session.header')
    const chatView = renderEntryOf(b.slots, 'conversation.view')
    const details = renderEntryOf(b.slots, 'details')
    expect(conversation?.inject).toBeTypeOf('function')
    expect(chatView?.inject).toBeTypeOf('function')
    expect(details?.inject).toBeTypeOf('function')
    // The shared handle: one apply-built store value on ALL session entries
    // (the session-maybe 'conversation' shell carries no store by design).
    expect(conversationSession?.store).toBeDefined()
    expect(conversationHeader?.store).toBe(conversationSession?.store)
    expect(details?.store).toBe(conversationSession?.store)
    expect(chatView?.store).toBe(conversationSession?.store)
    // The hero holes ride the conversation entry's children declaration (the
    // empty-state occupant is gone). Both are root-scoped: the new-session
    // screen precedes the session either would belong to.
    expect(b.slots.spec('conversation.hero.brand.mark')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('conversation.hero.workspace')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('conversation.hero.agentPreset')).toEqual({ kind: 'single', scope: 'root' })
    expect(b.slots.spec('conversation.session.header.lineage'))
      .toEqual({ kind: 'single', scope: 'session' })
    expect(b.slots.entries('settings.general.item').map(entry => entry.options.id)).toEqual([
      'composer-enter', 'question-shortcuts',
    ])
    await b.runtime.dispose()
  })

  it('gives the chat view a session-wide question search, not the loaded window', async () => {
    const b = await bench()
    b.runtime.sessions.stubSearchQuestions((_sessionId, _query, _signal) => ({
      items: [{ seq: 4, time: 1_004, snippet: 'a question the window never loaded' }],
      complete: false,
    }))
    const chatView = renderEntryOf(b.slots, 'conversation.view') as {
      inject: (sessionId: SessionId, actions: unknown) => { searchQuestions?: unknown }
    }
    const injected = chatView.inject(ROOT, { select: vi.fn() })
    const searchQuestions = injected.searchQuestions as (
      query: string, signal?: AbortSignal,
    ) => Promise<{ hits: unknown[]; complete: boolean }>
    expect(searchQuestions).toBeTypeOf('function')

    const page = await searchQuestions('question')

    // The host answered for the whole session, and its partial flag survives:
    // the navigator can only disclose an incomplete page if it is told.
    expect(page).toEqual({
      hits: [{ seq: 4, time: 1_004, snippet: 'a question the window never loaded' }],
      complete: false,
    })
    const call = b.runtime.sessions.calls.at(-1)
    expect(call?.method).toBe('searchQuestions')
    expect(call?.args.slice(0, 2)).toEqual([ROOT, 'question'])
    await b.runtime.dispose()
  })

  it('surfaces a rejected question search instead of folding it into no matches', async () => {
    const b = await bench()
    b.runtime.sessions.searchQuestions = () => Promise.resolve({
      ok: false, error: { code: 'internal', message: 'index unavailable', details: {} },
    }) as ReturnType<typeof b.runtime.sessions.searchQuestions>
    const chatView = renderEntryOf(b.slots, 'conversation.view') as {
      inject: (sessionId: SessionId, actions: unknown) => { searchQuestions?: unknown }
    }
    const injected = chatView.inject(ROOT, { select: vi.fn() })
    const searchQuestions = injected.searchQuestions as (query: string) => Promise<unknown>

    // A failed search must reject: an empty page would read as "nothing
    // matches", which is the defect this whole path exists to remove.
    await expect(searchQuestions('question')).rejects.toThrow('index unavailable')
    await b.runtime.dispose()
  })

  it('leaves per-Tool rows to the ui-tool plugin', async () => {
    const b = await bench()
    // The actual toolview declaration activates every registrant. The
    // file-mutation registrant claims both write and edit for the diff card; the
    // one search row registers under both grep and glob; the web rows register
    // one component under both web tool names.
    expect(b.slots.entries('conversation.chat.node').map(entry => entry.options.key)).not.toContain('tool-call')
    // Stats stick with the composer (not inside ChatView).
    expect(b.slots.entries('conversation.composer.dock').map(e => e.options.id)).toEqual(['stats'])
    await b.runtime.dispose()
  })

  it('plugin fiber disposal collects every registration (unload cascade, ring and hole included)', async () => {
    const b = await bench()
    await b.feature.dispose()
    expect(b.slots.entries('conversation')).toHaveLength(0)
    // The declared ring collapses with its declaring entry, and the chat
    // entry's keyed hole (with the sample's registration) collapses with it.
    expect(b.slots.entries('conversation.view')).toHaveLength(0)
    expect(b.slots.entries('conversation.chat.node')).toHaveLength(0)
    expect(b.slots.spec('conversation.chat.node')).toBeUndefined()
    expect(b.slots.entries('details')).toHaveLength(0)
    expect(b.slots.entries('settings.general.item')).toHaveLength(0)
    expect(b.runtime.ctx.get('conversation')).toBeUndefined()
    await b.runtime.dispose()
  })
})
