// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { buildRenderApp } from '../src/client/app.tsx'
import { createDocumentBadge } from '../src/client/DocumentTitle.tsx'

let runtime: SlotTestRuntime | undefined

afterEach(async () => {
  cleanup()
  await runtime?.dispose()
  runtime = undefined
  document.title = ''
  vi.unstubAllEnvs()
})

async function bench() {
  runtime = await SlotTestRuntime.create()
  await runtime.root.declare({}, () => <div data-testid="frame" />)
  const badge = createDocumentBadge()
  return { runtime, badge, renderApp: buildRenderApp({ ctx: runtime.ctx, badge }) }
}

describe('buildRenderApp', () => {
  it('fails loud when the sessions service is unavailable', () => {
    expect(() => buildRenderApp({ ctx: new Context(), badge: createDocumentBadge() })).toThrow('sessions service unavailable')
  })

  it('renders the root slot tree', async () => {
    const b = await bench()
    const view = render(<>{b.renderApp()}</>)
    expect(view.getByTestId('frame')).toBeTruthy()
  })

  it('projects the selected durable session title', async () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    document.title = 'stale title'
    const b = await bench()
    render(<>{b.renderApp()}</>)
    expect(document.title).toBe('Product')
    await b.runtime.sessions.add({ id: 's1', summary: { title: 'First' } })
    expect(document.title).toBe('First — Product')
    await b.runtime.sessions.setCurrent(undefined)
    expect(document.title).toBe('Product')
    await b.runtime.sessions.add({ id: 's2' })
    expect(document.title).toBe('Product')
  })

  it('prefixes the attention count reported through the badge seat', async () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    const b = await bench()
    render(<>{b.renderApp()}</>)
    expect(document.title).toBe('Product')
    act(() => { b.badge.set(3) })
    expect(document.title).toBe('(3) Product')
    await b.runtime.sessions.add({ id: 's1', summary: { title: 'First' } })
    expect(document.title).toBe('(3) First — Product')
    act(() => { b.badge.set(3) })
    act(() => { b.badge.set(0) })
    expect(document.title).toBe('First — Product')
  })

  it('marks the title while any session runs, and latches a run finished away', async () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const b = await bench()
    await b.runtime.sessions.add({ id: 's1', summary: { title: 'First', running: true } })
    render(<>{b.renderApp()}</>)
    expect(document.title).toBe('● First — Product')

    // Finishing while the reader is watching needs no marker.
    b.runtime.sessions.list.update((draft) => { draft.byId['s1' as SessionId]!.running = false })
    await b.runtime.flush()
    expect(document.title).toBe('First — Product')

    // Finishing while the tab is hidden is the event they came back for.
    b.runtime.sessions.list.update((draft) => { draft.byId['s1' as SessionId]!.running = true })
    await b.runtime.flush()
    hidden.mockReturnValue(true)
    b.runtime.sessions.list.update((draft) => { draft.byId['s1' as SessionId]!.running = false })
    await b.runtime.flush()
    expect(document.title).toBe('✓ First — Product')

    // The visit that delivers the mark clears it.
    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    await b.runtime.flush()
    expect(document.title).toBe('First — Product')
    hidden.mockRestore()
  })

  it('counts every session, not only the selected one', async () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    const b = await bench()
    await b.runtime.sessions.add({ id: 's1', summary: { title: 'First' } })
    await b.runtime.sessions.add({ id: 's2', summary: { title: 'Second', running: true } })
    await b.runtime.sessions.setCurrent('s1')
    render(<>{b.renderApp()}</>)
    expect(document.title).toBe('● First — Product')
  })

  it('falls back when the selected id has no list row', async () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    document.title = 'stale title'
    const b = await bench()
    await b.runtime.sessions.add({ id: 's1', summary: { title: 'First' } })
    render(<>{b.renderApp()}</>)
    expect(document.title).toBe('First — Product')
    b.runtime.sessions.list.update((draft) => { draft.current = 'ghost' as SessionId })
    await b.runtime.flush()
    expect(document.title).toBe('Product')
  })
})
