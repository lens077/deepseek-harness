// Web e2e scenario: the question panel loads the whole history on request. A
// deterministic 60-turn log (120 surface messages — three 50-message history
// pages) seeded cold through the REAL persistence API opens on its tail page;
// the panel admits that earlier questions are unloaded and offers to load all
// of them, one press pages every earlier page in, and the panel then lists
// every question with the admission and the offer gone. Zero model calls; the
// seed is generated, not recorded, because no line of it is model output.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/question-panel-load-all', import.meta.url))
const PANEL_EXPECTED = fileURLToPath(new URL('./snapshots/question-panel-load-all/panel.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'question-panel-load-all-web-e2e'

/** Turn count: 2 surface messages per turn, so 60 turns span three 50-message pages. */
const TURNS = 60

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
    at({
      type: 'user/message',
      data: { content: [{ type: 'text', text: `question ${turn}` }], source: { kind: 'user' } },
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
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /** The panel's question rows: the buttons carrying a question as their title. */
  const questionRows = () => page.locator('[role="dialog"][aria-label="Question history"] button[title]')

  it('admits the unloaded pages, then loads every one of them on one press', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-question-panel-load-all'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    // Settled barrier: the newest recorded reply renders from the tail page,
    // and the first turn is not loaded.
    await expect.poll(() => page.getByText(`reply ${TURNS}`, { exact: true }).count(), { timeout: 15_000 }).toBe(1)
    expect(await page.getByText('question 1', { exact: true }).count()).toBe(0)

    await page.getByRole('button', { name: 'Search questions' }).click()
    const panel = page.getByRole('dialog', { name: 'Question history' })
    await panel.waitFor({ timeout: 10_000 })
    // The list covers the window only, and says so beside the way to change that.
    await expect.poll(() => panel.getByRole('status').textContent(), { timeout: 5_000 })
      .toBe('Listing loaded questions only; earlier ones are not loaded yet.')
    const loadedBefore = await questionRows().count()
    expect(loadedBefore).toBeGreaterThan(0)
    expect(loadedBefore).toBeLessThan(TURNS)

    // The load-all entry stands on the rail under the search entry, outside the panel.
    await page.getByRole('button', { name: 'Load all history' }).click()
    // Three pages land one after another; the loop settles when nothing earlier remains.
    await expect.poll(() => page.getByText('question 1', { exact: true }).count(), { timeout: 20_000 }).toBe(1)
    await expect.poll(() => page.getByRole('button', { name: 'Loading all history…' }).count(), { timeout: 10_000 }).toBe(0)
    expect(await page.getByRole('button', { name: 'Load all history' }).count()).toBe(0)
    expect(await panel.getByRole('status').count()).toBe(0)
    expect(await questionRows().count()).toBe(TURNS)
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
