// Web e2e scenario: usage and cost disclosure over persisted own-session ledgers.
// The fixture uses a real SessionStore fork for inherited history, then persists
// the final headers and logs through the real JSONL and projection-cache APIs.
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, {
  SessionId,
  SessionLogOffset,
  type Session,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import {
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MOBILE_EXPECTED = fileURLToPath(new URL('./expected/usage-governance/mobile.expected.md', import.meta.url))
const ARTIFACT_DIR = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
const DESKTOP_SCREENSHOT = fileURLToPath(new URL('../../../.artifacts/usage-governance-desktop.png', import.meta.url))
const MOBILE_SCREENSHOT = fileURLToPath(new URL('../../../.artifacts/usage-governance-mobile.png', import.meta.url))
const OVERLAY = fileURLToPath(new URL('./usage-governance.overlay.yml', import.meta.url))
const MODE = webSnapshotMode()
const SEED_TIME = 1_784_974_100_000

const ROOT_ID = 'usage-governance-root'
const CHILD_ID = 'usage-governance-subagent'
const ORDINARY_FORK_ID = 'usage-governance-fork'
const INCOMPLETE_ID = 'usage-governance-incomplete'

const ROOT_USAGE: TokenUsage = {
  inputTokens: 100,
  cacheReadTokens: 50,
  cacheWriteTokens: 10,
  outputTokens: 20,
  reasoningTokens: 5,
  totalTokens: 180,
}
const CHILD_USAGE: TokenUsage = {
  inputTokens: 200,
  cacheReadTokens: 100,
  cacheWriteTokens: 0,
  outputTokens: 40,
  reasoningTokens: 10,
  totalTokens: 340,
}
const INCOMPLETE_USAGE: TokenUsage = { inputTokens: 20, outputTokens: 5 }
const UNPRICED_USAGE: TokenUsage = {
  inputTokens: 300,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 30,
  totalTokens: 330,
}

function appendUsageTurn(
  session: Session,
  turn: number,
  usage: TokenUsage,
  model: string,
  label: string,
): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `Usage governance ${label} turn ${turn} for ${model}.` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn,
    step: 1,
    stream: [],
    message: createAssistantMessage({
      content: [{ type: 'text', text: `Recorded ${model} usage.` }],
      source: { provider: 'deepseek-official', model },
    }),
    usage,
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

function persistedHeader(
  session: Session,
  id: string,
  metadata: { origin?: 'subagent'; delegationDepth?: number } = {},
): SessionHeader {
  return {
    ...session.header,
    id: SessionId(id),
    ...metadata.origin === undefined ? {} : { origin: metadata.origin },
    ...metadata.delegationDepth === undefined ? {} : { delegationDepth: metadata.delegationDepth },
  }
}

async function waitForCacheWrite(
  scaffold: WebScaffold,
  header: SessionHeader,
  inheritedEventCount: SessionLogOffset,
): Promise<void> {
  const deadline = Date.now() + 10_000
  while (scaffold.ctx.sessionProjectionCache.cachedSnapshot(header, inheritedEventCount) === undefined) {
    if (Date.now() >= deadline) throw new Error(`projection cache row for "${header.id}" did not land`)
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
}

/** Persist one live/forked log and seed its complete projection snapshot. */
async function persistFixture(
  scaffold: WebScaffold,
  session: Session,
  header = session.header,
): Promise<void> {
  const events = session.snapshotEvents().map(event => ({ ...event, time: SEED_TIME + event.seq * 100 }))
  const inheritedEventCount = session.inheritedEventCount
  const handle = await scaffold.ctx.sessionPersistence.create(header, { inheritedEventCount })
  await handle.append(events)
  await handle.close()
  scaffold.ctx.sessionProjectionCache.coldSnapshot(header, inheritedEventCount, events)
  await waitForCacheWrite(scaffold, header, inheritedEventCount)
}

async function openPersistedSession(page: Page, id: string): Promise<void> {
  const group = page.getByRole('treeitem').first()
  await group.waitFor({ timeout: 20_000 })
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
  const row = page.locator(`[data-session-id="${id}"]`)
  await row.waitFor({ timeout: 20_000 })
  await row.click()
  await expect.poll(() => page.getByRole('button', { name: /^AI usage:/ }).count(), { timeout: 20_000 })
    .toBe(1)
}

async function openUsageDrawer(page: Page): Promise<Locator> {
  const trigger = page.getByRole('button', { name: /^AI usage:/ })
  await trigger.click()
  const dialog = page.locator('[data-usage-panel]')
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  return dialog
}

describe('web e2e: persisted usage and cost governance', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    if (MODE === 'record') throw new Error('usage governance is a keyless persisted-session scenario')
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    await mkdir(ARTIFACT_DIR, { recursive: true })

    const createdAt = SEED_TIME
    const seeder = new Context()
    await seeder.plugin(SessionStore)
    try {
      const root = seeder.sessions.create(SessionId(ROOT_ID), {
        meta: {
          cwd: scaffold.workspaceCwd,
          createdAt: createdAt + 3_000,
          isSeeded: false,
          delegationDepth: 0,
        },
      })
      appendUsageTurn(root, 1, ROOT_USAGE, 'deepseek-v4-flash', ROOT_ID)
      await persistFixture(scaffold, root)

      // Fork through the real SessionStore so the child contains the root
      // prefix; the ledger must charge only child-owned events after the cut.
      const child = seeder.sessions.fork(root, undefined, SessionId(CHILD_ID))
      child.append('subagent/descriptor', snapshotSubagentDescriptor({
        mode: 'continuable', provider: 'spawn', label: 'usage governance child',
      }))
      appendUsageTurn(child, 2, CHILD_USAGE, 'deepseek-v4-flash', CHILD_ID)
      await persistFixture(scaffold, child, persistedHeader(child, CHILD_ID, { origin: 'subagent', delegationDepth: 1 }))

      // This ordinary fork shares the same root prefix but is excluded from
      // the Session tree scope because its stored header has no subagent origin.
      const ordinaryFork = seeder.sessions.fork(root, undefined, SessionId(ORDINARY_FORK_ID))
      appendUsageTurn(ordinaryFork, 2, UNPRICED_USAGE, 'deepseek-v4-unpriced', ORDINARY_FORK_ID)
      await persistFixture(scaffold, ordinaryFork, persistedHeader(ordinaryFork, ORDINARY_FORK_ID, { delegationDepth: 0 }))

      const incomplete = seeder.sessions.create(SessionId(INCOMPLETE_ID), {
        meta: {
          cwd: scaffold.workspaceCwd,
          createdAt: createdAt + 1_000,
          isSeeded: false,
          delegationDepth: 0,
        },
      })
      appendUsageTurn(incomplete, 1, INCOMPLETE_USAGE, 'deepseek-v4-flash', INCOMPLETE_ID)
      await persistFixture(scaffold, incomplete)
    } finally {
      await seeder.fiber.dispose()
    }

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByText('Ungrouped', { exact: true }).waitFor({ timeout: 30_000 })
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByText('Ungrouped', { exact: true }).waitFor({ timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('prices own requests, separates the subagent tree, and reports incomplete corpus totals', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-usage-governance'))
    await openPersistedSession(page, ROOT_ID)
    const subagents = page.getByRole('button', { name: '1 subagent', exact: true })
    await subagents.hover()
    const subagentTree = page.getByRole('tree', { name: 'Subagent sessions' })
    const childRow = subagentTree.getByRole('treeitem', { name: /usage governance child/ })
    await childRow.waitFor({ timeout: 15_000 })
    await childRow.click()
    await page.locator(`[data-session-id="${ROOT_ID}"]`).click()
    const drawer = await openUsageDrawer(page)

    expect(await drawer.getByRole('heading', { name: 'AI usage', exact: true }).count()).toBe(1)
    expect(await page.locator('[data-usage-panel][data-usage-scope="session"]').count()).toBe(1)
    expect(await drawer.locator('[data-usage-cost]').textContent()).toContain('USD 0.00018')
    await page.screenshot({ path: DESKTOP_SCREENSHOT })
    expect(await drawer.locator('[data-usage-budget="within"]').count()).toBe(1)
    expect(await drawer.getByText(/1 reported requests/).count()).toBe(1)

    await drawer.getByRole('button', { name: 'Session tree', exact: true }).click()
    await expect.poll(() => page.locator('[data-usage-panel][data-usage-scope="tree"]').count()).toBe(1)
    expect(await drawer.locator('[data-usage-cost]').textContent()).toContain('USD 0.00052')
    expect(await drawer.locator('[data-usage-budget="warning"]').count()).toBe(1)
    expect(await drawer.getByText(/2 reported requests/).count()).toBe(1)

    await drawer.getByRole('button', { name: 'All sessions', exact: true }).click()
    await expect.poll(() => page.locator('[data-usage-panel][data-usage-scope="all"]').count()).toBe(1)
    expect(await drawer.locator('[data-usage-cost]').textContent()).toContain('Total cost unavailable')
    expect(await drawer.getByText(/1 requests have incomplete billing inputs/).count()).toBe(1)
    expect(await drawer.getByText(/1 requests lack complete prices/).count()).toBe(1)
    expect(await drawer.getByText(/3 reported requests/).count()).toBe(1)

    await drawer.getByRole('button', { name: 'Close usage panel', exact: true }).click()
    await expect.poll(() => page.locator('[data-usage-panel]').count()).toBe(0)
  }, 60_000)

  it('contains focus, restores the trigger, and keeps the drawer usable on mobile', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-usage-governance-mobile'))
    await page.setViewportSize({ width: 1440, height: 900 })
    const openDrawer = page.locator('[data-usage-panel]')
    if (await openDrawer.count() > 0) {
      await page.getByRole('button', { name: 'Close usage panel', exact: true }).click()
      await expect.poll(() => page.locator('[data-usage-panel]').count()).toBe(0)
    }
    const trigger = page.getByRole('button', { name: /^AI usage:/ })
    await trigger.click()
    const drawer = page.locator('[data-usage-panel]')
    await drawer.waitFor({ state: 'visible', timeout: 10_000 })
    await page.setViewportSize({ width: 390, height: 844 })
    await drawer.waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.getByRole('heading', { name: 'AI usage', exact: true }).count()).toBe(1)
    expect(await page.evaluate(() => [...document.body.children]
      .filter(node => node.getAttribute('aria-hidden') === 'true').length)).toBeGreaterThan(0)

    for (let index = 0; index < 8; index++) {
      await page.keyboard.press('Tab')
      expect(await drawer.evaluate(node => node.contains(document.activeElement))).toBe(true)
    }

    await drawer.getByRole('button', { name: 'All sessions', exact: true }).click()
    await expect.poll(() => page.locator('[data-usage-panel][data-usage-scope="all"]').count()).toBe(1)
    const snapshot = await captureStableAria(page, '[data-usage-panel]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(MOBILE_EXPECTED, snapshot, MODE)
    await page.screenshot({ path: MOBILE_SCREENSHOT })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Close usage panel', exact: true }).click()
    await expect.poll(() => trigger.evaluate(node => document.activeElement === node)).toBe(true)
    expect(await page.evaluate(() => [...document.body.children]
      .filter(node => node.getAttribute('aria-hidden') === 'true').length)).toBe(0)
  }, 60_000)

  it('keeps the browser and fixture clean', async () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
