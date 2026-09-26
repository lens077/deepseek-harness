/** Phone diff disclosure over a recorded filesystem edit, without model calls. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/session/fs-edit/session.v3.jsonl', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/mobile-produced-files', import.meta.url))
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: phone produced-file disclosure', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), 'mobile-produced-files-web-e2e')
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      locale: 'en-US', timezoneId: 'Asia/Shanghai',
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Workspaces', exact: true }).click()
    await page.getByRole('list', { name: 'Workspaces', exact: true }).getByRole('button', { name: /Ungrouped/ }).click()
    await page.getByRole('list', { name: 'Sessions', exact: true }).getByRole('button').first().click()
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
  })

  afterAll(async () => {
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('keeps recorded edits folded on phones while preserving manual disclosure and desktop defaults', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mobile-produced-files'))
    const row = page.locator('[data-produced-files-row]')
    const chip = row.getByRole('button', { name: 'Open config.txt', exact: true })
    await chip.waitFor()
    await expect.poll(() => chip.getAttribute('aria-expanded')).toBe('false')
    expect(await page.getByRole('button', { name: /Open config.txt in/ }).count()).toBe(0)
    await compareOrRefreshGolden(
      join(SNAPSHOT_DIR, 'collapsed.expected.md'),
      await captureStableAria(page, '[data-chat-turn]:has([data-produced-files-row])', scaffold.workspaceCwd),
      MODE,
    )
    await chip.tap()
    await expect.poll(() => chip.getAttribute('aria-expanded')).toBe('true')
    expect(await page.getByText('mode=RELEASE', { exact: true }).count()).toBeGreaterThan(0)
    await compareOrRefreshGolden(
      join(SNAPSHOT_DIR, 'expanded.expected.md'),
      await captureStableAria(page, '[data-chat-turn]:has([data-produced-files-row])', scaffold.workspaceCwd),
      MODE,
    )
    await chip.tap()
    for (const width of [320, 390, 767]) {
      await page.setViewportSize({ width, height: 844 })
      await expect.poll(() => chip.getAttribute('aria-expanded')).toBe('false')
    }
    for (const width of [768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => chip.getAttribute('aria-expanded')).toBe('true')
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => chip.getAttribute('aria-expanded')).toBe('false')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['collapsed.expected.md', 'expanded.expected.md'])
  })
})
