// @vitest-environment jsdom
/**
 * Task-flow presentation: the three drawings over one snapshot, the strip's
 * header facts and actions, the canvas toolbar with pan/zoom, the Settings
 * rows, the style policy, and the card layout geometry.
 */
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TaskFlowSettings } from '../src/settings.ts'
import { FlowGraph } from '../src/client/FlowGraph.tsx'
import { FlowStyleRow, type FlowStyleRowProps } from '../src/client/FlowStyleRow.tsx'
import { TaskFlowDock, type TaskFlowDockProps } from '../src/client/TaskFlowDock.tsx'
import { TaskFlowView, type TaskFlowViewProps } from '../src/client/TaskFlowView.tsx'
import type { FlowLane, FlowNode, FlowSnapshot } from '../src/client/flow-contract.ts'
import { DOCK_METRICS, layoutFlow } from '../src/client/flow-layout.ts'
import { EMPTY_FLOW_SNAPSHOT } from '../src/client/flow-model.ts'
import { formatDuration, laneAnchorLabel, laneKindLabel, nodeDetail, nodeTitle, terminalLabel } from '../src/client/format.ts'
import { en, zh } from '../src/client/locales.ts'
import { createTaskFlowDockStore } from '../src/client/stores.ts'
import { FlowStylePolicy } from '../src/client/style-policy.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = makeTranslate(zh) as never
const NOW = 100_000

function node(partial: Partial<FlowNode> & Pick<FlowNode, 'id' | 'kind' | 'laneId'>): FlowNode {
  return { title: '', status: 'done', anchorSeq: 1, turn: 1, ...partial }
}

/** Main line with a fan-out, a resolved interjection, and a stopped fork. */
function sample(): FlowSnapshot {
  const nodes: FlowNode[] = [
    node({ id: 'prompt:m1', kind: 'prompt', laneId: 'turn:1', title: '写一本小说', startTime: 1_000 }),
    node({ id: 'todo:1:0', kind: 'todo', laneId: 'turn:1', title: '规划', status: 'done', startTime: 2_000, endTime: 9_000 }),
    node({ id: 'agent:c1', kind: 'agent', laneId: 'turn:1', title: '规则系统设计师', detail: 'subagent', status: 'done', startTime: 3_000, endTime: 8_000, parentId: 'todo:1:0', callId: 'c1', anchorSeq: 3 }),
    node({ id: 'agent:c2', kind: 'agent', laneId: 'turn:1', title: '案卷作者', detail: 'subagent', status: 'error', startTime: 3_000, endTime: 8_000, parentId: 'todo:1:0', callId: 'c2', anchorSeq: 4 }),
    node({ id: 'todo:1:1', kind: 'todo', laneId: 'turn:1', title: '修订', status: 'running', startTime: 9_000, anchorSeq: 9 }),
    node({ id: 'todo:1:2', kind: 'todo', laneId: 'turn:1', title: '汇总', status: 'pending' }),
    node({ id: 'prompt:m2', kind: 'prompt', laneId: 'turn:2', title: '补充要求', status: 'done', startTime: 5_000, turn: 2 }),
    node({ id: 'steps:2', kind: 'steps', laneId: 'turn:2', status: 'done', stepCount: 2, startTime: 5_000, endTime: 6_000, turn: 2 }),
    node({ id: 'prompt:m3', kind: 'prompt', laneId: 'turn:3', title: '看下 CI', startTime: 7_000, turn: 3 }),
    node({ id: 'steps:3', kind: 'steps', laneId: 'turn:3', status: 'aborted', stepCount: 1, startTime: 7_000, endTime: 7_500, turn: 3 }),
    node({ id: 'end:3', kind: 'terminal', laneId: 'turn:3', status: 'aborted', detail: 'user', turn: 3, anchorSeq: 30 }),
  ]
  const lanes: FlowLane[] = [
    { id: 'turn:1', kind: 'main', turn: 1, ordinal: 1, label: '写一本小说', status: 'running', nodeIds: ['prompt:m1', 'todo:1:0', 'todo:1:1', 'todo:1:2', 'agent:c1', 'agent:c2'], startTime: 1_000 },
    { id: 'turn:2', kind: 'interjection', turn: 2, ordinal: 2, label: '补充要求', status: 'done', parentLaneId: 'turn:1', anchorNodeId: 'todo:1:0', nodeIds: ['prompt:m2', 'steps:2'], startTime: 5_000, endTime: 6_000 },
    { id: 'turn:3', kind: 'fork', turn: 3, ordinal: 3, label: '看下 CI', status: 'aborted', parentLaneId: 'turn:1', anchorNodeId: 'prompt:m1', nodeIds: ['prompt:m3', 'steps:3', 'end:3'], startTime: 7_000, endTime: 7_500 },
  ]
  return {
    lanes,
    nodes: new Map(nodes.map(entry => [entry.id, entry])),
    summary: { total: 5, done: 2, running: true, status: 'running', startTime: 1_000, currentNodeId: 'todo:1:1', latestBranchLaneId: 'turn:3' },
  }
}

