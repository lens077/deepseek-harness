/**
 * Task-flow fold: the four Definitions replayed through the real assembler
 * produce one snapshot whose lanes, spine, fan-out, anchors, and terminal
 * states follow the durable events; live append equals whole replace, and
 * an older prepend keeps unchanged keyed Nodes.
 */
import { describe, expect, it } from 'vitest'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  ConversationNodeAssembler, type ConversationNodeDefinition, type ConversationStartMatch, type ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  agentLabel, createAgentDefinition, inboxDefinition, previewText, promptDefinition, todoDefinition,
} from '../src/client/flow-definitions.ts'
import { flowViewDefinition } from '../src/client/flow-view.ts'
import { buildFlowSnapshot, EMPTY_FLOW_SNAPSHOT } from '../src/client/flow-model.ts'
import type { FlowSnapshot } from '../src/client/flow-contract.ts'

const DEFINITIONS: readonly ConversationNodeDefinition[] = [
  promptDefinition, inboxDefinition, todoDefinition, createAgentDefinition(['subagent', 'workflow']),
]

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] { return DEFINITIONS }

  fallbackEntry(): ConversationNodeDefinition | undefined { return undefined }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] { return [flowViewDefinition] }
}

function at(seq: number, type: string, data: unknown, extra: Record<string, unknown> = {}): SessionLiveEventEntry {
  return { type: 'event', event: { seq, time: seq * 1_000, type, data, ...extra } as SessionEvent }
}

const user = (seq: number, id: string, text: string) => at(seq, 'user/message', {
  id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' },
}, { surfaceOp: 'append' })
const spliced = (seq: number, ids: readonly string[], target = 'next-turn') => at(seq, 'agent/inbox/spliced', {
  target, start: 0, inserted: ids.map(id => ({ id, role: 'user', content: [], source: { kind: 'user' } })),
})
const todo = (seq: number, todos: readonly [string, 'pending' | 'in_progress' | 'completed'][]) => at(seq, 'todo/write', {
  todos: todos.map(([content, status]) => ({ content, status })),
})
const call = (seq: number, callId: string, name: string, args: Record<string, unknown>, turn: number, step = 1) =>
  at(seq, 'tool/call', { turn, step, callId, name, arguments: JSON.stringify(args) })
const result = (seq: number, callId: string, isError = false, turn = 1) => at(seq, 'tool/result', {
  turn, step: 1,
  message: { role: 'user', source: { kind: 'tool', callId }, content: [{ type: 'tool-result', toolCallId: callId, content: [], isError }] },
}, { surfaceOp: 'append' })
const turnStart = (seq: number, turn: number) => at(seq, 'turn/start', { turn })
const turnEnd = (seq: number, turn: number, reason: unknown) => at(seq, 'turn/end', { turn, reason })
const stepStart = (seq: number, turn: number, step: number) => at(seq, 'step/start', { turn, step })
const stepEnd = (seq: number, turn: number, step: number) => at(seq, 'step/end', { turn, step })

/** A three-turn session: main line with todos and two agents, a queued interjection stopped by the user, and an open fork. */
const SCENARIO: readonly SessionLiveEventEntry[] = [
  spliced(1, ['m1']),
  turnStart(2, 1),
  user(3, 'm1', '  写一本  小说 '),
  stepStart(4, 1, 1),
  todo(5, [['规划', 'in_progress'], ['写作', 'pending'], ['审校', 'pending']]),
  todo(6, [['规划', 'completed'], ['写作', 'in_progress'], ['审校', 'pending']]),
  call(7, 'c1', 'subagent', { description: '规则系统设计师', prompt: 'x' }, 1),
  call(8, 'c2', 'subagent', { prompt: '第一章案卷作者' }, 1),
  call(9, 'c3', 'read', { file_path: 'a' }, 1),
  spliced(10, ['m2']),
  result(11, 'c1'),
  result(12, 'c2', true),
  result(13, 'c3'),
  todo(14, [['规划', 'completed'], ['写作', 'completed'], ['审校', 'in_progress']]),
  stepEnd(15, 1, 1),
  turnEnd(16, 1, { kind: 'completed' }),
  turnStart(17, 2),
  user(18, 'm2', '顺便看下 CI'),
  stepStart(19, 2, 1),
  stepEnd(20, 2, 1),
  turnEnd(21, 2, { kind: 'aborted', reason: { kind: 'user' } }),
  spliced(22, ['m3']),
  turnStart(23, 3),
  user(24, 'm3', '换个话题'),
  stepStart(25, 3, 1),
]

