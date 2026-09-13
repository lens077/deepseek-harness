/** Controller wire behavior: host-base resolution, availability filtering, and launch errors. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenInAppController, OpenInAppLaunchError } from '../src/client/controller.ts'
import { SIDEBAR_CHOICE } from '../src/client/locales.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status })
}

describe('OpenInAppController availability', () => {
  it('starts without a platform-specific choice', () => {
    const controller = new OpenInAppController(async () => jsonResponse({ apps: [] }))
    expect(controller.choice.getSnapshot()).toBe('')
  })

  it('shares one availability read across concurrent loads', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ apps: ['finder'] }))
    const controller = new OpenInAppController(fetcher)
    await Promise.all([controller.load(), controller.load()])
    await controller.load()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(controller.apps.getSnapshot()).toEqual(['finder'])
  })

  it('publishes an empty list for a non-OK availability answer and for a non-array payload', async () => {
    const failing = new OpenInAppController(async () => jsonResponse({}, 500))
    await failing.load()
    expect(failing.apps.getSnapshot()).toEqual([])

    const malformed = new OpenInAppController(async () => jsonResponse({ apps: 'nope' }))
    await malformed.load()
    expect(malformed.apps.getSnapshot()).toEqual([])
  })

  it('resolves routes against the page origin when the page has one', async () => {
    vi.stubGlobal('location', { origin: 'http://dsh.example:8080' })
    const fetcher = vi.fn(async (input: string | URL) => { void input; return jsonResponse({ apps: [] }) })
    const controller = new OpenInAppController(fetcher)
    await controller.load()
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('http://dsh.example:8080/open-in-app/apps')
  })

  it('falls back to the internal host base under a null origin', async () => {
    vi.stubGlobal('location', { origin: 'null' })
    const fetcher = vi.fn(async (input: string | URL) => { void input; return jsonResponse({ apps: [] }) })
    const controller = new OpenInAppController(fetcher)
    await controller.load()
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('http://dsh.internal/open-in-app/apps')
  })
})

describe('OpenInAppController launching', () => {
  it('restores the chosen app from the open-in-app storage key', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    })
    const controller = new OpenInAppController(async () => jsonResponse({ apps: [] }))
    controller.choose('cursor')
    expect(controller.choice.getSnapshot()).toBe('cursor')
    expect(values.get('dsh.open-in-app.choice')).toBe('"cursor"')
    const reloaded = new OpenInAppController(async () => jsonResponse({ apps: [] }))
    expect(reloaded.choice.getSnapshot()).toBe('cursor')
  })

  it('posts the launch body and surfaces HTTP failures', async () => {
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => { void input; void init; return jsonResponse({ ok: true }) })
    const controller = new OpenInAppController(fetcher)
    await controller.launch('cursor', '/w/dir')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: 'cursor', path: '/w/dir' }),
    })

    const failing = new OpenInAppController(async () => jsonResponse({}, 404))
    await expect(failing.launch('cursor', '/w/dir')).rejects.toThrow('open failed: HTTP 404')
  })

  it('carries the host failure message and a stable code on a refused launch', async () => {
    const refusing = new OpenInAppController(async () => jsonResponse({ code: 'launch-failed', message: 'failed to launch cursor' }, 502))
    const error = await refusing.launch('cursor', '/w/file.ts').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(OpenInAppLaunchError)
    expect(error).toMatchObject({ code: 'launch-failed', appId: 'cursor', message: 'failed to launch cursor' })
  })
})

describe('OpenInAppController file target', () => {
  it('is pending until the host answered, then defaults to the first offered app', async () => {
    const controller = new OpenInAppController(async () => jsonResponse({ apps: ['finder', 'cursor'] }))
    expect(controller.fileTarget()).toEqual({ kind: 'pending' })
    await controller.load()
    expect(controller.fileTarget()).toEqual({ kind: 'app', appId: 'finder' })
  })

  it('follows the remembered app while the host offers it and reports it when it does not', async () => {
    const controller = new OpenInAppController(async () => jsonResponse({ apps: ['finder', 'cursor'] }))
    await controller.load()
    controller.choose('cursor')
    expect(controller.fileTarget()).toEqual({ kind: 'app', appId: 'cursor' })
    controller.choose('zed')
    expect(controller.fileTarget()).toEqual({ kind: 'not-installed', appId: 'zed' })
  })

  it('names the Sidebar and an empty host separately', async () => {
    const controller = new OpenInAppController(async () => jsonResponse({ apps: [] }))
    await controller.load()
    expect(controller.fileTarget()).toEqual({ kind: 'unavailable' })
    controller.choose(SIDEBAR_CHOICE)
    expect(controller.fileTarget()).toEqual({ kind: 'sidebar' })
  })

  it('openFile waits for availability and launches the default app on the file', async () => {
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      void init
      return String(input).includes('/open-in-app/apps') ? jsonResponse({ apps: ['explorer', 'vscode'] }) : jsonResponse({ ok: true })
    })
    const controller = new OpenInAppController(fetcher)
    await controller.openFile('C:\\w\\a.ts')
    const openCall = fetcher.mock.calls.find(call => String(call[0]).includes('/open-in-app/open'))
    expect(openCall?.[1]).toMatchObject({ body: JSON.stringify({ app: 'explorer', path: 'C:\\w\\a.ts' }) })
  })

  it('openFile refuses a remembered app the host no longer offers, the Sidebar, and an empty host', async () => {
    const controller = new OpenInAppController(async () => jsonResponse({ apps: ['finder'] }))
    controller.choose('cursor')
    await expect(controller.openFile('/w/a.ts')).rejects.toMatchObject({ code: 'not-installed', appId: 'cursor' })
    controller.choose(SIDEBAR_CHOICE)
    await expect(controller.openFile('/w/a.ts')).rejects.toMatchObject({ code: 'unavailable' })
    const empty = new OpenInAppController(async () => jsonResponse({ apps: [] }))
    await expect(empty.openFile('/w/a.ts')).rejects.toMatchObject({ code: 'unavailable' })
  })
})