const hook = <T,>(value: T): SnapshotSelectorHook<T> => selector => selector(value)

describe('FlowGraph drawings', () => {
  it('draws cards with fan-out edges, branch rows, and inspectable agents', () => {
    const onInspect = vi.fn()
    const view = render(<FlowGraph snapshot={sample()} variant="cards" now={NOW} t={t} onInspect={onInspect} />)
    const cards = view.container.querySelectorAll('[data-flow-node]')
    expect(cards).toHaveLength(11)
    expect(view.container.querySelectorAll('path')).toHaveLength(11)
    expect(view.getByText('规则系统设计师').closest('button')).not.toBeNull()
    fireEvent.click(view.getByText('规则系统设计师'))
    expect(onInspect).toHaveBeenCalledWith('c1')
    expect(view.getByText('已中止（手动停止）')).toBeTruthy()
    expect(view.getByText('主线')).toBeTruthy()
    expect(view.getByText('#3 新问题')).toBeTruthy()
    expect(view.getByText('1分31秒')).toBeTruthy()
  })

  it('draws the rail with parallel groups and anchored branch rows', () => {
    const view = render(<FlowGraph snapshot={sample()} variant="rail" now={NOW} t={t} onInspect={() => {}} />)
    expect(view.container.querySelector('[data-flow-variant="rail"]')).not.toBeNull()
    const branches = view.container.querySelectorAll('[data-flow-lane]')
    expect(branches).toHaveLength(2)
    expect(within(branches[0] as HTMLElement).getByText('挂在「规划」 ↳')).toBeTruthy()
    expect(within(branches[1] as HTMLElement).getByText('从「写一本小说」分叉 ↳')).toBeTruthy()
    expect(view.getByText('案卷作者').closest('button')).not.toBeNull()
    expect(view.getAllByText('5秒 · subagent')).toHaveLength(2)
    const bare: FlowLane = { id: 'turn:9', kind: 'fork', turn: 9, ordinal: 9, label: 'bare', status: 'running', nodeIds: ['missing'], startTime: 1 }
    const loose: FlowLane = { id: 'turn:8', kind: 'main', turn: 8, ordinal: 8, label: 'loose', status: 'running', nodeIds: ['prompt:m8', 'agent:c8', 'gone'], startTime: 1 }
    const nodes = new Map(sample().nodes)
    nodes.set('prompt:m8', node({ id: 'prompt:m8', kind: 'prompt', laneId: 'turn:8', title: 'loose', turn: 8 }))
    nodes.set('agent:c8', node({ id: 'agent:c8', kind: 'agent', laneId: 'turn:8', title: 'free agent', status: 'running', callId: 'c8', turn: 8 }))
    const sparse = render(<FlowGraph snapshot={{ ...sample(), lanes: [loose, ...sample().lanes.slice(1), bare], nodes }} variant="rail" now={NOW} t={t} />)
    expect(sparse.container.querySelectorAll('[data-flow-lane]')).toHaveLength(2)
    expect(sparse.getByText('free agent')).toBeTruthy()
  })

  it('draws lanes with per-route progress and localized status', () => {
    const onInspect = vi.fn()
    const view = render(<FlowGraph snapshot={sample()} variant="lanes" now={NOW} t={t} onInspect={onInspect} />)
    const lanes = view.container.querySelectorAll('[data-flow-lane]')
    expect(lanes).toHaveLength(3)
    fireEvent.click(view.getByText('规则系统设计师'))
    expect(onInspect).toHaveBeenCalledWith('c1')
    expect(within(lanes[0] as HTMLElement).getByText('2/5')).toBeTruthy()
    expect(within(lanes[1] as HTMLElement).getByText('1/1')).toBeTruthy()
    expect(within(lanes[2] as HTMLElement).getByText('0/1')).toBeTruthy()
    expect(within(lanes[2] as HTMLElement).getByText('已中止（手动停止）')).toBeTruthy()
  })

  it('draws a steer-only lane as one block with the lane status and renders the empty caption', () => {
    const base = sample()
    const steer: FlowLane = { id: 'steer:m9', kind: 'interjection', turn: 1, ordinal: 1, label: 'also', status: 'done', parentLaneId: 'turn:1', nodeIds: ['prompt:m9'], startTime: 1 }
    const nodes = new Map(base.nodes)
    nodes.set('prompt:m9', node({ id: 'prompt:m9', kind: 'prompt', laneId: 'steer:m9', title: 'also', status: 'running' }))
    const view = render(<FlowGraph snapshot={{ ...base, lanes: [...base.lanes, steer], nodes }} variant="lanes" now={NOW} t={t} />)
    const lane = view.container.querySelector('[data-flow-lane="steer:m9"]') as HTMLElement
    expect(within(lane).getByText('已解决')).toBeTruthy()
    const bare: FlowLane = { id: 'turn:9', kind: 'main', turn: 9, ordinal: 9, label: 'bare', status: 'running', nodeIds: [], startTime: 1 }
    const running: FlowLane = { id: 'turn:8', kind: 'main', turn: 8, ordinal: 8, label: 'r', status: 'running', nodeIds: ['steps:8'], startTime: 1 }
    nodes.set('steps:8', node({ id: 'steps:8', kind: 'steps', laneId: 'turn:8', status: 'risk', turn: 8 }))
    const odd = render(<FlowGraph snapshot={{ ...base, lanes: [bare, running], nodes }} variant="lanes" now={NOW} t={t} />)
    expect(within(odd.container.querySelector('[data-flow-lane="turn:9"]') as HTMLElement).getByText('进行中')).toBeTruthy()
    expect(within(odd.container.querySelector('[data-flow-lane="turn:8"]') as HTMLElement).getByText('1/1')).toBeTruthy()
    expect(within(odd.container.querySelector('[data-flow-lane="turn:8"]') as HTMLElement).getByText('⚠')).toBeTruthy()
    const empty = render(<FlowGraph snapshot={EMPTY_FLOW_SNAPSHOT} variant="rail" now={NOW} t={t} />)
    expect(empty.getByText(zh['canvas.empty'])).toBeTruthy()
  })
})

