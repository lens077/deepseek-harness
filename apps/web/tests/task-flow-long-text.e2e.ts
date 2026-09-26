// Task-flow long-text geometry: the strip and the canvas draw every variant
// with long prompts, long todos, a framework-failed delegated agent, a user
// abort, a goal continuation, and an unrelated follow-up, and no node clips,
// overflows, or overlaps a neighbour. Measured in a real browser because the
// defects (fixed-height cards, flex-shrunk rail tracks, orphaned lane arrows)
// only exist in layout, never in the DOM tree jsdom sees.
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createMessage, createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-tool-todo'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/task-flow-long-text', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'task-flow-long-text-web-e2e'
const DONE = 'TASK_FLOW_LONG_TEXT_DONE'

/** 300 code units mixing CJK and Latin: wider than any node and wider than the old 80-character clip. */
const LONG_PROMPT = '解决画布文字过长问题被隐藏的问题，考虑做成多行，但你同时要考虑到图2在多任务多流程时的展示问题。'
  + '可能需要重新改成多行显示，但你也要处理断点（系统（包括模型自身错误，DSH框架错误）错误，用户中断，继续实现，'
  + '或者已完成的当前任务，用户继续提问跟当前主线无关的问题（你同时需要判断）），解决这些问题 '
  + 'and keep the resident strip readable while the canvas keeps every route on one line.'
const LONG_TODO = '补充系统/框架错误、中断、继续、完成、无关提问的可见性回归测试 and verify each drawing in a real browser'
const AGENT_LABEL = 'Review task-flow state coverage against the durable session log and report every gap'
const FRAMEWORK_ERROR = 'DSH framework error: the child worker could not be resumed after the user interruption'
const PROVIDER_ERROR = 'OpenAI API error (429): usage limit reached; resets in 316655 seconds'
const CONTINUATION = '继续实现 rail、cards、lanes 的长文本多行与响应式布局'
const FOLLOW_UP = '换个话题：这个仓库的发布流程是什么？'

const VARIANTS = ['Card graph', 'Step rail', 'Lane board'] as const
type Variant = typeof VARIANTS[number]
const VARIANT_ATTR: Record<Variant, string> = { 'Card graph': 'cards', 'Step rail': 'rail', 'Lane board': 'lanes' }

function fixture(): string {
  const session = Session.create(SessionId('task-flow-long-text-source'))
  const origin = new Date().setHours(12, 0, 0, 0)
  const model = { kind: 'model', provider: 'fixture', model: 'fixture' } as const

  // Turn 1: long prompt, todo spine with a long item, a delegated agent that fails with a framework code, user abort.
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: LONG_PROMPT }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', { title: 'Task flow long text', messageSeqs: [user.seq], source: { kind: 'fallback' } })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('todo/write', {
    todos: [
      { content: '确认 task-flow 文本隐藏与断点状态的当前数据/渲染路径', status: 'completed' },
      { content: LONG_TODO, status: 'in_progress' },
      { content: '更新 package 文档与 Agent Note，整理变更', status: 'pending' },
    ],
  })
  const callId = ToolCallId('task-flow-agent-1')
  session.append('assistant/message', {
    stream: [], turn: 1, step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: callId, name: 'subagent', arguments: JSON.stringify({ description: AGENT_LABEL, prompt: 'x' }) }],
      source: model,
    }),
  }, { surfaceOp: 'append' })
  const call = session.append('tool/call', {
    turn: 1, step: 1, callId, name: 'subagent', arguments: JSON.stringify({ description: AGENT_LABEL, prompt: 'x' }),
  })
  session.append('tool/result', {
    turn: 1, step: 1,
    message: createToolResultMessage({ callId, content: [{ type: 'text', text: FRAMEWORK_ERROR }], isError: true }),
    error: { name: 'FrameworkError', code: 'DSH_CHILD_RESUME' },
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })

  // Turn 2: a goal-owned automatic continuation that ends in a coded provider error.
  session.append('turn/start', { turn: 2 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: CONTINUATION }],
    source: { kind: 'goal', goalId: 'goal-long-text', revision: 1, round: 1 } as never,
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 2, step: 1 })
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: { kind: 'error', error: { code: 'QUOTA', message: PROVIDER_ERROR } } })

  // Turn 3: an unrelated follow-up question that completes.
  session.append('turn/start', { turn: 3 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: FOLLOW_UP }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 3, step: 1 })
  session.append('assistant/message', {
    stream: [], turn: 3, step: 1,
    message: createMessage({ role: 'assistant', content: [{ type: 'text', text: DONE }], source: model }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 3, step: 1 })
  session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })

  return [
    JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', createdAt: 0, cwd: '{{cwd}}', isSeeded: false, delegationDepth: 0,
    }),
    ...session.snapshotEvents().map(event => JSON.stringify({ ...event, time: origin + event.seq * 1_000 })),
    '',
  ].join('\n')
}

