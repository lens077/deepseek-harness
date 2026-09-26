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
  agentLabel, createAgentDefinition, inboxDefinition, promptDefinition, todoDefinition,
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
const continuation = (seq: number, id: string, text: string, goalId = 'goal-1', revision = 1, round = 1) => at(seq, 'user/message', {
  id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'goal', goalId, revision, round },
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

/** A three-turn session: main line with todos and two agents, a queued interjection stopped by the user, and an open sequel. */
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
      ['turn:3', 'sequel', 3, 'running', 'todo:1:2'],
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

    // A steps-only turn carries its terminal outcome on the steps node; no separate terminal node repeats it.
    const interjection = snapshot.lanes[1]!
    expect(interjection.nodeIds).toEqual(['prompt:m2', 'steps:2'])
    expect(snapshot.nodes.get('steps:2')).toMatchObject({ kind: 'steps', status: 'aborted', detail: 'user', stepCount: 1, startTime: 17_000, endTime: 21_000 })
    expect(snapshot.nodes.has('end:2')).toBe(false)

    const sequel = snapshot.lanes[2]!
    expect(sequel.nodeIds).toEqual(['prompt:m3', 'steps:3'])
    expect(sequel.parentLaneId).toBe('turn:1')
    expect(sequel.retryOfLaneId).toBeUndefined()
    expect(snapshot.nodes.get('steps:3')).toMatchObject({ status: 'running', stepCount: 1 })

    // Closed turn spans only: turn 1 (2s→16s) and turn 2 (17s→21s); the open turn 3 is the current lane.
    expect(snapshot.summary).toEqual({
      lanes: { done: 1, running: 1, stopped: 1 },
      running: true,
      status: 'running',
      activeMs: 18_000,
      currentLaneId: 'turn:3',
      currentNodeId: 'steps:3',
      latestBranchLaneId: 'turn:2',
    })
  })

  it('marks a verbatim re-send after a stopped turn as a retry of that lane', () => {
    const retried = [
      ...SCENARIO.slice(0, 22),
      turnStart(23, 3),
      user(24, 'm3', '顺便看下 CI'),
      stepStart(25, 3, 1),
    ]
    const snapshot = snapshotOf(assemble(retried))
    expect(snapshot.lanes[2]).toMatchObject({ kind: 'sequel', retryOfLaneId: 'turn:2', parentLaneId: 'turn:1' })
    const completed = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'same'), turnEnd(4, 1, { kind: 'completed' }),
      turnStart(5, 2), user(6, 'm2', 'same'),
    ]))
    expect(completed.lanes[1]!.retryOfLaneId).toBeUndefined()
  })

  it('keeps automatic goal continuations in the flow and distinguishes them from a new follow-up', () => {
    const snapshot = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), continuation(3, 'm1', 'implement the plan', 'goal-1', 2, 1), turnEnd(4, 1, { kind: 'completed' }),
      turnStart(5, 2), continuation(6, 'm2', 'implement the plan', 'goal-1', 2, 2), turnEnd(7, 2, { kind: 'completed' }),
      turnStart(8, 3), user(9, 'm3', 'ask an unrelated question'),
    ]))
    expect(snapshot.lanes.map(lane => [lane.kind, lane.continuationOfLaneId, lane.label])).toEqual([
      ['main', undefined, 'implement the plan'],
      ['sequel', 'turn:1', 'implement the plan'],
      ['sequel', undefined, 'ask an unrelated question'],
    ])
    // A goal's first round after a user prompt continues that prompt's line.
    const afterUser = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'do it'), turnEnd(4, 1, { kind: 'aborted', reason: { kind: 'user' } }),
      turnStart(5, 2), continuation(6, 'm2', 'do it'),
    ]))
    expect(afterUser.lanes[1]).toMatchObject({ kind: 'sequel', continuationOfLaneId: 'turn:1' })
    expect(afterUser.lanes[1]!.retryOfLaneId).toBeUndefined()
    expect(snapshot.nodes.get('prompt:m2')?.title).toBe('implement the plan')
  })

  it('draws no lane for a plugin-sourced user message and caps the drawn label without capping identity', () => {
    const plugin = at(3, 'user/message', {
      id: 'p1', role: 'user', content: [{ type: 'text', text: 'injected' }], source: { kind: 'plugin', plugin: 'goal' },
    }, { surfaceOp: 'append' })
    expect(snapshotOf(assemble([spliced(1, ['p1']), turnStart(2, 1), plugin])).lanes).toEqual([])
    const long = 'y'.repeat(5_000)
    const snapshot = snapshotOf(assemble([spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', long)]))
    expect(snapshot.lanes[0]!.label).toHaveLength(4_096)
    expect(snapshot.lanes[0]!.label.endsWith('…')).toBe(true)
  })

  it('uses full prompt identity when detecting retries instead of a truncated preview', () => {
    const prefix = 'x'.repeat(100)
    const snapshot = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', `${prefix}A`), turnEnd(4, 1, { kind: 'aborted', reason: { kind: 'user' } }),
      turnStart(5, 2), user(6, 'm2', `${prefix}B`),
    ]))
    expect(snapshot.lanes[1]?.retryOfLaneId).toBeUndefined()
    // The same 100-character prompt re-sent verbatim is still a retry even though the 80-character preview would have matched both.
    const same = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', `${prefix}A`), turnEnd(4, 1, { kind: 'aborted', reason: { kind: 'user' } }),
      turnStart(5, 2), user(6, 'm2', `${prefix}A`),
    ]))
    expect(same.lanes[1]?.retryOfLaneId).toBe('turn:1')
  })

  it('retains the structured tool failure on a delegated agent and its at-risk parent', () => {
    const failure = at(8, 'tool/result', {
      turn: 1, step: 1,
      message: {
        role: 'user', source: { kind: 'tool', callId: 'c1' },
        content: [{ type: 'tool-result', toolCallId: 'c1', isError: true, content: [{ type: 'text', text: 'worker  crashed\nresuming' }] }],
      },
      error: { name: 'FrameworkError', code: 'DSH_CHILD_RESUME' },
    }, { surfaceOp: 'append' })
    const snapshot = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'go'), stepStart(4, 1, 1),
      todo(5, [['A', 'in_progress']]), call(6, 'c1', 'subagent', { description: 'worker' }, 1), failure,
    ]))
    expect(snapshot.nodes.get('agent:c1')).toMatchObject({
      status: 'error', failureCode: 'DSH_CHILD_RESUME', failureMessage: 'worker crashed resuming', parentId: 'todo:1:0',
    })
    // A tool error block without text keeps the code alone; a plain isError result keeps neither field.
    const bare = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'go'), stepStart(4, 1, 1),
      call(5, 'c1', 'subagent', { description: 'worker' }, 1), result(6, 'c1', true),
    ]))
    expect(bare.nodes.get('agent:c1')).toMatchObject({ status: 'error' })
    expect(bare.nodes.get('agent:c1')?.failureCode).toBeUndefined()
    expect(bare.nodes.get('agent:c1')?.failureMessage).toBeUndefined()
  })

  it('omits AUTH tool-result text from delegated-agent snapshots', () => {
    const message = 'Authentication failed; credential=fixture-private-token'
    const failure = at(6, 'tool/result', {
      turn: 1, step: 1,
      message: {
        role: 'user', source: { kind: 'tool', callId: 'c1' },
        content: [{ type: 'tool-result', toolCallId: 'c1', isError: true, content: [{ type: 'text', text: message }] }],
      },
      error: { name: 'LlmError', code: 'AUTH' },
    }, { surfaceOp: 'append' })
    const snapshot = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'go'), stepStart(4, 1, 1),
      call(5, 'c1', 'subagent', { description: 'worker' }, 1), failure,
    ]))
    expect(snapshot.nodes.get('agent:c1')).toMatchObject({ status: 'error', failureCode: 'AUTH' })
    expect(snapshot.nodes.get('agent:c1')?.failureMessage).toBeUndefined()
    expect(JSON.stringify([...snapshot.nodes.values()])).not.toContain(message)
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
    expect(snapshot.nodes.get('steps:3')).toMatchObject({ status: 'error', detail: 'boom', failureCode: 'UNKNOWN' })
    expect(snapshot.nodes.has('end:3')).toBe(false)
    expect(snapshot.summary).toMatchObject({ running: false, status: 'error', activeMs: 22_000, lanes: { done: 1, running: 0, stopped: 2 } })
    expect(snapshot.summary.currentNodeId).toBeUndefined()
    expect(snapshot.summary.currentLaneId).toBeUndefined()
    expect(snapshot.summary.latestBranchLaneId).toBe('turn:2')
  })

  it('omits provider authentication messages from the task-flow snapshot', () => {
    const message = 'Authentication failed; credential=fixture-private-token'
    const snapshot = snapshotOf(assemble([
      ...SCENARIO,
      stepEnd(26, 3, 1),
      turnEnd(27, 3, { kind: 'error', error: { message, code: 'AUTH' } }),
    ]))
    const terminal = snapshot.nodes.get('steps:3')
    expect(terminal?.detail).toBeUndefined()
    expect(terminal).toMatchObject({ status: 'error', failureCode: 'AUTH' })
    expect(JSON.stringify([...snapshot.nodes.values()])).not.toContain(message)
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
      [{ kind: 'unknown-future' }, 'error', 'unknown-future'],
    ]
    for (const [reason, status, detail] of outcomes) {
      const snapshot = snapshotOf(assemble([...base, turnEnd(6, 1, reason)]))
      expect(snapshot.lanes[0]!.status).toBe(status)
      expect(snapshot.nodes.has('end:1')).toBe(false)
      const steps = snapshot.nodes.get('steps:1')
      expect(steps).toMatchObject({ status, ...detail === undefined ? {} : { detail } })
      if (status === 'done') expect(steps?.detail).toBeUndefined()
    }
  })

  it('keeps a separate terminal node on a turn whose spine holds todos', () => {
    const snapshot = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'x'), stepStart(4, 1, 1),
      todo(5, [['A', 'in_progress']]), stepEnd(6, 1, 1), turnEnd(7, 1, { kind: 'aborted', reason: { kind: 'user' } }),
    ]))
    expect(snapshot.lanes[0]!.nodeIds).toEqual(['prompt:m1', 'todo:1:0', 'end:1'])
    expect(snapshot.nodes.get('end:1')).toMatchObject({ kind: 'terminal', status: 'aborted', detail: 'user', anchorSeq: 7 })
    expect(snapshot.nodes.get('todo:1:0')).toMatchObject({ status: 'aborted' })
    const planned = [
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'x'), stepStart(4, 1, 1),
      todo(5, [['A', 'in_progress']]), stepEnd(6, 1, 1),
    ]
    const crashed = snapshotOf(assemble([...planned, turnEnd(7, 1, { kind: 'interrupted' })]))
    expect(crashed.nodes.get('end:1')).toMatchObject({ status: 'interrupted' })
    expect(crashed.nodes.get('end:1')?.detail).toBeUndefined()
    const failed = snapshotOf(assemble([...planned, turnEnd(7, 1, { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } })]))
    expect(failed.nodes.get('end:1')).toMatchObject({ status: 'error', detail: 'boom', failureCode: 'UNKNOWN' })
  })

  it('ignores prompts and todos whose turn boundary is outside the window', () => {
    const snapshot = snapshotOf(assemble([user(3, 'm1', 'orphan'), todo(4, [['A', 'pending']])], true))
    expect(snapshot).toEqual({ ...EMPTY_FLOW_SNAPSHOT, nodes: new Map() })
    expect(buildFlowSnapshot([], { turnOrder: [], turns: new Map() }).summary.status).toBe('idle')
  })

  it('continues the line as a sequel when the admitting splice is unknown', () => {
    const snapshot = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'a'), turnEnd(4, 1, { kind: 'completed' }),
      turnStart(5, 2), user(6, 'm2', 'b'),
    ]))
    expect(snapshot.lanes[1]).toMatchObject({ kind: 'sequel', anchorNodeId: 'steps:1', parentLaneId: 'turn:1' })
  })

  it('continues a sequel from the prompt when the previous lane drew only agents', () => {
    const snapshot = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'a'), stepStart(4, 1, 1),
      todo(5, []), call(6, 'c1', 'subagent', { description: 'x' }, 1), result(7, 'c1'),
      stepEnd(8, 1, 1), turnEnd(9, 1, { kind: 'completed' }),
      spliced(10, ['m2']), turnStart(11, 2), user(12, 'm2', 'b'),
    ]))
    expect(snapshot.lanes[0]!.nodeIds).toEqual(['prompt:m1', 'agent:c1'])
    expect(snapshot.lanes[1]).toMatchObject({ kind: 'sequel', anchorNodeId: 'prompt:m1' })
  })

  it('chains sequels along the line and numbers every prompt without gaps', () => {
    const snapshot = snapshotOf(assemble([
      turnStart(1, 1), stepStart(2, 1, 1), stepEnd(3, 1, 1), turnEnd(4, 1, { kind: 'completed' }),
      spliced(5, ['m2']), turnStart(6, 2), user(7, 'm2', 'a'), stepStart(8, 2, 1), stepEnd(9, 2, 1), turnEnd(10, 2, { kind: 'aborted', reason: { kind: 'user' } }),
      spliced(11, ['m3']), turnStart(12, 3), user(13, 'm3', 'b'), stepStart(14, 3, 1), stepEnd(15, 3, 1), turnEnd(16, 3, { kind: 'completed' }),
      spliced(17, ['m4']), turnStart(18, 4), user(19, 'm4', 'c'),
    ]))
    expect(snapshot.lanes.map(lane => [lane.ordinal, lane.kind, lane.parentLaneId, lane.anchorNodeId])).toEqual([
      [1, 'main', undefined, undefined],
      [2, 'sequel', 'turn:2', 'steps:2'],
      [3, 'sequel', 'turn:3', 'steps:3'],
    ])
    expect(snapshot.summary).toMatchObject({ lanes: { done: 1, running: 1, stopped: 1 }, activeMs: 8_000, currentLaneId: 'turn:4' })
    expect(snapshot.summary.latestBranchLaneId).toBeUndefined()
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
    expect(snapshot.summary).toMatchObject({ running: false, status: 'done', activeMs: 0, lanes: { done: 1, running: 0, stopped: 0 } })
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

  it('treats a prompt admitted during a turn without a lane as a sequel of the line', () => {
    const snapshot = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'a'), turnEnd(4, 1, { kind: 'completed' }),
      turnStart(5, 2), stepStart(6, 2, 1), spliced(7, ['m2']), stepEnd(8, 2, 1), turnEnd(9, 2, { kind: 'completed' }),
      turnStart(10, 3), user(11, 'm2', 'b'),
    ]))
    expect(snapshot.lanes.map(lane => lane.id)).toEqual(['turn:1', 'turn:3'])
    expect(snapshot.lanes[1]).toMatchObject({ kind: 'sequel', parentLaneId: 'turn:1', anchorNodeId: 'steps:1' })
  })
})