function assemble(entries: readonly SessionLiveEventEntry[], hasMore = false): ConversationNodeAssembler {
  const assembler = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  assembler.replaceWindow(entries, hasMore)
  assembler.activateTarget('task-flow')
  return assembler
}

function snapshotOf(assembler: ConversationNodeAssembler): FlowSnapshot {
  return assembler.snapshot('task-flow') as FlowSnapshot
}

describe('task-flow fold', () => {
  it('assembles lanes, spine, fan-out, anchors, and terminal states from one complete window', () => {
    const snapshot = snapshotOf(assemble(SCENARIO))
    expect(snapshot.lanes.map(lane => [lane.id, lane.kind, lane.ordinal, lane.status, lane.anchorNodeId])).toEqual([
      ['turn:1', 'main', 1, 'risk', undefined],
      ['turn:2', 'interjection', 2, 'aborted', 'todo:1:1'],
      ['turn:3', 'fork', 3, 'running', 'prompt:m1'],
    ])
    const main = snapshot.lanes[0]!
    expect(main.nodeIds).toEqual(['prompt:m1', 'todo:1:0', 'todo:1:1', 'todo:1:2', 'agent:c1', 'agent:c2'])
    expect(main.label).toBe('写一本 小说')
    expect(snapshot.nodes.get('todo:1:0')).toMatchObject({ kind: 'todo', title: '规划', status: 'done', startTime: 5_000, endTime: 6_000 })
    expect(snapshot.nodes.get('todo:1:1')).toMatchObject({ status: 'risk', startTime: 6_000, endTime: 14_000 })
    expect(snapshot.nodes.get('todo:1:2')).toMatchObject({ status: 'pending', startTime: 14_000 })
    expect(snapshot.nodes.get('agent:c1')).toMatchObject({
      kind: 'agent', title: '规则系统设计师', detail: 'subagent', status: 'done', parentId: 'todo:1:1',
      startTime: 7_000, endTime: 11_000, callId: 'c1', anchorSeq: 7,
    })
    expect(snapshot.nodes.get('agent:c2')).toMatchObject({ title: '第一章案卷作者', status: 'error', parentId: 'todo:1:1' })
    expect(snapshot.nodes.has('agent:c3')).toBe(false)

    const interjection = snapshot.lanes[1]!
    expect(interjection.nodeIds).toEqual(['prompt:m2', 'steps:2', 'end:2'])
    expect(snapshot.nodes.get('steps:2')).toMatchObject({ kind: 'steps', status: 'aborted', stepCount: 1, startTime: 17_000, endTime: 21_000 })
    expect(snapshot.nodes.get('end:2')).toMatchObject({ kind: 'terminal', status: 'aborted', detail: 'user', anchorSeq: 21 })

    const fork = snapshot.lanes[2]!
    expect(fork.nodeIds).toEqual(['prompt:m3', 'steps:3'])
    expect(snapshot.nodes.get('steps:3')).toMatchObject({ status: 'running', stepCount: 1 })

    expect(snapshot.summary).toEqual({
      total: 7,
      done: 3,
      running: true,
      status: 'running',
      startTime: 2_000,
      currentNodeId: 'steps:3',
      latestBranchLaneId: 'turn:3',
    })
  })

  it('produces the same snapshot for live append as for whole replace', () => {
    const replaced = snapshotOf(assemble(SCENARIO))
    const assembler = assemble(SCENARIO.slice(0, 4))
    for (const entry of SCENARIO.slice(4)) {
      assembler.append(entry)
      assembler.flush()
    }
    expect(snapshotOf(assembler)).toEqual(replaced)
  })

  it('keeps an update-only tail pending until the older page supplies its start, then matches whole replace', () => {
    const split = 9
    const assembler = assemble(SCENARIO.slice(split), true)
    const tail = snapshotOf(assembler)
    expect(tail.lanes.map(lane => lane.id)).toEqual(['turn:2', 'turn:3'])
    expect(tail.lanes[0]).toMatchObject({ kind: 'main' })
    assembler.prepend(SCENARIO.slice(0, split), false)
    assembler.flush()
    expect(snapshotOf(assembler)).toEqual(snapshotOf(assemble(SCENARIO)))
  })

  it('completes the main line, settles queued interjections, and reports the end time once nothing runs', () => {
    const closed = [
      ...SCENARIO,
      stepEnd(26, 3, 1),
      turnEnd(27, 3, { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } }),
    ]
    const snapshot = snapshotOf(assemble(closed))
    expect(snapshot.lanes[2]).toMatchObject({ status: 'error', endTime: 27_000 })
    expect(snapshot.nodes.get('end:3')).toMatchObject({ status: 'error', detail: 'boom' })
    expect(snapshot.summary).toMatchObject({ running: false, status: 'error', endTime: 27_000 })
    expect(snapshot.summary.currentNodeId).toBeUndefined()
  })

  it('draws a steer inside an open turn as an interjection hanging off the running spine node', () => {
    const steered = [
      spliced(1, ['m1']),
      turnStart(2, 1),
      user(3, 'm1', 'task'),
      stepStart(4, 1, 1),
      todo(5, [['A', 'in_progress'], ['B', 'pending']]),
      spliced(6, ['m9'], 'next-step'),
      stepEnd(7, 1, 1),
      stepStart(8, 1, 2),
      user(9, 'm9', 'also do this'),
    ]
    const snapshot = snapshotOf(assemble(steered))
    expect(snapshot.lanes.map(lane => [lane.id, lane.kind, lane.anchorNodeId, lane.status])).toEqual([
      ['turn:1', 'main', undefined, 'running'],
      ['steer:m9', 'interjection', 'todo:1:0', 'running'],
    ])
    expect(snapshot.lanes[1]!.nodeIds).toEqual(['prompt:m9'])
    expect(snapshot.nodes.get('prompt:m9')).toMatchObject({ status: 'running' })
    const done = snapshotOf(assemble([...steered, stepEnd(10, 1, 2), turnEnd(11, 1, { kind: 'completed' })]))
    expect(done.nodes.get('prompt:m9')).toMatchObject({ status: 'done' })
    expect(done.lanes[1]).toMatchObject({ status: 'done' })
  })

  it('distinguishes crash-closed, blocked, and max-tokens turn ends', () => {
    const base = [spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'x'), stepStart(4, 1, 1), stepEnd(5, 1, 1)]
    const outcomes: [unknown, string, string | undefined][] = [
      [{ kind: 'interrupted' }, 'interrupted', undefined],
      [{ kind: 'blocked' }, 'error', 'blocked'],
      [{ kind: 'max-tokens' }, 'error', 'max-tokens'],
      [{ kind: 'aborted', reason: { kind: 'legacy' } }, 'aborted', 'legacy'],
      [{ kind: 'unknown-future' }, 'done', undefined],
    ]
    for (const [reason, status, detail] of outcomes) {
      const snapshot = snapshotOf(assemble([...base, turnEnd(6, 1, reason)]))
      expect(snapshot.lanes[0]!.status).toBe(status)
      const terminal = snapshot.nodes.get('end:1')
      if (status === 'done') expect(terminal).toBeUndefined()
      else expect(terminal).toMatchObject({ status, ...detail === undefined ? {} : { detail } })
    }
  })

  it('ignores prompts and todos whose turn boundary is outside the window', () => {
    const snapshot = snapshotOf(assemble([user(3, 'm1', 'orphan'), todo(4, [['A', 'pending']])], true))
    expect(snapshot).toEqual({ ...EMPTY_FLOW_SNAPSHOT, nodes: new Map() })
    expect(buildFlowSnapshot([], { turnOrder: [], turns: new Map() }).summary.status).toBe('idle')
  })

  it('falls back to a fork off the root when the admitting splice is unknown', () => {
    const snapshot = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'a'), turnEnd(4, 1, { kind: 'completed' }),
      turnStart(5, 2), user(6, 'm2', 'b'),
    ]))
    expect(snapshot.lanes[1]).toMatchObject({ kind: 'fork', anchorNodeId: 'prompt:m1', parentLaneId: 'turn:1' })
  })
})