interface Box { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

interface NodeGeometry {
  readonly id: string
  readonly box: Box
  /** Bounding box of the node's laid-out text (client rects of every text run). */
  readonly text: Box
  readonly title: string | null
  readonly textContent: string
}

interface GraphGeometry {
  readonly variant: string
  /** The graph's own box and its scrollable extent. */
  readonly graph: Box & { readonly scrollW: number; readonly scrollH: number }
  readonly nodes: readonly NodeGeometry[]
}

/** Measure one drawing: every `[data-flow-node]` box, its visible text extent, and the graph extent. */
async function measure(graph: Locator): Promise<GraphGeometry> {
  return graph.evaluate((root: HTMLElement) => {
    const box = (rect: DOMRect): Box => ({ x: rect.left, y: rect.top, w: rect.width, h: rect.height })
    const textBox = (element: HTMLElement): Box => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if ((node.textContent ?? '').trim() === '') continue
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const rect of range.getClientRects()) {
          if (rect.width === 0 || rect.height === 0) continue
          left = Math.min(left, rect.left); top = Math.min(top, rect.top)
          right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom)
        }
      }
      return left === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: left, y: top, w: right - left, h: bottom - top }
    }
    const rect = root.getBoundingClientRect()
    return {
      variant: root.getAttribute('data-flow-variant') ?? '',
      graph: { ...box(rect), scrollW: root.scrollWidth, scrollH: root.scrollHeight },
      // Lane-board route labels carry the prompt outside any node; they obey the same containment rules.
      nodes: [...root.querySelectorAll<HTMLElement>('[data-flow-node], [data-flow-lane-label]')].map(element => ({
        id: element.getAttribute('data-flow-node') ?? `label:${element.getAttribute('data-flow-lane-label') ?? ''}`,
        box: box(element.getBoundingClientRect()),
        text: textBox(element),
        title: element.getAttribute('title'),
        textContent: element.textContent ?? '',
      })),
    }
  })
}

const TOLERANCE = 1.5

function within(inner: Box, outer: Box): boolean {
  return inner.x >= outer.x - TOLERANCE && inner.y >= outer.y - TOLERANCE
    && inner.x + inner.w <= outer.x + outer.w + TOLERANCE && inner.y + inner.h <= outer.y + outer.h + TOLERANCE
}

function overlaps(a: Box, b: Box): boolean {
  return a.x + TOLERANCE < b.x + b.w && b.x + TOLERANCE < a.x + a.w && a.y + TOLERANCE < b.y + b.h && b.y + TOLERANCE < a.y + a.h
}

/** The geometry invariants every drawing must satisfy, reported as a list of violations so one failure names them all. */
function violations(geometry: GraphGeometry): string[] {
  const out: string[] = []
  const nodes = geometry.nodes
  expect(nodes.length).toBeGreaterThan(0)
  for (const node of nodes) {
    if (!within(node.text, node.box)) out.push(`${geometry.variant}: text of ${node.id} escapes its node (${JSON.stringify(node.text)} vs ${JSON.stringify(node.box)})`)
    if (node.box.w < 8 || node.box.h < 8) out.push(`${geometry.variant}: ${node.id} collapsed to ${node.box.w}x${node.box.h}`)
  }
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i]!; const b = nodes[j]!
      // Agents stacked in one column and lane blocks are siblings; nothing may overlap anything.
      if (overlaps(a.box, b.box)) out.push(`${geometry.variant}: ${a.id} overlaps ${b.id}`)
    }
  }
  return out
}