describe('card layout', () => {
  it('places fan-out agents in one stacked column and branch rows under their anchor', () => {
    const layout = layoutFlow(sample(), DOCK_METRICS)
    const at = (id: string) => layout.nodes.find(card => card.id === id)!
    expect(at('agent:c1').x).toBe(at('agent:c2').x)
    expect(at('agent:c1').x).toBeGreaterThan(at('todo:1:0').x)
    expect(at('todo:1:1').x).toBeGreaterThan(at('agent:c1').x)
    expect(at('agent:c1').y).toBeLessThan(at('agent:c2').y)
    expect(at('prompt:m2').x).toBe(at('todo:1:0').x + DOCK_METRICS.gapX)
    expect(at('prompt:m2').y).toBeGreaterThan(at('agent:c2').y)
    expect(at('prompt:m3').y).toBeGreaterThan(at('prompt:m2').y)
    expect(layout.rows.map(row => row.lane.id)).toEqual(['turn:1', 'turn:2', 'turn:3'])
    expect(layout.edges.filter(edge => edge.dashed)).toHaveLength(2)
    expect(layout.width).toBeGreaterThan(at('todo:1:2').x + DOCK_METRICS.nodeWidth)
    expect(layoutFlow(EMPTY_FLOW_SNAPSHOT, DOCK_METRICS)).toMatchObject({ width: DOCK_METRICS.padding, height: 0, nodes: [], edges: [] })
  })

  it('draws loose agents after the prompt and skips unknown node ids', () => {
    const lane: FlowLane = { id: 'turn:1', kind: 'main', turn: 1, ordinal: 1, label: 'x', status: 'running', nodeIds: ['prompt:m1', 'agent:c9', 'missing'], startTime: 1 }
    const nodes = new Map<string, FlowNode>([
      ['prompt:m1', node({ id: 'prompt:m1', kind: 'prompt', laneId: 'turn:1' })],
      ['agent:c9', node({ id: 'agent:c9', kind: 'agent', laneId: 'turn:1', callId: 'c9' })],
    ])
    const layout = layoutFlow({ lanes: [lane], nodes, summary: EMPTY_FLOW_SNAPSHOT.summary }, DOCK_METRICS)
    expect(layout.nodes.map(card => card.id)).toEqual(['prompt:m1', 'agent:c9'])
    const empty = layoutFlow({ lanes: [{ ...lane, nodeIds: ['missing'] }], nodes, summary: EMPTY_FLOW_SNAPSHOT.summary }, DOCK_METRICS)
    expect(empty.rows).toHaveLength(0)
  })
})

