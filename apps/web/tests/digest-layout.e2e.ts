/** Real-composition geometry and workspace controls over eight genuinely running root Sessions. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-digest'
import type {} from '@deepseek-ai/dsh-session-stats'
import type {} from '@deepseek-ai/dsh-tool-todo'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const PROVIDER = 'digest-layout-fixture'
const MODEL = 'held-task'
const TOLERANCE = 1.5
const WORK = Array.from({ length: 8 }, (_, index) => ({
  id: SessionId(`digest-layout-${index + 1}`),
  workspace: `Workspace ${index + 1} — layout verification and multilingual 工作区`,
  question: `Digest task ${index + 1}: ${'check alignment and keep every action reachable. '.repeat(index + 1)}`.trim(),
  update: `Update ${index + 1}: ${'Verified the recorded work and checking the remaining layout. '.repeat(index % 3 + 1)}`.trim(),
  current: `Validate task ${index + 1} across desktop and compact mobile layouts`,
}))

/** Runs the real todo tool once per Session, then waits for its owner's cancellation. */
class DigestAdapter extends LlmAdapter {
  readonly held = new Set<string>()
  private readonly readiness = Promise.withResolvers<undefined>()
  readonly ready = this.readiness.promise
  private readonly started = new Set<string>()

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 1_000_000 } })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const work = WORK.find(item => item.id === options.sessionId)
    if (work === undefined || options.signal === undefined) throw new Error('Digest fixture requires an owned Session and turn signal')
    if (!this.started.has(work.id)) {
      this.started.add(work.id)
      const argumentsJson = JSON.stringify({ todos: [
        { content: `Inspect task ${work.id}`, status: 'completed' },
        { content: work.current, status: 'in_progress' },
        { content: `Report task ${work.id} results`, status: 'pending' },
      ] })
      const callId = ToolCallId(`${work.id}-todos`)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: work.update }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: work.update } }
      yield { type: 'block-start', index: 1, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 1, id: callId, name: 'todo_write', argumentsDelta: argumentsJson }
      yield { type: 'block-end', index: 1, block: { type: 'tool-call', id: callId, name: 'todo_write', arguments: argumentsJson } }
      yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const signal = options.signal
    this.held.add(work.id)
    if (this.held.size === WORK.length) this.readiness.resolve(undefined)
    try {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    } finally {
      this.held.delete(work.id)
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

interface Box { x: number; y: number; width: number; height: number }
interface Geometry {
  width: number
  body: Box
  bottomInset: number
  section: Box
  legend: Box
  legendOutside: boolean
  overflow: number
  cards: { box: Box; actions: Box; questionHeight: number; questionLineHeight: number }[]
}

/** Measures actual painted boxes; no mocked rectangles or CSS-class expectations. */
async function geometry(panel: Locator): Promise<Geometry> {
  return panel.evaluate((root) => {
    const body = root.querySelector<HTMLElement>('[data-digest-body]')!
    const section = body.querySelector<HTMLElement>('section')!
    const legend = root.querySelector<HTMLElement>('[data-digest-keys]')!
    const box = (element: Element): Box => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    const style = getComputedStyle(body)
    return {
      width: body.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      body: box(body), bottomInset: parseFloat(style.paddingBottom), section: box(section), legend: box(legend),
      legendOutside: !body.contains(legend), overflow: document.documentElement.scrollWidth - innerWidth,
      cards: [...body.querySelectorAll<HTMLElement>('article[data-session-id]')].map((card) => {
        const question = card.querySelector<HTMLElement>('[data-card-body] > span[title]')!
        return {
          box: box(card), actions: box(card.querySelector('[data-card-actions]')!),
          questionHeight: question.getBoundingClientRect().height,
          questionLineHeight: parseFloat(getComputedStyle(question).lineHeight),
        }
      }),
    }
  })
}

function assertAligned(value: Geometry, columns: number): void {
  expect(value.cards).toHaveLength(8)
  expect(value.overflow).toBeLessThanOrEqual(TOLERANCE)
  const first = value.cards[0]!
  expect(value.cards.filter(card => Math.abs(card.box.y - first.box.y) <= TOLERANCE)).toHaveLength(columns)
  for (let offset = 0; offset < value.cards.length; offset += columns) {
    const row = value.cards.slice(offset, offset + columns)
    for (const card of row) {
      expect(Math.abs(card.box.y - row[0]!.box.y)).toBeLessThanOrEqual(TOLERANCE)
      expect(Math.abs(card.box.height - row[0]!.box.height)).toBeLessThanOrEqual(TOLERANCE)
      expect(Math.abs(card.actions.y - row[0]!.actions.y), `Action alignment: ${JSON.stringify(row)}`).toBeLessThanOrEqual(TOLERANCE)
      expect(Math.abs(card.box.width - first.box.width)).toBeLessThanOrEqual(TOLERANCE)
      expect(card.questionHeight, 'The task question retains at least one full text line').toBeGreaterThanOrEqual(card.questionLineHeight)
      expect(card.actions.y + card.actions.height).toBeLessThanOrEqual(card.box.y + card.box.height + TOLERANCE)
    }
  }
  const completeRow = value.cards.slice(0, columns)
  const span = completeRow.at(-1)!.box.x + completeRow.at(-1)!.box.width - first.box.x
  expect(span).toBeGreaterThanOrEqual(value.width - 12)
  expect(value.section.y + value.section.height).toBeGreaterThanOrEqual(value.body.y + value.body.height - value.bottomInset - TOLERANCE)
  expect(value.legendOutside).toBe(true)
  expect(value.legend.y).toBeGreaterThanOrEqual(value.body.y + value.body.height - TOLERANCE)
}

/** Opens a feature-owned preference through its shipped Settings section. */
async function settingSelect(page: Page, section: string, label: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await dialog.getByRole('button', { name: section, exact: true }).click()
  const setting = dialog.getByRole('combobox', { name: label, exact: true })
  await setting.waitFor({ state: 'visible' })
  return setting
}

async function chooseSetting(page: Page, section: string, label: string, value: string): Promise<void> {
  const setting = await settingSelect(page, section, label)
  await setting.selectOption(value)
  await expect.poll(() => setting.inputValue()).toBe(value)
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
}

async function openDigest(page: Page): Promise<Locator> {
  const panel = page.locator('[data-digest-panel]')
  if (!await panel.isVisible()) await page.getByRole('button', { name: /^Digest(?: ·|$)/ }).click()
  await panel.waitFor({ state: 'visible' })
  await expect.poll(() => panel.locator('article[data-session-id]').count()).toBe(8)
  return panel
}

/** Counts occupied chip rows independently of the configured maximum. */
async function stripGeometry(page: Page) {
  return page.locator('[data-workspace-scroll]').evaluate((root: HTMLElement) => {
    const chips = [...root.querySelectorAll<HTMLButtonElement>('button')].map(chip => chip.getBoundingClientRect())
    const ys = [...new Set(chips.map(chip => Math.round(chip.y)))]
    const style = getComputedStyle(root)
    return {
      height: root.clientHeight, scrollHeight: root.scrollHeight, width: root.clientWidth, scrollWidth: root.scrollWidth,
      left: root.scrollLeft, rows: ys.length, chipHeight: chips[0]!.height,
      gap: parseFloat(getComputedStyle(root.firstElementChild!).rowGap),
      inset: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
    }
  })
}

describe('web e2e: populated Digest layout and workspace strip', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let adapter: DigestAdapter
  let tripwire: ReturnType<typeof watchConsole>
  const handles: AgentHandle[] = []
  const workspaces: Workspace[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ toolsMode: 'native' })
    adapter = new DigestAdapter()
    scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter([PROVIDER], adapter), 'Digest layout fixture adapter')
    for (const [index, work] of WORK.entries()) {
      const cwd = join(scaffold.workspaceCwd, `workspace-${index + 1}`)
      await mkdir(cwd)
      const workspace = await scaffold.ctx.workspaceRegistry.create(cwd, work.workspace)
      workspaces.push(workspace)
      const handle = await scaffold.ctx.agents.create({
        sessionId: work.id, meta: { cwd }, agentOptions: { provider: PROVIDER, model: MODEL },
        setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx).then(() => undefined),
      })
      handles.push(handle)
      expect(scaffold.ctx.tools.schemas(handle.agent).some(tool => tool.name === 'todo_write')).toBe(true)
      await workspace.attachSession(work.id)
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: work.question }], source: { kind: 'user' } }))
    }
    await adapter.ready
    for (const [index, handle] of handles.entries()) {
      expect(handle.agent.status).toBe('running')
      const values = scaffold.ctx.sessionProjections.snapshot(handle.agent.session).values
      expect(values.sessionDigest?.reply).toBe(WORK[index]!.update)
      expect(values.todos).toContainEqual({ content: WORK[index]!.current, status: 'in_progress' })
      expect(values.usageLedger?.activity.steps).toBe(1)
      expect(values.usageLedger?.tools).toContainEqual(expect.objectContaining({ name: 'todo_write', calls: 1, results: 1, errors: 0 }))
    }
    browser = await chromium.launch()
  })

  beforeEach(async () => {
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[class*="frame"]').waitFor({ state: 'visible', timeout: 30_000 })
    const selected = page.getByRole('tree', { name: 'Sessions', exact: true }).locator(`[data-session-id="${WORK.at(-1)!.id}"]`)
    await selected.click()
    await expect.poll(() => selected.getAttribute('aria-selected')).toBe('true')
    await page.locator('[data-chat-turn]').first().waitFor({ state: 'attached' })
    await openDigest(page)
  })

  afterEach(async ({ task }) => {
    if (task.result?.state === 'fail' && page !== undefined) {
      await saveFailureShot(page, task.name.startsWith('fills') ? 'digest-layout-desktop-failure' : 'digest-layout-strip-failure')
    }
    try {
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    } finally {
      await page?.context().close()
    }
  })

  afterAll(async () => {
    const failures: unknown[] = []
    for (const handle of handles) handle.agent.cancel({ kind: 'user' })
    await Promise.all(handles.map(handle => handle.agent.whenIdle().catch((error: unknown) => failures.push(error))))
    await browser?.close().catch((error: unknown) => failures.push(error))
    for (const handle of handles) await handle.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (adapter !== undefined) expect(adapter.held.size).toBe(0)
    if (failures.length > 0) throw new AggregateError(failures, 'Digest layout fixture teardown failed')
  })

  it('fills the only populated state with aligned cards, real work, and compact phone disclosures', async () => {
    const panel = page.locator('[data-digest-panel]')
    expect(await panel.evaluate(element => document.activeElement === element)).toBe(true)
    await page.keyboard.press('Tab')
    expect(await panel.getByRole('tab', { name: 'Inbox', exact: true }).evaluate(element => document.activeElement === element)).toBe(true)
    for (const work of WORK) {
      const card = panel.locator(`[data-session-id="${work.id}"]`)
      expect(await card.textContent()).toContain(work.update)
      expect(await card.textContent()).toContain(work.current)
      expect(await card.textContent()).toContain('Session total: 1 steps')
      expect(await card.textContent()).toContain('Tools: 1 calls · 1 results')
      expect(await card.locator('kbd').allTextContents()).toEqual(['1', '4', '5'])
      for (const keycap of await card.locator('kbd').all()) expect(await keycap.isVisible()).toBe(true)
    }
    expect(await panel.locator('article:not([data-focused]) kbd').count()).toBe(21)
    await panel.getByRole('checkbox', { name: 'Show results', exact: true }).uncheck()
    for (const work of WORK) expect(await panel.locator(`[data-session-id="${work.id}"]`).textContent()).toContain(work.update)
    expect(await panel.locator('section[data-section]').getAttribute('data-section')).toBe('running')
    assertAligned(await geometry(panel), 5)
    await saveFailureShot(page, 'digest-layout-desktop')
    await panel.getByRole('button', { name: 'Board', exact: true }).click()
    expect(await panel.locator('section[data-column]').count()).toBe(1)
    expect(await panel.locator('section[data-column]').getAttribute('data-column')).toBe('running')
    assertAligned(await geometry(panel), 5)
    await panel.getByRole('button', { name: 'Sections', exact: true }).click()

    const columns = await settingSelect(page, 'Digest panel', 'Cards per row')
    expect(await columns.inputValue()).toBe('5')
    expect(await columns.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
      .toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    await columns.selectOption('3')
    await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
    assertAligned(await geometry(panel), 3)
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.locator('[data-chat-turn]').first().waitFor({ state: 'attached' })
    await openDigest(page)
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    assertAligned(await geometry(panel), 3)
    const persisted = await settingSelect(page, 'Digest panel', 'Cards per row')
    expect(await persisted.inputValue()).toBe('3')
    await persisted.selectOption('1')
    await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
    assertAligned(await geometry(panel), 1)
    await page.setViewportSize({ width: 2560, height: 1000 })
    await chooseSetting(page, 'Digest panel', 'Cards per row', '8')
    assertAligned(await geometry(panel), 8)
    await chooseSetting(page, 'Digest panel', 'Cards per row', '5')

    for (const [width, tracks] of [[1024, 2], [768, 1]] as const) {
      await page.setViewportSize({ width, height: 1000 })
      if (width === 768) await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
      await expect.poll(async () => (await geometry(panel)).width).toBeLessThan(tracks === 1 ? 492 : 1000)
      assertAligned(await geometry(panel), tracks)
    }
    await page.setViewportSize({ width: 1680, height: 1000 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).not.toBeNull()
    assertAligned(await geometry(panel), 5)

    await page.setViewportSize({ width: 320, height: 740 })
    await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Overview', exact: true }).click()
    const overview = page.getByRole('region', { name: 'Overview', exact: true })
    await expect.poll(() => overview.locator('article[data-session-id]').count()).toBe(8)
    const disclosures = overview.locator('article > button[aria-expanded][aria-controls]')
    expect(await disclosures.count()).toBe(8)
    expect(await overview.locator('[data-card-actions]').count()).toBe(0)
    const boxes = await disclosures.evaluateAll(elements => elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, width: rect.width, height: rect.height }
    }))
    for (const box of boxes) {
      expect(Math.abs(box.x - boxes[0]!.x)).toBeLessThanOrEqual(TOLERANCE)
      expect(box.height).toBeGreaterThanOrEqual(32)
      expect(box.x + box.width).toBeLessThanOrEqual(320 + TOLERANCE)
    }
    await disclosures.first().click()
    await overview.locator('[data-running-work]').waitFor({ state: 'visible' })
    await disclosures.nth(1).click()
    expect(await overview.locator('article > button[aria-expanded="true"]').count()).toBe(1)
    expect(await overview.locator('[data-running-work]').count()).toBe(1)
    expect(await overview.locator('kbd').count()).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(TOLERANCE)
    await overview.locator('[data-digest-body]').evaluate((element) => { element.scrollTo({ top: 0 }) })
    await saveFailureShot(page, 'digest-layout-mobile')
  })

  it('persists row limits without empty height and separates expansion, drag scrolling, and filtering', async () => {
    const panel = page.locator('[data-digest-panel]')
    const strip = page.locator('[data-workspace-scroll]')
    const filter = page.locator('[data-workspace-filter]')
    const setting = await settingSelect(page, 'Layout', 'Digest workspace strip')
    expect(await setting.inputValue()).toBe('single')
    expect(await setting.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
      .toEqual(['single', '2', '3', '4', '5', '6', 'all'])
    await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
    await expect.poll(async () => (await stripGeometry(page)).scrollWidth - (await stripGeometry(page)).width).toBeGreaterThan(0)
    const before = await stripGeometry(page)
    const showAll = filter.getByRole('button', { name: 'Show all', exact: true })
    await showAll.focus()
    await page.keyboard.press('Enter')
    const collapse = filter.getByRole('button', { name: 'Collapse', exact: true })
    await collapse.waitFor({ state: 'visible' })
    expect(await collapse.getAttribute('aria-expanded')).toBe('true')
    expect((await stripGeometry(page)).height).toBeGreaterThan(before.height)
    expect(await panel.locator('article[data-session-id]').count()).toBe(8)
    await collapse.press('Enter')
    await showAll.waitFor({ state: 'visible' })

    const bounds = (await strip.boundingBox())!
    await page.mouse.move(bounds.x + bounds.width - 30, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBeGreaterThan(before.left)
    expect(await panel.locator('article[data-session-id]').count()).toBe(8)
    expect(await filter.getByRole('button', { name: 'All workspaces', exact: true }).getAttribute('aria-pressed')).toBe('true')
    const chip = strip.locator('button[title]').last()
    await chip.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => panel.locator('article[data-session-id]').count()).toBe(1)
    expect(await chip.getAttribute('aria-pressed')).toBe('true')
    await filter.getByRole('button', { name: 'All workspaces', exact: true }).press('Enter')
    await expect.poll(() => panel.locator('article[data-session-id]').count()).toBe(8)

    try {
      await page.setViewportSize({ width: 768, height: 1000 })
      for (const rows of [2, 6]) {
        if (rows === 6) {
          await page.setViewportSize({ width: 320, height: 1000 })
          await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Overview', exact: true }).click()
        }
        await chooseSetting(page, 'Layout', 'Digest workspace strip', String(rows))
        await expect.poll(async () => (await stripGeometry(page)).rows).toBeGreaterThan(rows)
        const measured = await stripGeometry(page)
        const limit = rows * measured.chipHeight + (rows - 1) * measured.gap + measured.inset
        expect(measured.height).toBeLessThanOrEqual(limit + TOLERANCE)
        expect(measured.scrollHeight).toBeGreaterThan(measured.height)
      }
      await page.setViewportSize({ width: 1680, height: 1000 })
      const warningStart = tripwire.warnings.length
      await page.reload({ waitUntil: 'load' })
      await page.locator('[data-chat-turn]').first().waitFor({ state: 'attached' })
      await openDigest(page)
      acknowledgeReloadConnectionLoss(tripwire, warningStart)
      const persisted = await settingSelect(page, 'Layout', 'Digest workspace strip')
      expect(await persisted.inputValue()).toBe('6')
      await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()

      await page.setViewportSize({ width: 1680, height: 1000 })
      await Promise.all(workspaces.map((workspace, index) => workspace.setTitle(`W${index + 1}`)))
      await expect.poll(async () => (await stripGeometry(page)).rows).toBe(1)
      const small = await stripGeometry(page)
      expect(small.height).toBeLessThanOrEqual(small.chipHeight + small.inset + TOLERANCE)
      expect(await filter.getByRole('button', { name: 'Show all', exact: true }).count()).toBe(0)

      await Promise.all(workspaces.map((workspace, index) => workspace.setTitle(WORK[index]!.workspace)))
      await chooseSetting(page, 'Layout', 'Digest workspace strip', 'all')
      await expect.poll(async () => (await stripGeometry(page)).rows).toBeGreaterThan(1)
      const all = await stripGeometry(page)
      expect(all.scrollHeight).toBeLessThanOrEqual(all.height + TOLERANCE)
      expect(await filter.getByRole('button', { name: 'Show all', exact: true }).count()).toBe(0)
      await page.setViewportSize({ width: 320, height: 400 })
      await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', { name: 'Overview', exact: true }).click()
      const overview = page.getByRole('region', { name: 'Overview', exact: true })
      await overview.waitFor({ state: 'visible' })
      const shortStrip = await stripGeometry(page)
      expect(shortStrip.scrollHeight).toBeGreaterThan(shortStrip.height)
      expect((await overview.locator('[data-digest-body]').boundingBox())!.height).toBeGreaterThan(60)
      const close = overview.getByRole('button', { name: 'Close digest', exact: true })
      const closeBox = (await close.boundingBox())!
      expect(closeBox.y).toBeGreaterThanOrEqual(0)
      expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(400)
    } catch (error) {
      await saveFailureShot(page, 'digest-layout-strip-state-failure')
      throw error
    } finally {
      await page.setViewportSize({ width: 1680, height: 1000 })
      await Promise.all(workspaces.map((workspace, index) => workspace.setTitle(WORK[index]!.workspace)))
      await chooseSetting(page, 'Layout', 'Digest workspace strip', 'single')
    }
  })
})