describe('task-flow edge cases', () => {
  it('draws agents without todos as loose spine nodes and leaves unserved agents unparented', () => {
    const snapshot = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'go'), stepStart(4, 1, 1),
      call(5, 'c0', 'workflow', { meta: { name: 'audit' } }, 1),
      todo(6, [['A', 'pending'], ['B', 'pending']]),
      call(7, 'c1', 'subagent', { description: 'early' }, 1),
      todo(8, [['A', 'in_progress'], ['B', 'pending']]),
      call(9, 'c2', 'subagent', { description: 'served' }, 1),
      todo(10, [['A2', 'in_progress'], ['B', 'pending']]),
    ]))
    expect(snapshot.nodes.get('agent:c0')?.parentId).toBeUndefined()
    expect(snapshot.nodes.get('agent:c1')?.parentId).toBeUndefined()
    expect(snapshot.nodes.get('agent:c2')?.parentId).toBeUndefined()
    expect(snapshot.nodes.get('todo:1:0')).toMatchObject({ title: 'A2', status: 'running', startTime: 10_000 })
    expect(snapshot.lanes[0]!.nodeIds).toEqual(['prompt:m1', 'todo:1:0', 'todo:1:1', 'agent:c0', 'agent:c1', 'agent:c2'])

    const agentsOnly = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'go'), stepStart(4, 1, 1),
      call(5, 'c0', 'workflow', { meta: { name: 'audit' } }, 1),
    ]))
    expect(agentsOnly.lanes[0]!.nodeIds).toEqual(['prompt:m1', 'agent:c0'])
    expect(agentsOnly.nodes.has('steps:1')).toBe(false)
  })

  it('opens a lane from a window that starts inside the turn, after turn/start', () => {
    const snapshot = snapshotOf(assemble([
      stepStart(4, 1, 1), user(5, 'm1', 'late window'), stepEnd(6, 1, 1),
    ], true))
    expect(snapshot.lanes[0]).toMatchObject({ id: 'turn:1', startTime: 5_000, status: 'done' })
    expect(snapshot.nodes.get('steps:1')).toMatchObject({ status: 'running', stepCount: 1 })
    expect(snapshot.nodes.get('steps:1')?.startTime).toBeUndefined()
    expect(snapshot.summary).toMatchObject({ running: false, status: 'done', startTime: 5_000 })
  })
})

