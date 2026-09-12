/**
 * Real-composition check of the sidebar session status perimeter: an owning
 * run draws the slow animated ring by default, the browser's reduced-motion
 * preference and the General Settings choice both quiet it, the choice
 * persists across reload, and completion leaves a static ring behind.
 */
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const HOLD_PROVIDER = 'web-test-status-hold'
const HOLD_MODEL = 'hold'
const SESSION_ID = SessionId('session-status-perimeter-owner')
const WORKSPACE_NAME = 'status-workspace'
const PERSIST_KEY = 'dsh.workspace.view.v9'

/** Model stub that holds the first call open until the test releases it, then finishes. */
class HoldingAdapter extends LlmAdapter {
  activeCalls = 0
  private release: (() => void) | undefined

  releaseHeld(): void {
    this.release?.()
    this.release = undefined
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const signal = options.signal
    if (signal === undefined) throw new Error('holding Web adapter requires a turn signal')
    this.activeCalls += 1
    try {
      await new Promise<void>((resolve, reject) => {
        this.release = resolve
        const abort = (): void => {
          reject(signal.reason instanceof Error ? signal.reason : new Error('holding Web adapter aborted'))
        }
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
      })
    } finally {
      this.activeCalls -= 1
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Wait for the held request's explicit active-call signal. */
async function waitForHeldRequest(adapter: HoldingAdapter): Promise<void> {
  const deadline = Date.now() + 10_000
  while (adapter.activeCalls !== 1) {
    if (Date.now() >= deadline) throw new Error('session status request did not enter the holding adapter')
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
}

async function openGeneralSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('dialog', { name: 'Settings' }).waitFor({ timeout: 10_000 })
}

async function chooseStatusMode(page: Page, current: string, next: string): Promise<void> {
  await openGeneralSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  const trigger = dialog.getByRole('button', { name: current, exact: true })
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  await page.getByRole('menuitem', { name: next, exact: true }).click()
  await dialog.getByRole('button', { name: next, exact: true }).waitFor({ timeout: 5_000 })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
}

function ownerRow(page: Page) {
  return page.getByRole('tree', { name: 'Sessions' }).getByRole('treeitem', { name: /Hold this run open/ })
}

/** Computed motion of the perimeter's rotating pseudo-element. */
async function arcMotion(page: Page): Promise<{ name: string; duration: string; opacity: string }> {
  return ownerRow(page).locator('[data-session-status-perimeter="running"]').evaluate((el) => {
    const before = getComputedStyle(el, '::before')
    return { name: before.animationName, duration: before.animationDuration, opacity: before.opacity }
  })
}

describe('web e2e: session status perimeter', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let handle: AgentHandle
  let adapter: HoldingAdapter
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    adapter = new HoldingAdapter()
    scaffold.ctx.effect(
      () => scaffold.ctx.llm.registerAdapter([HOLD_PROVIDER], adapter),
      'session status perimeter holding adapter',
    )
    const cwd = join(scaffold.workspaceCwd, WORKSPACE_NAME)
    handle = await scaffold.ctx.agents.create({
      sessionId: SESSION_ID,
      meta: { cwd },
      agentOptions: { provider: HOLD_PROVIDER, model: HOLD_MODEL },
    })
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Hold this run open.' }],
      source: { kind: 'user' },
    }))
    await waitForHeldRequest(adapter)

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd, WORKSPACE_NAME)
    const workspace = await scaffold.ctx.workspaceRegistry.resolveByPath(cwd)
    if (workspace === undefined) throw new Error('session status Web workspace was not registered')
    await workspace.attachSession(SESSION_ID)
  }, 60_000)

  afterAll(async () => {
    const failures: unknown[] = []
    adapter?.releaseHeld()
    await handle?.agent.whenIdle().catch((error: unknown) => failures.push(error))
    await browser?.close().catch((error: unknown) => failures.push(error))
    await handle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'session status perimeter teardown failed')
  })

  it('renders the subdued loop, honors motion preference, and preserves static status', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-status-perimeter'))
    const row = ownerRow(page)
    await row.waitFor({ timeout: 10_000 })
    const perimeter = row.locator('[data-session-status-perimeter="running"]')
    await perimeter.waitFor({ state: 'attached', timeout: 10_000 })
    expect(await perimeter.getAttribute('data-motion')).toBe('animated')
    expect(await perimeter.getAttribute('aria-hidden')).toBe('true')
    const motion = await arcMotion(page)
    expect(motion.name).toMatch(/session-status-orbit/)
    expect(motion.duration).toBe('8s')

    // The browser's reduced-motion preference stops the sweep and keeps the track.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect.poll(async () => (await arcMotion(page)).name).toBe('none')
    expect((await arcMotion(page)).opacity).toBe('0')
    expect(await perimeter.count()).toBe(1)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect.poll(async () => (await arcMotion(page)).name).toMatch(/session-status-orbit/)

    // Motion off keeps the static track and persists across reload.
    await chooseStatusMode(page, 'Animation on (default)', 'Motion off')
    await expect.poll(() => row.locator('[data-session-status-perimeter="running"]').getAttribute('data-motion'))
      .toBe('static')
    expect(await page.evaluate(key => localStorage.getItem(key), PERSIST_KEY))
      .toContain('"sessionStatusIndicatorMode":"static"')
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const restoredRow = ownerRow(page)
    await restoredRow.locator('[data-session-status-perimeter="running"]').waitFor({ state: 'attached', timeout: 10_000 })
    expect(await restoredRow.locator('[data-session-status-perimeter="running"]').getAttribute('data-motion'))
      .toBe('static')

    // Completely off removes only the perimeter; the running dot stays.
    await chooseStatusMode(page, 'Motion off', 'Completely off')
    await expect.poll(() => restoredRow.locator('[data-session-status-perimeter]').count()).toBe(0)
    expect(await restoredRow.locator('[data-state="ongoing"]').count()).toBe(1)

    await chooseStatusMode(page, 'Completely off', 'Animation on (default)')
    await expect.poll(() => restoredRow.locator('[data-session-status-perimeter="running"]').count()).toBe(1)

    // Completion while another session is selected leaves the static done ring
    // (the reminder arms only for a non-selected row, so leave the owner first).
    await page.getByRole('button', { name: 'New session', exact: true }).first().click()
    await expect.poll(() => restoredRow.getAttribute('aria-selected')).toBe('false')
    adapter.releaseHeld()
    await handle.agent.whenIdle()
    const completed = restoredRow.locator('[data-session-status-perimeter="completed"]')
    await completed.waitFor({ state: 'attached', timeout: 10_000 })
    expect(await completed.getAttribute('data-motion')).toBe('static')
    expect(await restoredRow.locator('[data-state="done"]').count()).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
  })
})
