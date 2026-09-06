// Web e2e scenario: the question rail loads the whole history on request. A
// deterministic 60-turn log (120 surface messages — three 50-message history
// pages) seeded cold through the REAL persistence API opens on 25 context-only
// turns, so no question exists in the loaded tail. Search and stepping remain
// visible but disabled while Load all stays usable; one press pages every
// earlier page in and enables the complete question panel. Zero model calls;
// the seed is generated, not recorded, because no line of it is model output.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/question-panel-load-all', import.meta.url))
const PANEL_EXPECTED = fileURLToPath(new URL('./expected/question-panel-load-all/panel.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'question-panel-load-all-web-e2e'

/** Turn count: 2 surface messages per turn, so 60 turns span three 50-message pages. */
const TURNS = 60
/** Direct questions end before the 25-turn tail page; later user messages are plugin context. */
const QUESTION_TURNS = 35

/**
 * Generate the seed: TURNS closed single-step turns of one short user prompt
 * and one short assistant reply each. Times are fixed so the fixture is
 * byte-deterministic; message ids are synthetic uuids (aria normalizes them).
 * @param turns - closed turns to generate.
 * @returns session.jsonl text for {@link seedSession}.
 */
function buildSeed(turns: number): string {
  const lines = [JSON.stringify({
    type: 'session', version: 0, id: '{{sessionId}}', createdAt: 1784974100000, cwd: '{{cwd}}/workspace',
  })]
  let seq = 0
  let time = 1784974100000
  const at = (event: Record<string, unknown>): void => {
    lines.push(JSON.stringify({ ...event, seq: seq++, time: time++ }))
  }
  for (let turn = 1; turn <= turns; turn++) {
    at({ type: 'turn/start', data: { turn } })
    const directQuestion = turn <= QUESTION_TURNS
    at({
      type: 'user/message',
      data: {
        content: [{ type: 'text', text: directQuestion ? `question ${turn}` : `runtime context ${turn}` }],
        source: directQuestion ? { kind: 'user' } : { kind: 'plugin', plugin: 'question-panel-load-all-fixture' },
      },
      surfaceOp: 'append',
    })
    at({ type: 'step/start', data: { turn, step: 1 } })
    at({
      type: 'assistant/message',
      data: {
        turn,
        step: 1,
        message: {
          id: `00000000-0000-4000-8000-${String(turn).padStart(12, '0')}`,
          role: 'assistant',
          content: [{ type: 'text', text: `reply ${turn}` }],
          source: { kind: 'model', provider: 'snapshot', model: 'snapshot-replier' },
        },
      },
      sourceEventSeqs: [],
      surfaceOp: 'append',
    })
    at({ type: 'step/end', data: { turn, step: 1 } })
    at({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  return `${lines.join('\n')}\n`
}

describe('web e2e: the question panel loads the whole history on request', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    if (MODE === 'record') throw new Error('question-panel-load-all is a keyless assembled snapshot')
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, buildSeed(TURNS), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /** The panel's question rows: the buttons carrying a question as their title. */
  const questionRows = () => page.locator('[role="dialog"][aria-label="Question history"] button[title]')

  it('keeps load-all usable before any question is loaded, then enables the complete panel', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-question-panel-load-all'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    // The tail page contains context and replies but no direct user question.
    await expect.poll(() => page.getByText(`reply ${TURNS}`, { exact: true }).count(), { timeout: 15_000 }).toBe(1)
    expect(await page.locator('[data-chat-flow-kind="user"]').getByText('question 1', { exact: true }).count()).toBe(0)

    const search = page.getByRole('button', { name: 'Search questions' })
    const previous = page.getByRole('button', { name: 'Previous question' })
    const next = page.getByRole('button', { name: 'Next question' })
    const loadAll = page.getByRole('button', { name: 'Load all history' })
    await search.waitFor({ timeout: 10_000 })
    expect(await search.isDisabled()).toBe(true)
    expect(await previous.isDisabled()).toBe(true)
    expect(await next.isDisabled()).toBe(true)
    expect(await loadAll.isEnabled()).toBe(true)
    const assertRailPlacement = async (rightGap: number, compareFlow: boolean): Promise<void> => {
      const viewport = page.viewportSize()
      const flowBox = compareFlow ? await page.locator('[data-chat-flow]').boundingBox() : null
      if (viewport === null || (compareFlow && flowBox === null)) {
        throw new Error('question rail or chat flow has no measurable viewport box')
      }
      for (const control of [search, loadAll, previous, next]) {
        const controlBox = await control.boundingBox()
        if (controlBox === null) throw new Error('question rail control has no measurable viewport box')
        expect(Math.round(viewport.width - controlBox.x - controlBox.width)).toBe(rightGap)
        if (flowBox !== null) {
          expect(controlBox.x + controlBox.width / 2).toBeGreaterThan(flowBox.x + flowBox.width)
        }
      }
    }
    await assertRailPlacement(8, true)

    await page.setViewportSize({ width: 600, height: 900 })
    await page.locator('[data-mobile-view="overview"]').waitFor()
    await page.getByRole('button', { name: 'Close digest', exact: true }).click()
    await page.locator('[data-mobile-view="conversation"]').waitFor()
    await expect.poll(async () => {
      const narrowBox = await search.boundingBox()
      return narrowBox === null ? null : Math.round(600 - narrowBox.x - narrowBox.width)
    }).toBe(8)
    await assertRailPlacement(8, false)
    await page.setViewportSize({ width: 1680, height: 1000 })

    await loadAll.click()
    await expect.poll(() => page.locator('[data-chat-flow-kind="user"]').getByText('question 1', { exact: true }).count(), { timeout: 20_000 }).toBe(1)
    await expect.poll(() => page.getByRole('button', { name: 'Loading all history…' }).count(), { timeout: 10_000 }).toBe(0)
    expect(await page.getByRole('button', { name: 'Load all history' }).count()).toBe(0)
    expect(await search.isEnabled()).toBe(true)

    await search.click()
    const panel = page.getByRole('dialog', { name: 'Question history' })
    await panel.waitFor({ timeout: 10_000 })
    expect(await panel.getByRole('status').count()).toBe(0)
    expect(await questionRows().count()).toBe(QUESTION_TURNS)
    // The transcript's own paging offer is gone with the last page.
    expect(await page.getByRole('button', { name: 'Load earlier' }).count()).toBe(0)
  }, 90_000)

  it('matches the loaded panel aria golden', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-question-panel-load-all-aria'))
    const snapshot = (await captureStableAria(page, '[role="dialog"][aria-label="Question history"]', scaffold.workspaceCwd))
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(PANEL_EXPECTED, snapshot, MODE)
  })

  it('issued zero model calls and stayed clean', async () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['panel.expected.md'])
  })
})
