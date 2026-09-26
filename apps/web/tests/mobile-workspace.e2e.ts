/** Phone Workspace creation and nested-directory browsing through the shipped Web composition. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { saveFailureShot } from './support.ts'

const EXPECTED_DIR = fileURLToPath(new URL('./expected/mobile-workspace', import.meta.url))
const MODE = webSnapshotMode()

async function expectInsideViewport(control: Locator): Promise<void> {
  const fits = await control.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth
      && box.top >= 0 && box.bottom <= innerHeight
  })
  expect(fits).toBe(true)
}

describe('web e2e: mobile Workspace actions and directory visibility', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeEach(async () => {
    scaffold = await launchWebScaffold({})
    await mkdir(join(scaffold.workspaceCwd, 'game', 'harxx'), { recursive: true })
    await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true,
      locale: 'en-US', timezoneId: 'Asia/Shanghai',
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('navigation', { name: 'Mobile navigation' }).waitFor({ timeout: 30_000 })
    await expect.poll(() => scaffold.ctx.sessions.list().length).toBe(1)
    await scaffold.ctx.workspaceRegistry.create(join(scaffold.workspaceCwd, 'game'))
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mobile-workspace'))
  })

  afterEach(async () => {
    try {
      expect(tripwire?.pageErrors ?? []).toEqual([])
      expect(tripwire?.warnings ?? []).toEqual([])
    } finally {
      try { await browser?.close() } finally {
        vi.unstubAllEnvs()
        await scaffold?.close()
      }
    }
  })

  it('creates a blank Session in the browsed Workspace without choosing its directory again', async () => {
    const nav = page.getByRole('navigation', { name: 'Mobile navigation' })
    await nav.getByRole('button', { name: 'Workspaces', exact: true }).click()
    await page.getByRole('list', { name: 'Workspaces', exact: true }).getByRole('button', { name: /^game / }).click()
    const create = page.getByRole('button', { name: 'New session in game', exact: true })
    await create.waitFor({ timeout: 10_000 })
    await expectInsideViewport(create)
    expect((await create.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    await compareOrRefreshGolden(
      join(EXPECTED_DIR, 'workspace.expected.md'),
      await captureStableAria(page, 'header:has(h2)', scaffold.workspaceCwd),
      MODE,
    )
    await create.focus()
    await page.keyboard.press('Enter')
    await page.locator('[data-mobile-view="conversation"] [data-composer-input][contenteditable="true"]').waitFor()
    expect(await page.getByRole('dialog').count()).toBe(0)
    const workspace = (await scaffold.ctx.workspaceRegistry.resolveByPath(join(scaffold.workspaceCwd, 'game')))!
    await expect.poll(() => workspace.sessionIds.length).toBe(1)
    const created = scaffold.ctx.sessions.get(workspace.sessionIds[0]!)!
    expect(created.header.cwd).toBe(join(scaffold.workspaceCwd, 'game'))

    await nav.getByRole('button', { name: 'Workspaces', exact: true }).click()
    await create.waitFor()
    const current = page.getByRole('list', { name: 'Sessions', exact: true }).getByRole('button', { name: 'New Session', exact: true })
    expect(await current.getAttribute('aria-current')).toBe('page')
  })

  it('shows nested folders in one unclipped phone column and adopts a newly created child', async () => {
    // Host ancestry collapses at Home on every platform, independent of the temporary-root spelling.
    vi.stubEnv('HOME', scaffold.workspaceCwd)
    vi.stubEnv('USERPROFILE', scaffold.workspaceCwd)
    const nav = page.getByRole('navigation', { name: 'Mobile navigation' })
    await nav.getByRole('button', { name: 'New Session', exact: true }).click()
    await page.getByRole('button', { name: 'Choose workspace', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Add workspace…', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Select Workspace Directory', exact: true })
    await dialog.getByRole('button', { name: 'Edit path', exact: true }).click()
    await dialog.getByRole('textbox', { name: 'Edit path', exact: true }).fill(scaffold.workspaceCwd)
    await page.keyboard.press('Enter')
    await dialog.getByRole('textbox', { name: 'Edit path', exact: true }).waitFor({ state: 'detached' })
    await dialog.getByRole('list').getByRole('button', { name: 'game', exact: true }).click()
    const child = dialog.getByRole('list').getByRole('button', { name: 'harxx', exact: true })
    await child.waitFor()
    expect(await dialog.getByRole('list').count()).toBe(1)
    const geometry = await child.evaluate((element) => {
      const row = element.getBoundingClientRect()
      const column = element.closest('[role="list"]')!
      const parent = column.parentElement!
      const bounds = parent.getBoundingClientRect()
      return {
        fits: row.left >= bounds.left && row.right <= bounds.right,
        horizontalOverflow: parent.scrollWidth > parent.clientWidth,
        touchHeight: row.height,
      }
    })
    expect(geometry).toEqual({ fits: true, horizontalOverflow: false, touchHeight: 44 })
    await expectInsideViewport(child)
    await page.setViewportSize({ width: 768, height: 568 })
    await dialog.getByRole('list').getByRole('button', { name: 'game', exact: true }).focus()
    await page.setViewportSize({ width: 320, height: 568 })
    await expect.poll(() => dialog.getByRole('button', { name: 'Edit path', exact: true })
      .evaluate(element => element === document.activeElement)).toBe(true)
    for (const name of ['New folder', 'Show hidden files', 'Cancel', 'Open']) {
      await expectInsideViewport(dialog.getByRole('button', { name, exact: true }))
    }
    await compareOrRefreshGolden(
      join(EXPECTED_DIR, 'directory.expected.md'),
      await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd),
      MODE,
    )
    await child.focus()
    await page.keyboard.press('Enter')
    await dialog.getByRole('navigation').getByRole('button', { name: 'harxx', exact: true }).waitFor()
    expect(await dialog.evaluate((element) => {
      const active = document.activeElement
      return active instanceof HTMLElement && element.contains(active) && active.getClientRects().length > 0
    })).toBe(true)
    await dialog.getByRole('button', { name: 'New folder', exact: true }).click()
    const create = page.getByRole('dialog', { name: 'New folder', exact: true })
    await create.getByRole('textbox', { name: 'Folder name', exact: true }).fill('next')
    await create.getByRole('button', { name: 'Create', exact: true }).click()
    await create.waitFor({ state: 'detached' })
    await dialog.getByRole('navigation').getByRole('button', { name: 'next', exact: true }).waitFor()
    await dialog.getByRole('navigation').getByRole('button', { name: 'harxx', exact: true }).click()
    await dialog.getByRole('list').getByRole('button', { name: 'next', exact: true }).waitFor()
    await Promise.all(Array.from({ length: 20 }, (_, index) =>
      mkdir(join(scaffold.workspaceCwd, 'game', `a-${String(index).padStart(2, '0')}`))))
    await dialog.getByRole('navigation').getByRole('button', { name: 'game', exact: true }).click()
    await dialog.getByRole('list').getByRole('button', { name: 'a-19', exact: true }).waitFor()
    const lastFolder = dialog.getByRole('list').getByRole('button', { name: 'harxx', exact: true })
    await lastFolder.scrollIntoViewIfNeeded()
    await expectInsideViewport(lastFolder)
    expect(await lastFolder.evaluate(element => element.closest('[role="list"]')!.scrollTop)).toBeGreaterThan(0)
    await lastFolder.tap()
    await dialog.getByRole('list').getByRole('button', { name: 'next', exact: true }).waitFor()
    await dialog.getByRole('button', { name: 'Open', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await expect.poll(() => scaffold.ctx.workspaceRegistry.resolveByPath(join(scaffold.workspaceCwd, 'game', 'harxx'))).toBeDefined()
  })
})
