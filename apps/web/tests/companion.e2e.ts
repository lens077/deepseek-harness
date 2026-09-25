/** Opt-in companion in the real Loader composition, without model calls. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const OVERLAY = fileURLToPath(new URL('./fixtures/companion.patch.yml', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/companion/', import.meta.url))

describe('web companion', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let consoleState: ReturnType<typeof watchConsole>
  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    browser = await chromium.launch()
  })
  beforeEach(async () => {
    page = await newEnglishPage(browser)
    consoleState = watchConsole(page)
    await page.setViewportSize({ width: 1440, height: 960 })
    await page.goto(scaffold.authenticatedUrl)
    await page.locator('[data-companion]').waitFor()
  })
  afterEach(async () => {
    try {
      expect(consoleState.pageErrors).toEqual([])
      expect(consoleState.warnings).toEqual([])
    } finally { await page?.context().close() }
  })
  afterAll(async () => {
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('greets, rests, pauses, minimizes and restores without covering the composer', async () => {
    const companion = page.locator('[data-companion]')
    const art = companion.locator('[data-testid="companion-art"]')
    const image = companion.locator('img')
    await expect.poll(() => image.evaluate(el => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0)).toBe(true)
    const idle = await captureStableAria(page, '[data-companion]', scaffold.workspaceCwd)
    const character = page.getByRole('button', { name: 'Say hello to your companion' })
    await character.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Let your companion rest' }).press('Space')
    await expect.poll(() => art.getAttribute('data-mood')).toBe('sleeping')
    const sleeping = await captureStableAria(page, '[data-companion]', scaffold.workspaceCwd)
    await page.getByRole('button', { name: 'Pause animation' }).click()
    expect(await art.evaluate(el => getComputedStyle(el).animationPlayState)).toBe('paused')
    await page.getByRole('button', { name: 'Minimize companion' }).click()
    const restore = page.getByRole('button', { name: 'Expand companion' })
    expect(await restore.evaluate(el => el === document.activeElement)).toBe(true)
    await restore.press('Enter')
    expect(await page.getByRole('button', { name: 'Wake your companion' }).evaluate(el => el === document.activeElement)).toBe(true)
    await page.getByRole('button', { name: 'Enable animation' }).click()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await art.evaluate(el => getComputedStyle(el).animationName)).toBe('none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect.poll(() => art.evaluate(el => getComputedStyle(el).animationName)).not.toBe('none')
    const pet = await companion.boundingBox()
    const composer = await page.locator('[data-composer-card]').boundingBox()
    expect(pet).not.toBeNull()
    expect(composer).not.toBeNull()
    expect(pet!.x + pet!.width).toBeLessThanOrEqual(composer!.x)
    await compareOrRefreshGolden(join(EXPECTED, 'states.expected.md'), `${idle}\n\n---\n\n${sleeping}`, webSnapshotMode())
  })

  it('drags outside the sidebar without clicking, clamps to the viewport, and docks again', async () => {
    const pet = page.locator('[data-companion]')
    const character = page.getByRole('button', { name: 'Say hello to your companion' })
    const initial = await pet.boundingBox()
    const handle = await character.boundingBox()
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
    await page.mouse.down()
    await page.mouse.move(850, 350, { steps: 12 })
    await page.mouse.up()
    await expect.poll(() => pet.getAttribute('data-floating')).toBe('true')
    expect((await pet.boundingBox())!.x).toBeGreaterThan(initial!.x + 400)
    expect(await character.count()).toBe(1)
    await character.click()
    expect(await page.getByRole('button', { name: 'Let your companion rest' }).count()).toBe(1)
    await page.setViewportSize({ width: 390, height: 600 })
    await expect.poll(async () => {
      const rect = await pet.boundingBox()
      return rect !== null && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 390 && rect.y + rect.height <= 600
    }).toBe(true)
    await page.getByRole('button', { name: 'Return companion to sidebar' }).click()
    await expect.poll(() => pet.getAttribute('data-floating')).toBeNull()
    expect(await page.getByRole('banner').locator('[data-companion]').count()).toBe(1)
  })

  it('moves the phone character with a touch gesture without activating its mood', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    const pet = page.locator('[data-companion]')
    await page.getByRole('banner').locator('[data-companion]').waitFor({ state: 'visible' })
    const handle = await pet.getByRole('button').boundingBox()
    const client = await page.context().newCDPSession(page)
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    const start = { x: handle!.x + handle!.width / 2, y: handle!.y + handle!.height / 2 }
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    for (let step = 1; step <= 8; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        x: start.x + (160 - start.x) * step / 8,
        y: start.y + (400 - start.y) * step / 8,
      }] })
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(() => pet.getAttribute('data-floating')).toBe('true')
    expect(await pet.getByRole('button', { name: 'Say hello to your companion' }).count()).toBe(1)
    const moved = await pet.boundingBox()
    expect(moved!.y).toBeGreaterThan(300)
    expect(await pet.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    const characterBounds = await pet.getByRole('button', { name: 'Say hello to your companion' }).boundingBox()
    const dockBounds = await pet.getByRole('button', { name: 'Return companion to sidebar' }).boundingBox()
    expect(characterBounds!.x + characterBounds!.width).toBeLessThanOrEqual(dockBounds!.x)
    expect(dockBounds!.x + dockBounds!.width).toBeLessThanOrEqual(moved!.x + moved!.width)
    await page.getByRole('button', { name: 'Return companion to sidebar' }).click()
    await expect.poll(() => pet.getAttribute('data-floating')).toBeNull()
  })

  it('retains rest across rail and phone layouts and preserves four navigation destinations', async () => {
    const companion = page.locator('[data-companion]')
    await page.getByRole('button', { name: 'Say hello to your companion' }).click()
    await page.getByRole('button', { name: 'Let your companion rest' }).click()
    for (const width of [1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 })
      if (width < 768) await page.getByRole('banner').locator('[data-companion]').waitFor({ state: 'visible' })
      else await page.locator('[data-sidebar-collapsed] [data-companion], [data-desktop-layout] [data-companion]').first().waitFor({ state: 'visible' })
      await expect.poll(() => companion.count()).toBe(1)
      if (width <= 768) {
        await expect.poll(() => companion.getAttribute('data-compact')).toBe('true')
        expect(await companion.getByRole('button').count()).toBe(1)
      }
      const bounds = await companion.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      expect(await page.getByRole('button', { name: 'Wake your companion' }).count()).toBe(1)
      if (width < 768) {
        await expect.poll(() => page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button').count()).toBe(4)
        expect(await page.getByRole('banner').locator('[data-companion]').count()).toBe(1)
        expect(await page.locator('[data-testid="companion-art"]').evaluate(el => getComputedStyle(el).animationPlayState)).toBe('paused')
      }
    }
    await page.getByRole('button', { name: 'Wake your companion' }).click()
    await page.setViewportSize({ width: 1440, height: 960 })
    await expect.poll(() => companion.getAttribute('data-compact')).toBeNull()
    expect(await companion.getByRole('status').textContent()).toBe('Here to keep you company')
    await page.setViewportSize({ width: 1440, height: 400 })
    const settings = await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox()
    const bounds = await companion.boundingBox()
    expect(settings!.y + settings!.height).toBeLessThanOrEqual(400)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(settings!.y)
    expect(await page.locator('[data-testid="companion-art"]').evaluate(el => getComputedStyle(el).animationName)).toBe('none')
  })
})
