// The question index and its join to the turns that answered each question:
// which Chat Nodes count as questions, which turn owns a question when several
// were sent before the loop picked any of them up, what a turn reports as its
// outcome, and what both directions say when the loaded window cuts a boundary
// away.

import { describe, expect, it } from 'vitest'
import type { ConversationTimelineSnapshot, UserMessageNode } from '@deepseek-ai/dsh-client-runtime/client'
import {
  buildQuestionTurnIndex, buildTurnGroups, buildTurnRecaps, questionEntries, turnElapsedMs,
  type QuestionEntry,
} from '../src/client/chat/turn-summary.ts'

/** A user Chat Node carrying prose, as the node store publishes it. */
function userNode(seq: number, text: string): UserMessageNode {
  return {
    kind: 'user', seq, time: seq * 1_000, content: [{ type: 'text', text }], source: null,
  } as unknown as UserMessageNode
}

/** An image-only user Chat Node. */
function imageNode(seq: number): UserMessageNode {
  return {
    kind: 'user', seq, time: seq * 1_000, content: [{ type: 'image' }], source: null,
  } as unknown as UserMessageNode
}

/** A node store over a fixed key/Node table. */
function store(entries: ReadonlyArray<[string, unknown]>) {
  const table = new Map(entries)
  return { get: (key: string) => table.get(key) }
}

interface TurnFixture {
  turn: number
  startSeq?: number
  startTime?: number
  endSeq?: number
  endTime?: number
  reason?: string
  status?: 'open' | 'closed' | 'unknown'
}

/** Turn boundaries in the envelope shape the runtime publishes. */
function timeline(fixtures: readonly TurnFixture[]): ConversationTimelineSnapshot {
  const turns = new Map(fixtures.map(fixture => [fixture.turn, {
    turn: fixture.turn,
    start: fixture.startSeq === undefined ? undefined : {
      type: 'turn/start', seq: fixture.startSeq, time: fixture.startTime ?? fixture.startSeq * 1_000,
      data: { turn: fixture.turn },
    },
    end: fixture.endSeq === undefined ? undefined : {
      type: 'turn/end', seq: fixture.endSeq, time: fixture.endTime ?? fixture.endSeq * 1_000,
      data: { turn: fixture.turn, reason: { kind: fixture.reason ?? 'completed' } },
    },
    status: fixture.status ?? (fixture.endSeq === undefined ? 'open' : 'closed'),
    steps: [],
    data: { get: () => undefined },
  }]))
  return {
    turnOrder: fixtures.map(fixture => fixture.turn),
    turns,
  } as unknown as ConversationTimelineSnapshot
}

describe('questionEntries', () => {
  it('takes user Nodes in transcript order and skips every other kind', () => {
    const entries = questionEntries(
      ['a', 'b', 'c', 'missing'],
      store([
        ['a', { kind: 'user', data: userNode(1, '  first  ') }],
        ['b', { kind: 'assistant', data: {} }],
        ['c', { kind: 'user', data: userNode(4, 'second') }],
      ]),
      '图片提问',
    )
    expect(entries.map(entry => [entry.key, entry.text])).toEqual([['a', 'first'], ['c', 'second']])
  })

  it('names an image-only ask with the supplied label and an empty one with a dash', () => {
    const entries = questionEntries(
      ['img', 'blank'],
      store([
        ['img', { kind: 'user', data: imageNode(1) }],
        ['blank', { kind: 'user', data: userNode(2, '   ') }],
      ]),
      '图片提问',
    )
    expect(entries.map(entry => entry.text)).toEqual(['图片提问', '—'])
  })
})

/** Question entries straight from seq/text pairs, bypassing the node store. */
function questions(pairs: ReadonlyArray<[string, number, string]>): QuestionEntry[] {
  return pairs.map(([key, seq, text]) => ({ key, node: userNode(seq, text), text }))
}