describe('task-flow text helpers', () => {
  it('joins prompt text without including image content in its label', () => {
    const prompt = at(3, 'user/message', {
      id: 'm1', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: ' a \n b ' }, { type: 'image', attachment: {} }],
    }, { surfaceOp: 'append' })
    const snapshot = snapshotOf(assemble([spliced(1, ['m1']), turnStart(2, 1), prompt]))
    expect(snapshot.nodes.get('prompt:m1')?.title).toBe('a b')
  })

  it('retains long delegated labels up to the same display bound as prompts', () => {
    const label = 'Review task-flow state coverage against the durable session log and report every gap'
    expect(label.length).toBeGreaterThan(80)
    expect(agentLabel(JSON.stringify({ description: label }), 'subagent')).toBe(label)
    expect(agentLabel(JSON.stringify({ meta: { name: label } }), 'workflow')).toBe(label)
    const bounded = agentLabel(JSON.stringify({ prompt: 'x'.repeat(5_000) }), 'subagent')
    expect(bounded).toHaveLength(4_096)
    expect(bounded.endsWith('…')).toBe(true)
    const snapshot = snapshotOf(assemble([
      spliced(1, ['m1']), turnStart(2, 1), user(3, 'm1', 'go'), stepStart(4, 1, 1),
      call(5, 'c1', 'subagent', { description: label }, 1),
    ]))
    expect(snapshot.nodes.get('agent:c1')?.title).toBe(label)
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