/** Every node id must name a route/spine element the fixture produced; the prompt must be complete somewhere on the node. */
function assertContent(geometry: GraphGeometry): void {
  const promptNodes = geometry.nodes.filter(node => node.id.startsWith(geometry.variant === 'lanes' ? 'label:' : 'prompt:'))
  expect(promptNodes.length).toBe(3)
  const longest = promptNodes.reduce((best, node) => (node.textContent.length > best.textContent.length ? node : best))
  if (geometry.variant === 'cards') {
    // The card graph bounds every card; the complete prompt travels on the tooltip.
    expect(longest.title).toBe(LONG_PROMPT)
  } else {
    expect(longest.textContent).toContain(LONG_PROMPT)
    expect(longest.textContent).not.toContain('…')
  }
  const agent = geometry.nodes.find(node => node.id === 'agent:task-flow-agent-1')
  expect(agent, `${geometry.variant} draws the failed delegated agent`).toBeDefined()
  expect(agent!.textContent).toContain(AGENT_LABEL)
  expect(agent!.title).toContain(AGENT_LABEL)
  expect(agent!.title).toContain('DSH_CHILD_RESUME')
  expect(agent!.title).toContain(FRAMEWORK_ERROR)
}

describe('web e2e: task-flow long text in every drawing', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, fixture(), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await page.getByText(DONE, { exact: true }).waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /** Select a drawing variant through the style menu anchored inside `scope`. */
  async function selectVariant(scope: Locator, variant: Variant): Promise<Locator> {
    await scope.getByRole('button', { name: 'Switch style', exact: true }).click()
    await page.getByRole('menuitem', { name: variant, exact: true }).click()
    const graph = scope.locator(`[data-flow-variant="${VARIANT_ATTR[variant]}"]`)
    await graph.waitFor({ timeout: 10_000 })
    return graph
  }

  it.skipIf(MODE === 'record')('keeps every strip variant readable with the whole history shown', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-task-flow-long-text-dock'))
    const dock = page.locator('[data-task-flow-dock]')
    await dock.waitFor({ timeout: 10_000 })
    const collapsed = dock.getByRole('button', { name: 'Expand flow graph', exact: true })
    if (await collapsed.count() > 0) await collapsed.click()
    const history = dock.getByRole('button', { name: 'Show earlier turns', exact: true })
    if (await history.count() > 0) await history.click()
    // The header names the stopped and failed routes and the continuation without clipping the strip.
    expect(await dock.getByText(/2 stopped/).count()).toBe(1)
    for (const variant of VARIANTS) {
      const graph = await selectVariant(dock, variant)
      const geometry = await measure(graph)
      expect(violations(geometry)).toEqual([])
      assertContent(geometry)
      // The strip body owns scrolling; the drawing itself never clips its own nodes.
      for (const node of geometry.nodes) {
        expect(node.box.x + node.box.w, `${variant}: ${node.id} exceeds the graph's scroll extent`)
          .toBeLessThanOrEqual(geometry.graph.x + geometry.graph.scrollW + TOLERANCE)
      }
      await compareOrRefreshGolden(
        `${SNAPSHOT_DIR}/dock-${VARIANT_ATTR[variant]}.expected.md`,
        (await captureStableAria(page, '[data-task-flow-dock]', scaffold.workspaceCwd)).split(SEED_ID).join('{{seededId}}'),
        MODE,
      )
    }
  }, 90_000)

  it.skipIf(MODE === 'record')('keeps every canvas variant readable on the pan/zoom stage', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-task-flow-long-text-canvas'))
    await page.locator('[data-task-flow-dock]').getByRole('button', { name: 'Open in canvas', exact: true }).click()
    const view = page.locator('[data-task-flow-view]')
    await view.waitFor({ timeout: 10_000 })
    for (const variant of VARIANTS) {
      const graph = await selectVariant(view, variant)
      const geometry = await measure(graph)
      expect(violations(geometry)).toEqual([])
      assertContent(geometry)
      await compareOrRefreshGolden(
        `${SNAPSHOT_DIR}/canvas-${VARIANT_ATTR[variant]}.expected.md`,
        (await captureStableAria(page, '[data-task-flow-view]', scaffold.workspaceCwd)).split(SEED_ID).join('{{seededId}}'),
        MODE,
      )
    }
    await view.getByRole('button', { name: 'Back to chat', exact: true }).click()
    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 10_000 }).toBe(1)
  }, 90_000)

  it('issued zero model calls and stayed clean', async () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'dock-cards.expected.md', 'dock-rail.expected.md', 'dock-lanes.expected.md',
      'canvas-cards.expected.md', 'canvas-rail.expected.md', 'canvas-lanes.expected.md',
    ])
  })
})
