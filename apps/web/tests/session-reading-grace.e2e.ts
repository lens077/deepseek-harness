/** Reading grace over recorded replies, real inbox marks, and the shipped browser composition. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, beforeEach, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-digest'
import type {} from '@deepseek-ai/dsh-session-inbox'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/session-reading-grace', import.meta.url))
const SEED = fileURLToPath(new URL('../../../snapshots/web/navigation-panes/session.v3.jsonl', import.meta.url))
const MODE = webSnapshotMode()
const AUTO_ID = 'reading-grace-auto' as SessionId
const MANUAL_ID = 'reading-grace-manual' as SessionId
const PINNED = 'section[aria-label="Pinned sessions"]'
const LATEST_ANSWER = '[data-chat-flow-kind="assistant-step"][data-chat-turn="2"]'

async function warmDigest(scaffold: WebScaffold, id: SessionId): Promise<number> {
  const reader = await scaffold.ctx.sessionPersistence.open(id, 'read')
  try {
    const { events } = await reader.read()
    const snapshot = scaffold.ctx.sessionProjectionCache.coldSnapshot(reader.header, reader.inheritedEventCount, [...events])
    const digest = snapshot.values.sessionDigest
    if (digest?.outcome !== 'completed' || digest.replySeq == null) throw new Error('reading seed must have a completed reply')
    return digest.replySeq
  } finally {
    await reader.close()
  }
}

async function scrollTranscript(page: Page, position: 'start' | 'end'): Promise<void> {
  await page.locator('[data-conversation-scroll]').evaluate(async (element, target) => {
    const top = target === 'start' ? 0 : element.scrollHeight - element.clientHeight
    if (Math.abs(element.scrollTop - top) < 1) return
    await new Promise<void>((resolve) => {
      element.addEventListener('scroll', () => { resolve() }, { once: true })
      element.scrollTo({ top, behavior: 'instant' })
    })
  }, position)
}

async function answerInViewport(page: Page): Promise<boolean> {
  const answer = page.locator(LATEST_ANSWER)
  if (await answer.count() === 0) return false
  return await answer.evaluate((element) => {
    const scroll = element.closest('[data-conversation-scroll]')
    if (scroll === null) return false
    const heading = element.querySelector('h2')
    if (heading === null) return false
    const viewport = scroll.getBoundingClientRect()
    const rect = heading.getBoundingClientRect()
    const x = (rect.left + rect.right) / 2
    const y = (rect.top + rect.bottom) / 2
    const hit = document.elementFromPoint(x, y)
    return rect.top >= viewport.top && rect.bottom <= viewport.bottom && hit !== null && heading.contains(hit)
  })
}

describe.skipIf(MODE === 'record')('web e2e: Session reading grace', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let replySeq: number
  let holdHistory: SessionId | undefined
  let heldHistory: (() => void)[] = []
  let seenRequests: unknown[] = []

  const world = (): WebScaffold => {
    if (scaffold === undefined) throw new Error('reading scaffold is not ready')
    return scaffold
  }
  const mark = (id: SessionId) => world().ctx.sessionInbox.get().sessions.find(item => item.sessionId === id)
  const seen = (id: SessionId) => mark(id)?.lastSeenSeq ?? null
  const pinnedRow = (id: SessionId): Locator => page.locator(`${PINNED} [role="treeitem"][data-session-id="${id}"]`)
  const releaseHistory = (): void => {
    holdHistory = undefined
    for (const send of heldHistory.splice(0)) send()
  }
  const advance = async (milliseconds: number): Promise<void> => {
    await page.clock.runFor(milliseconds)
    await page.evaluate(() => {})
  }
  const expectPinsRetained = async (): Promise<void> => {
    expect(await page.locator(`${PINNED} [role="treeitem"]`).evaluateAll(rows => rows.map(row => row.getAttribute('data-session-id'))))
      .toEqual([AUTO_ID, MANUAL_ID])
    expect(mark(MANUAL_ID)?.pinned).toBe(true)
    expect(mark(AUTO_ID)?.handledAt ?? null).toBeNull()
    expect(mark(MANUAL_ID)?.handledAt).toBeNull()
  }
  const exposeAnswer = async (): Promise<void> => {
    await page.getByRole('heading', { name: 'Navigation Summary', exact: true }).waitFor({ timeout: 15_000 })
    await scrollTranscript(page, 'end')
    await expect.poll(() => answerInViewport(page)).toBe(true)
    await page.bringToFront()
    expect(await page.evaluate(() => ({ visible: document.visibilityState, focused: document.hasFocus() })))
      .toEqual({ visible: 'visible', focused: true })
    await advance(32)
  }

  beforeEach(async () => {
    scaffold = await launchWebScaffold({})
    const raw = await readFile(SEED, 'utf8')
    const createdAt = Date.now() - 60_000
    await seedSession(scaffold, raw, MANUAL_ID, undefined, { createdAt: createdAt - 1 })
    await seedSession(scaffold, raw, AUTO_ID, undefined, { createdAt })
    replySeq = await warmDigest(scaffold, AUTO_ID)
    expect(await warmDigest(scaffold, MANUAL_ID)).toBe(replySeq)
    await scaffold.ctx.sessionInbox.setPinned({ sessionId: MANUAL_ID, pinned: true })
    await scaffold.ctx.settings.mutate('session-pins', [
      { op: 'set', path: ['enabled'], value: true },
      { op: 'set', path: ['sidebarArea'], value: true },
      { op: 'set', path: ['autoPinStatuses'], value: ['running', 'completed'] },
    ])
    expect(scaffold.ctx.settings.get('ui-digest')).toMatchObject({ readAcknowledgement: 'automatic', readGraceSeconds: 5 })
    holdHistory = undefined
    heldHistory = []
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 600)
    tripwire = watchConsole(page)
    seenRequests = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/sessionInbox/markSeen') seenRequests.push(request.postDataJSON())
    })
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-reading-grace'))
    // Delay only the selected Session's real follow snapshot, retaining all Host-produced bytes.
    await page.routeWebSocket('**/api/remote.mux', (route) => {
      const server = route.connectToServer()
      const delayedStreams = new Set<string>()
      server.onMessage((message) => {
        const frame = JSON.parse(String(message)) as {
          type: string
          streamId: string
          value?: { type?: string; header?: { id?: string } }
        }
        if (holdHistory !== undefined && frame.type === 'item'
          && frame.value?.type === 'snapshot' && frame.value.header?.id === holdHistory) {
          delayedStreams.add(frame.streamId)
        }
        if (holdHistory !== undefined && delayedStreams.has(frame.streamId)) {
          heldHistory.push(() => { route.send(message) })
          return
        }
        route.send(message)
      })
    })
    await page.clock.install()
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByText('Ungrouped', { exact: true }).waitFor({ timeout: 30_000 })
    await pinnedRow(AUTO_ID).waitFor({ timeout: 15_000 })
    await pinnedRow(MANUAL_ID).waitFor({ timeout: 15_000 })
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100))
    expect(seen(AUTO_ID)).toBeNull()
    expect(seen(MANUAL_ID)).toBeNull()
  })

  afterEach(async ({ task }) => {
    const failures: unknown[] = []
    if (task.result?.state === 'fail' && browser !== undefined) await saveFailureShot(page, 'web-e2e-session-reading-grace')
    try {
      if (tripwire !== undefined) expect(tripwire).toEqual({ warnings: [], pageErrors: [] })
    } catch (error) {
      failures.push(error)
    }
    holdHistory = undefined
    heldHistory = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    browser = undefined
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    scaffold = undefined
    if (failures.length > 0) throw new AggregateError(failures, 'reading grace cleanup failed')
  })

  it('requires five continuous seconds of the rendered Chat answer, not a digest preview or loading route', async () => {
    await page.getByRole('button', { name: /^Digest/ }).click()
    const digest = page.getByRole('region', { name: 'Digest', exact: true })
    const card = digest.locator(`[data-session-id="${AUTO_ID}"]`)
    await card.getByText(/^## Navigation Summary/).waitFor()
    await advance(10_000)
    expect(seen(AUTO_ID)).toBeNull()
    expect(seen(MANUAL_ID)).toBeNull()

    holdHistory = AUTO_ID
    await card.getByRole('button', { name: 'Open session', exact: true }).click()
    await expect.poll(() => heldHistory.length).toBeGreaterThan(0)
    expect(await page.getByRole('heading', { name: 'Navigation Summary', exact: true }).count()).toBe(0)
    await advance(10_000)
    expect(seen(AUTO_ID)).toBeNull()
    await expectPinsRetained()
    releaseHistory()
    await exposeAnswer()
    await advance(4_000)
    expect(seen(AUTO_ID)).toBeNull()
    await advance(1_000)
    await expect.poll(() => seen(AUTO_ID)).toBe(replySeq)
    expect(seen(MANUAL_ID)).toBeNull()
    await expectPinsRetained()
    expect(await page.getByRole('button', { name: 'Mark as viewed', exact: true }).count()).toBe(0)

    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'pins-retained.expected.md'), await captureStableAria(page, PINNED, world().workspaceCwd, { normalizeAge: true }), MODE)
    await page.getByRole('button', { name: /^Digest/ }).click()
    const seenSection = page.locator('[data-digest-panel] [data-section="seen"]')
    await seenSection.getByRole('heading', { name: 'Seen, not handled 1' }).waitFor()
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'seen-unhandled.expected.md'), await captureStableAria(page, '[data-digest-panel] [data-section="seen"]', world().workspaceCwd), MODE)
    await assertFixtureInventory(SNAPSHOT_DIR, ['pins-retained.expected.md', 'seen-unhandled.expected.md'])
  })

  it('resets on navigation, Settings cover, and offscreen answers without consuming another Session or older reply', async () => {
    await pinnedRow(AUTO_ID).click()
    await exposeAnswer()
    await advance(3_000)
    await pinnedRow(MANUAL_ID).click()
    await exposeAnswer()
    await advance(3_000)
    expect(seen(AUTO_ID)).toBeNull()
    expect(seen(MANUAL_ID)).toBeNull()
    await pinnedRow(AUTO_ID).click()
    await exposeAnswer()
    await advance(3_000)
    expect(seen(AUTO_ID)).toBeNull()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.waitFor()
    await advance(10_000)
    expect(seen(AUTO_ID)).toBeNull()
    await settings.getByRole('button', { name: 'Close', exact: true }).click()
    await exposeAnswer()
    await advance(3_000)
    expect(seen(AUTO_ID)).toBeNull()

    await scrollTranscript(page, 'start')
    await advance(32)
    await expect.poll(() => answerInViewport(page)).toBe(false)
    expect(await page.getByText('FIRST_DONE', { exact: true }).isVisible()).toBe(true)
    expect(seenRequests).toEqual([])
    await advance(10_000)
    expect(await answerInViewport(page)).toBe(false)
    expect(seenRequests).toEqual([])
    expect(seen(AUTO_ID)).toBeNull()
    expect(seen(MANUAL_ID)).toBeNull()
    await exposeAnswer()
    await advance(4_000)
    expect(seen(AUTO_ID)).toBeNull()
    await advance(1_000)
    await expect.poll(() => seen(AUTO_ID)).toBe(replySeq)
    await expectPinsRetained()
    await page.getByRole('heading', { name: 'Navigation Summary', exact: true }).click()
    await page.keyboard.press('1')
    expect(await pinnedRow(AUTO_ID).getAttribute('aria-selected')).toBe('true')
    await expectPinsRetained()
  })

  it('manual-only mode requires the explicit viewed action and retains manual pins until Unpin', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.getByRole('button', { name: 'Digest panel', exact: true }).click()
    await settings.getByLabel('Viewing acknowledgement', { exact: true }).selectOption('manual')
    await expect.poll(() => world().ctx.settings.get('ui-digest')).toMatchObject({ readAcknowledgement: 'manual', readGraceSeconds: 5 })
    await settings.getByRole('button', { name: 'Close', exact: true }).click()
    await pinnedRow(MANUAL_ID).click()
    await exposeAnswer()
    await advance(60_000)
    expect(seen(MANUAL_ID)).toBeNull()
    await expectPinsRetained()
    await page.getByRole('button', { name: 'Mark as viewed', exact: true }).click()
    await expect.poll(() => seen(MANUAL_ID)).toBe(replySeq)
    await expectPinsRetained()
    await pinnedRow(MANUAL_ID).hover()
    await pinnedRow(MANUAL_ID).getByRole('button', { name: /^Session actions for/ }).click()
    await page.getByRole('menuitem', { name: 'Unpin', exact: true }).click()
    await expect.poll(() => mark(MANUAL_ID)?.pinned).toBe(false)
  })
})
