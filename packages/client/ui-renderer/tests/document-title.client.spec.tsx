// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DocumentTitle, createDocumentBadge } from '../src/client/DocumentTitle.tsx'

afterEach(() => {
  cleanup()
  document.title = ''
  vi.unstubAllEnvs()
})

describe('DocumentTitle', () => {
  it('projects a durable title and restores the product title', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'DeepSeek Harness')
    document.title = 'stale title'
    const mounted = render(<DocumentTitle />)
    expect(document.title).toBe('DeepSeek Harness')
    mounted.rerender(<DocumentTitle title="First title" />)
    expect(document.title).toBe('First title — DeepSeek Harness')
    mounted.rerender(<DocumentTitle title="Revised title" />)
    expect(document.title).toBe('Revised title — DeepSeek Harness')
    mounted.rerender(<DocumentTitle />)
    expect(document.title).toBe('DeepSeek Harness')
    mounted.unmount()
    expect(document.title).toBe('DeepSeek Harness')
  })

  it('prefixes a positive badge before the run mark and hides zero', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'DeepSeek Harness')
    const mounted = render(<DocumentTitle title="Long job" status="running" badge={2} />)
    expect(document.title).toBe('(2) ● Long job — DeepSeek Harness')
    mounted.rerender(<DocumentTitle badge={0} />)
    expect(document.title).toBe('DeepSeek Harness')
  })

  it('publishes a badge count once per change', () => {
    const badge = createDocumentBadge()
    const seen: number[] = []
    const stop = badge.subscribe(() => { seen.push(badge.getSnapshot()) })
    badge.set(2)
    badge.set(2)
    badge.set(0)
    stop()
    badge.set(5)
    expect(seen).toEqual([2, 0])
    expect(badge.getSnapshot()).toBe(5)
  })

  it('marks the title while work runs and when work finished away', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'DeepSeek Harness')
    const mounted = render(<DocumentTitle title="Long job" status="running" />)
    expect(document.title).toBe('● Long job — DeepSeek Harness')
    mounted.rerender(<DocumentTitle title="Long job" status="done" />)
    expect(document.title).toBe('✓ Long job — DeepSeek Harness')
    mounted.rerender(<DocumentTitle title="Long job" />)
    expect(document.title).toBe('Long job — DeepSeek Harness')
  })

  it('marks the product title too, so a title-less session still reports its run', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'DeepSeek Harness')
    render(<DocumentTitle status="running" />)
    expect(document.title).toBe('● DeepSeek Harness')
  })

  it('uses the generic title when the build provides no title', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', '')
    delete process.env.DSH_CLIENT_TITLE
    const mounted = render(<DocumentTitle title="First title" />)
    expect(document.title).toBe('First title — DSH Local Build')
    mounted.unmount()
    expect(document.title).toBe('DSH Local Build')
  })
})