describe('buildQuestionTurnIndex', () => {
  it('joins each question to the turn that opened at or before it', () => {
    const index = buildQuestionTurnIndex(
      questions([['q1', 2, 'first'], ['q2', 11, 'second']]),
      timeline([
        { turn: 1, startSeq: 1, endSeq: 8, startTime: 1_000, endTime: 4_000 },
        { turn: 2, startSeq: 10 },
      ]),
    )
    expect([...index.turnOfQuestion]).toEqual([['q1', 1], ['q2', 2]])
    expect(index.byTurn.get(1)).toMatchObject({
      questionKey: 'q1', questionIndex: 0, outcome: 'completed', startTime: 1_000, endTime: 4_000,
    })
    expect(index.byTurn.get(2)).toMatchObject({ questionKey: 'q2', outcome: 'running', endTime: null })
  })

  it('shares one turn between the messages of one batch, and names the first as opener', () => {
    const index = buildQuestionTurnIndex(
      questions([['q1', 2, 'first'], ['q2', 3, 'second']]),
      timeline([{ turn: 1, startSeq: 1, endSeq: 9 }]),
    )
    expect(index.turnOfQuestion.get('q1')).toBe(1)
    expect(index.turnOfQuestion.get('q2')).toBe(1)
    expect(index.byTurn.get(1)?.questionKey).toBe('q1')
    expect(index.byTurn.get(1)?.questionIndex).toBe(0)
  })

  it('leaves a question below every loaded boundary unjoined', () => {
    const index = buildQuestionTurnIndex(
      questions([['q1', 1, 'cut away']]),
      timeline([{ turn: 4, startSeq: 5, endSeq: 9 }]),
    )
    expect(index.turnOfQuestion.has('q1')).toBe(false)
    expect(index.byTurn.get(4)?.questionKey).toBeNull()
    expect(index.byTurn.get(4)?.questionIndex).toBeNull()
  })

  it('keeps a question inside its own turn rather than the next one', () => {
    const index = buildQuestionTurnIndex(
      questions([['q1', 2, 'first'], ['q2', 12, 'second']]),
      timeline([
        { turn: 1, startSeq: 1, endSeq: 10 },
        { turn: 2, startSeq: 11, endSeq: 20 },
      ]),
    )
    expect(index.turnOfQuestion.get('q1')).toBe(1)
    expect(index.turnOfQuestion.get('q2')).toBe(2)
  })

  it('reports a turn whose boundaries are outside the window without a clock', () => {
    const index = buildQuestionTurnIndex([], timeline([{ turn: 1 }]))
    expect(index.byTurn.get(1)).toMatchObject({ startTime: null, endTime: null, outcome: 'running' })
    expect(turnElapsedMs(index.byTurn.get(1)!, 5_000)).toBeNull()
  })

  it('maps each recorded end reason, and every unnamed one to the neutral outcome', () => {
    const index = buildQuestionTurnIndex([], timeline([
      { turn: 1, startSeq: 1, endSeq: 2, reason: 'completed' },
      { turn: 2, startSeq: 3, endSeq: 4, reason: 'aborted' },
      { turn: 3, startSeq: 5, endSeq: 6, reason: 'error' },
      { turn: 4, startSeq: 7, endSeq: 8, reason: 'max-tokens' },
      { turn: 5, startSeq: 9, status: 'closed' },
    ]))
    expect(index.turns.map(summary => summary.outcome))
      .toEqual(['completed', 'stopped', 'failed', 'other', 'other'])
  })

  it('skips a turn the order names but the map does not hold', () => {
    const partial = {
      turnOrder: [1, 2],
      turns: new Map([[1, {
        turn: 1, start: undefined, end: undefined, status: 'open', steps: [], data: { get: () => undefined },
      }]]),
    } as unknown as ConversationTimelineSnapshot
    expect(buildQuestionTurnIndex([], partial).turns.map(summary => summary.turn)).toEqual([1])
  })
})

/** A node store over `[key, kind, anchorSeq, turn?]` rows. */
function nodes(rows: ReadonlyArray<[string, string, number, number?]>) {
  const table = new Map(rows.map(([key, kind, anchorSeq, turn]) => [
    key, { kind, anchorSeq, ...turn === undefined ? {} : { data: { turn } } },
  ]))
  return { keys: rows.map(row => row[0]), store: { get: (key: string) => table.get(key) } }
}