describe('format helpers', () => {
  it('formats durations, titles, details, and anchors', () => {
    expect(formatDuration(t, -5)).toBe('0秒')
    expect(formatDuration(t, 61_000)).toBe('1分1秒')
    expect(formatDuration(t, 3_700_000)).toBe('1小时1分')
    expect(nodeTitle(t, node({ id: 'p', kind: 'prompt', laneId: 'l' }))).toBe('你的任务')
    expect(nodeDetail(t, node({ id: 's', kind: 'steps', laneId: 'l' }))).toBe('0 步')
    expect(nodeDetail(t, node({ id: 'e', kind: 'terminal', laneId: 'l' }))).toBeUndefined()
    expect(terminalLabel(t, node({ id: 'e', kind: 'terminal', laneId: 'l', status: 'error', detail: 'boom' }))).toBe('出错 · boom')
    expect(terminalLabel(t, node({
      id: 'auth', kind: 'terminal', laneId: 'l', status: 'error', failureCode: 'AUTH',
    }))).toBe('出错 · API 密钥无效')
    expect(terminalLabel(t, node({ id: 'e', kind: 'terminal', laneId: 'l', status: 'interrupted' }))).toBe('异常中断')
    const lane: FlowLane = { id: 'x', kind: 'fork', turn: 2, ordinal: 2, label: '', status: 'done', anchorNodeId: 'gone', nodeIds: [], startTime: 1 }
    expect(laneAnchorLabel(t, lane, new Map())).toBeUndefined()
    expect(laneKindLabel(t, { ...lane, kind: 'main', ordinal: 1 })).toBe('#1 主线')
    expect(laneKindLabel(t, { ...lane, kind: 'interjection' })).toBe('#2 插话')
    const { anchorNodeId: _anchor, ...unanchored } = lane
    expect(laneAnchorLabel(t, unanchored, new Map())).toBeUndefined()
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

function sessionSnapshot(running: boolean): SessionSnapshot {
  return { sessionId: 's1', running } as SessionSnapshot
}

function dockProps(snapshot: FlowSnapshot, running = true) {
  const store = createTaskFlowDockStore().create('s1')
  const style = createSnapshotStore({ dock: 'rail' as const, canvas: 'cards' as const, fontSize: 11 })
  const actions = { stop: vi.fn(), openCanvas: vi.fn(), inspect: vi.fn(), setDockVariant: vi.fn(), setFontSize: vi.fn() }
  const props = {
    sessionId: 's1',
    session: sessionSnapshot(running),
    input: {} as never,
    useSession: hook(sessionSnapshot(running)),
    useSessions: hook({}),
    useWorkspaces: hook({}),
    useProjection: (() => undefined) as never,
    useTaskFlow: hook(snapshot),
    useMobileDock: hook(false),
    useFlowStyle: (selector: (style: { dock: 'rail'; canvas: 'cards' }) => unknown) => selector(style.getSnapshot()),
    useStore: (selector: (state: { expanded: boolean }) => unknown) => selector(store.store.getSnapshot()),
    actions: store.actions,
    ...actions,
    t,
  }
  return { props: props as unknown as TaskFlowDockProps, store, actions }
}

describe('TaskFlowDock', () => {
  it('renders nothing without lanes', () => {
    const { props } = dockProps(EMPTY_FLOW_SNAPSHOT)
    const view = render(<TaskFlowDock {...props} />)
    expect(view.container.querySelector('[data-task-flow-dock]')).toBeNull()
  })

  it('shows header facts, the running-only stop action, and routes the actions', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const { props, actions, store } = dockProps(sample())
    const view = render(<TaskFlowDock {...props} />)
    expect(view.getByText('2/5')).toBeTruthy()
    expect(view.getByText('用时 1分39秒')).toBeTruthy()
    expect(view.getByText('当前：修订')).toBeTruthy()
    expect(view.getByText(/最近分支：#3 新问题 看下 CI/)).toBeTruthy()
    expect(view.getByText('已中止')).toBeTruthy()
    expect(view.container.querySelector('[data-flow-variant="rail"]')).not.toBeNull()
    expect((view.container.querySelector('[data-task-flow-dock]') as HTMLElement).style.getPropertyValue('--dsh-task-flow-font-size')).toBe('11px')
    expect(view.getByRole('region', { name: '任务流程图' }).tabIndex).toBe(0)
    fireEvent.click(view.getByLabelText('增大任务流程字号'))
    expect(actions.setFontSize).toHaveBeenCalledWith(12)

    fireEvent.click(view.getByText('停止任务'))
    expect(actions.stop).toHaveBeenCalledTimes(1)
    fireEvent.click(view.getByText('在画布打开'))
    expect(actions.openCanvas).toHaveBeenCalledTimes(1)
    fireEvent.click(view.getByText('案卷作者'))
    expect(actions.inspect).toHaveBeenCalledWith('c2')

    fireEvent.click(view.getByLabelText('折叠流程图'))
    expect(store.store.getSnapshot().expanded).toBe(false)
    view.rerender(<TaskFlowDock {...props} />)
    expect(view.container.querySelector('[data-flow-variant]')).toBeNull()
    expect(view.getByLabelText('展开流程图')).toBeTruthy()

    fireEvent.click(view.getByLabelText('切换样式'))
    fireEvent.pointerDown(document.body)
    expect(view.queryByText('泳道面板')).toBeNull()
    fireEvent.click(view.getByLabelText('切换样式'))
    fireEvent.click(view.getByText('泳道面板'))
    expect(actions.setDockVariant).toHaveBeenCalledWith('lanes')

    act(() => { vi.advanceTimersByTime(2_000) })
    expect(view.getByText('用时 1分41秒')).toBeTruthy()
  })

  it('hides the stop action while the session is idle and reports a resolved latest branch', () => {
    const base = sample()
    const idle: FlowSnapshot = { ...base, summary: { total: 5, done: 2, running: false, status: 'done', startTime: 1_000, endTime: 8_000, latestBranchLaneId: 'turn:2' } }
    const { props } = dockProps(idle, false)
    const view = render(<TaskFlowDock {...props} />)
    expect(view.queryByText('停止任务')).toBeNull()
    expect(view.queryByText(/当前：/)).toBeNull()
    expect(view.getByText('用时 7秒')).toBeTruthy()
    expect(view.getByText('已解决')).toBeTruthy()
    const { latestBranchLaneId: _latest, ...noBranch } = idle.summary
    const bare = dockProps({ ...idle, summary: noBranch }, false)
    view.unmount()
    const second = render(<TaskFlowDock {...bare.props} />)
    expect(within(second.container).queryByText(/最近分支/)).toBeNull()
  })
})

describe('TaskFlowView', () => {
  function viewProps(snapshot: FlowSnapshot, viewRequest: { view: string; focus: string } | null = null, canvas: 'cards' | 'lanes' = 'cards') {
    const style = createSnapshotStore({ dock: 'rail' as const, canvas, fontSize: 11 })
    const actions = { stop: vi.fn(), setCanvasVariant: vi.fn(), openView: vi.fn(), completeViewRequest: vi.fn() }
    const props = {
      sessionId: 's1',
      useSession: hook(sessionSnapshot(true)),
      useSessions: hook({}),
      useWorkspaces: hook({}),
      useProjection: (() => undefined) as never,
      useTaskFlow: hook(snapshot),
      useFlowStyle: (selector: (style: { dock: 'rail'; canvas: 'cards' | 'lanes' }) => unknown) => selector(style.getSnapshot()),
      viewRequest,
      ...actions,
      t,
    }
    return { props: props as unknown as TaskFlowViewProps, actions }
  }

  it('draws the canvas with pan, zoom, fit, stop, back, and inspection', () => {
    const { props, actions } = viewProps(sample(), { view: 'task-flow', focus: '' })
    const view = render(<TaskFlowView {...props} />)
    expect(actions.completeViewRequest).toHaveBeenCalledTimes(1)
    const stage = view.container.querySelector('[data-flow-variant="cards"]')!.parentElement as HTMLElement
    expect(stage.style.transform).toBe('translate(40px, 40px) scale(1.2)')

    fireEvent.click(view.getByLabelText('放大'))
    expect(view.getByText('132%')).toBeTruthy()
    fireEvent.click(view.getByLabelText('缩小'))
    fireEvent.click(view.getByLabelText('缩小'))
    expect(view.getByText('109%')).toBeTruthy()
    const viewport = stage.parentElement as HTMLElement
    fireEvent.wheel(viewport, { deltaY: -100 })
    expect(view.getByText('120%')).toBeTruthy()
    for (let index = 0; index < 20; index += 1) fireEvent.wheel(viewport, { deltaY: 100 })
    expect(view.getByText('40%')).toBeTruthy()

    viewport.setPointerCapture = vi.fn()
    fireEvent.pointerDown(viewport, { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(viewport, { clientX: 30, clientY: 15 })
    fireEvent.pointerUp(viewport)
    expect(stage.style.transform).toBe('translate(60px, 45px) scale(0.4)')
    fireEvent.pointerMove(viewport, { clientX: 90, clientY: 90 })
    expect(stage.style.transform).toBe('translate(60px, 45px) scale(0.4)')
    fireEvent.pointerDown(viewport, { button: 2, clientX: 0, clientY: 0, pointerId: 2 })
    fireEvent.pointerMove(viewport, { clientX: 90, clientY: 90 })
    expect(stage.style.transform).toBe('translate(60px, 45px) scale(0.4)')

    fireEvent.click(view.getByText('适配全图'))
    expect(stage.style.transform).toBe('translate(40px, 40px) scale(1.2)')
    fireEvent.click(view.getByLabelText('放大'))
    fireEvent.click(view.getByText('132%'))
    expect(stage.style.transform).toBe('translate(40px, 40px) scale(1.2)')
    Object.defineProperty(viewport, 'clientWidth', { value: 880, configurable: true })
    Object.defineProperty(viewport, 'clientHeight', { value: 480, configurable: true })
    Object.defineProperty(stage, 'scrollWidth', { value: 1600, configurable: true })
    Object.defineProperty(stage, 'scrollHeight', { value: 500, configurable: true })
    fireEvent.click(view.getByText('适配全图'))
    expect(stage.style.transform).toBe('translate(40px, 40px) scale(0.5)')

    fireEvent.click(view.getByText('停止任务'))
    expect(actions.stop).toHaveBeenCalledTimes(1)
    fireEvent.click(view.getByText('返回对话'))
    expect(actions.openView).toHaveBeenCalledWith('chat', '')
    fireEvent.click(view.getByText('规则系统设计师'))
    expect(actions.openView).toHaveBeenCalledWith('trajectory', 'c1')
    fireEvent.click(view.getByLabelText('切换样式'))
    fireEvent.click(view.getByText('步骤轨道'))
    expect(actions.setCanvasVariant).toHaveBeenCalledWith('rail')
  })

  it('draws the lane board on the canvas stage', () => {
    const { props } = viewProps(sample(), null, 'lanes')
    const view = render(<TaskFlowView {...props} />)
    expect(view.container.querySelector('[data-flow-variant="lanes"]')).not.toBeNull()
  })

  it('shows the empty caption without lanes and leaves foreign view requests alone', () => {
    const { props, actions } = viewProps(EMPTY_FLOW_SNAPSHOT, { view: 'chat', focus: '' })
    const view = render(<TaskFlowView {...props} />)
    expect(view.getByText(zh['canvas.empty'])).toBeTruthy()
    expect(actions.completeViewRequest).not.toHaveBeenCalled()
    expect(view.getByText('0/0')).toBeTruthy()
    fireEvent.click(view.getByText('适配全图'))
    expect(view.getByText('120%')).toBeTruthy()
  })
})

describe('FlowStyleRow and FlowStylePolicy', () => {
  it('adopts the durable section, publishes before writing, and drives the rows', () => {
    const stub = stubSettingsScope<TaskFlowSettings>()
    const policy = new FlowStylePolicy(stub.scope)
    expect(policy.style.getSnapshot()).toEqual({ dock: 'rail', canvas: 'cards', fontSize: 11 })
    stub.publish({ status: 'ready', value: { dockVariant: 'lanes', canvasVariant: 'rail', fontSize: 11, mobileDock: false } })
    expect(policy.style.getSnapshot()).toEqual({ dock: 'lanes', canvas: 'rail', fontSize: 11 })
    stub.publish({ value: { dockVariant: 'lanes', canvasVariant: 'rail', fontSize: 11, mobileDock: false } })
    policy.setDock('lanes')
    expect(stub.set).not.toHaveBeenCalled()
    policy.setCanvas('cards')
    expect(stub.set).toHaveBeenCalledWith('canvasVariant', 'cards')
    policy.setDock('cards')
    expect(stub.set).toHaveBeenCalledWith('dockVariant', 'cards')
    policy.setCanvas('cards')
    expect(stub.set).toHaveBeenCalledTimes(2)
    expect(new FlowStylePolicy().style.getSnapshot()).toEqual({ dock: 'rail', canvas: 'cards', fontSize: 11 })

    const setVariant = vi.fn()
    const rowProps = (target: 'dock' | 'canvas'): FlowStyleRowProps => ({
      useFlowStyle: (selector: (style: unknown) => unknown) => selector(policy.style.getSnapshot()),
      target,
      setVariant,
      t,
    } as unknown as FlowStyleRowProps)
    const view = render(<FlowStyleRow {...rowProps('canvas')} />)
    expect(view.getByText(zh['settings.canvas.title'])).toBeTruthy()
    expect(view.getByText('卡片节点图')).toBeTruthy()
    fireEvent.click(view.getByText('卡片节点图'))
    fireEvent.pointerDown(document.body)
    expect(view.queryByText('泳道面板')).toBeNull()
    fireEvent.click(view.getByText('卡片节点图'))
    fireEvent.click(view.getByText('泳道面板'))
    expect(setVariant).toHaveBeenCalledWith('lanes')
    const dock = render(<FlowStyleRow {...rowProps('dock')} />)
    expect(dock.getByText(zh['settings.dock.title'])).toBeTruthy()
  })
})