describe('task-flow Definition guards', () => {
  it('rejects a start Match of the wrong event type', () => {
    const wrong = {
      event: { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }, role: 'start', location: { kind: 'unresolved' },
    } as unknown as ConversationStartMatch
    const context = { key: 'k', kind: 'x', id: '1', matches: [], start: undefined, state: undefined, current: new Map() }
    const reader = { previous: () => undefined }
    expect(() => promptDefinition.start(context, wrong, reader)).toThrow(/requires user\/message/)
    expect(() => inboxDefinition.start(context, wrong, reader)).toThrow(/requires agent\/inbox\/spliced/)
    expect(() => todoDefinition.start(context, wrong, reader)).toThrow(/requires todo\/write/)
    expect(() => DEFINITIONS[3]!.start(context, wrong, reader)).toThrow(/requires tool\/call/)
    const state = { kind: 'prompt' } as never
    const started = { ...context, state }
    for (const definition of [promptDefinition, inboxDefinition, todoDefinition]) {
      expect(definition.update(started as never, wrong)).toBe(state)
    }
    expect(DEFINITIONS[3]!.update(started as never, { ...wrong, role: 'update' } as never)).toBe(state)
    for (const definition of DEFINITIONS) expect(definition.buildViewNode!(context)).toBeNull()
    const pending = { ...context, matches: [{ ...wrong, role: 'update' }], state: { kind: 'todo', seq: 4, time: 4, turn: null, todos: [] } }
    expect(todoDefinition.buildViewNode!(pending as never)).toMatchObject({ location: { kind: 'unresolved' }, data: { turn: null } })
    expect(todoDefinition.buildViewNode!({ ...pending, matches: [] } as never)).toMatchObject({ location: { kind: 'unresolved' } })
  })

  it('treats a prompt admitted during a turn without a lane as a fork off the root', () => {
    const snapshot = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'a'), turnEnd(4, 1, { kind: 'completed' }),
      turnStart(5, 2), stepStart(6, 2, 1), spliced(7, ['m2']), stepEnd(8, 2, 1), turnEnd(9, 2, { kind: 'completed' }),
      turnStart(10, 3), user(11, 'm2', 'b'),
    ]))
    expect(snapshot.lanes.map(lane => lane.id)).toEqual(['turn:1', 'turn:3'])
    expect(snapshot.lanes[1]).toMatchObject({ kind: 'fork', parentLaneId: 'turn:1', anchorNodeId: 'prompt:m1' })
  })
})

describe('task-flow text helpers', () => {
  it('previews text blocks and bounds them', () => {
    expect(previewText([{ type: 'text', text: ' a \n b ' }, { type: 'image', attachment: {} } as never])).toBe('a b')
    expect(previewText([{ type: 'text', text: 'x'.repeat(100) }])).toHaveLength(80)
  })

  it('titles agents from the first known argument field, then workflow meta, then the tool name', () => {
    expect(agentLabel(JSON.stringify({ prompt: 'p', description: 'd' }), 'subagent')).toBe('d')
    expect(agentLabel(JSON.stringify({ meta: { name: 'audit-all' } }), 'workflow')).toBe('audit-all')
    expect(agentLabel(JSON.stringify({ meta: { name: '' } }), 'workflow')).toBe('workflow')
    expect(agentLabel('{"description": ', 'subagent')).toBe('subagent')
    expect(agentLabel('null', 'subagent')).toBe('subagent')
    expect(agentLabel(JSON.stringify({ meta: null }), 'subagent')).toBe('subagent')
  })
})