describe('buildTurnGroups', () => {
  it('collects each turn\'s nodes into one group, in first-appearance order', () => {
    const { keys, store } = nodes([
      ['u1', 'user', 2], ['a1', 'assistant-step', 3],
      ['u2', 'user', 12], ['a2', 'assistant-step', 13],
    ])
    const groups = buildTurnGroups(keys, store, timeline([
      { turn: 1, startSeq: 1, endSeq: 10 },
      { turn: 2, startSeq: 11, endSeq: 20 },
    ]))
    expect(groups.map(group => [group.turn, group.keys]))
      .toEqual([[1, ['u1', 'a1']], [2, ['u2', 'a2']]])
  })

  it('keeps a turn in one group even when its nodes are not adjacent', () => {
    const { keys, store } = nodes([
      ['u1', 'user', 2], ['u2', 'user', 12], ['tail1', 'turn-tail', 9, 1],
    ])
    const groups = buildTurnGroups(keys, store, timeline([
      { turn: 1, startSeq: 1, endSeq: 10 },
      { turn: 2, startSeq: 11 },
    ]))
    expect(groups.map(group => [group.turn, group.keys]))
      .toEqual([[1, ['u1', 'tail1']], [2, ['u2']]])
  })

  it('collects nodes below every loaded boundary under no turn', () => {
    const { keys, store } = nodes([['old', 'assistant-step', 2], ['u1', 'user', 12]])
    const groups = buildTurnGroups(keys, store, timeline([{ turn: 2, startSeq: 11 }]))
    expect(groups.map(group => [group.turn, group.keys]))
      .toEqual([[null, ['old']], [2, ['u1']]])
  })
})

describe('buildTurnRecaps', () => {
  const longTurn = timeline([{ turn: 1, startSeq: 1, endSeq: 20 }])

  it('recaps a turn that spans enough rows to have moved its question off screen', () => {
    const { keys, store } = nodes([
      ['u1', 'user', 2], ['a', 'assistant-step', 3], ['b', 'tool-call', 4],
      ['c', 'tool-call', 5], ['tail', 'turn-tail', 20, 1],
    ])
    const index = buildQuestionTurnIndex(questions([['u1', 2, 'the long ask']]), longTurn)
    expect([...buildTurnRecaps(keys, store, index)]).toEqual([
      ['tail', { number: 1, text: 'the long ask', key: 'u1' }],
    ])
  })

  it('leaves a short turn alone', () => {
    const { keys, store } = nodes([
      ['u1', 'user', 2], ['a', 'assistant-step', 3], ['tail', 'turn-tail', 20, 1],
    ])
    const index = buildQuestionTurnIndex(questions([['u1', 2, 'the short ask']]), longTurn)
    expect(buildTurnRecaps(keys, store, index).size).toBe(0)
  })

  it('recaps nothing when the window holds the tail but not its question', () => {
    const { keys, store } = nodes([
      ['a', 'assistant-step', 3], ['b', 'tool-call', 4], ['c', 'tool-call', 5],
      ['d', 'tool-call', 6], ['tail', 'turn-tail', 20, 1],
    ])
    const index = buildQuestionTurnIndex([], longTurn)
    expect(buildTurnRecaps(keys, store, index).size).toBe(0)
  })

  it('recaps nothing for a tail whose turn is outside the window, or which names no turn', () => {
    const { keys, store } = nodes([
      ['u1', 'user', 2], ['a', 'assistant-step', 3], ['b', 'tool-call', 4], ['c', 'tool-call', 5],
      ['orphan', 'turn-tail', 20, 9], ['untagged', 'turn-tail', 20],
    ])
    const index = buildQuestionTurnIndex(questions([['u1', 2, 'the long ask']]), longTurn)
    expect(buildTurnRecaps(keys, store, index).size).toBe(0)
  })

  it('takes the row threshold from its caller', () => {
    const { keys, store } = nodes([
      ['u1', 'user', 2], ['a', 'assistant-step', 3], ['tail', 'turn-tail', 20, 1],
    ])
    const index = buildQuestionTurnIndex(questions([['u1', 2, 'the ask']]), longTurn)
    expect(buildTurnRecaps(keys, store, index, 2).size).toBe(1)
  })
})

describe('turnElapsedMs', () => {
  it('reports the recorded span for a settled turn and a live one for an open turn', () => {
    const index = buildQuestionTurnIndex([], timeline([
      { turn: 1, startSeq: 1, startTime: 1_000, endSeq: 2, endTime: 4_500 },
      { turn: 2, startSeq: 3, startTime: 10_000 },
    ]))
    expect(turnElapsedMs(index.byTurn.get(1)!, 99_999)).toBe(3_500)
    expect(turnElapsedMs(index.byTurn.get(2)!, 12_250)).toBe(2_250)
    // A clock behind the recorded start floors at zero rather than counting down.
    expect(turnElapsedMs(index.byTurn.get(2)!, 9_000)).toBe(0)
  })
})
