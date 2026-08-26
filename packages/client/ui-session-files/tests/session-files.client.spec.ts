// The rail's derivation: which render intents count as a change and which as a
// read, how a file's hunks accumulate and order, what a call still in flight
// contributes, when the read list is live, and the label fitting the rows use.
// Wire views are narrowed defensively here because they cross the wire, so the
// malformed arms are pinned beside the well-formed ones.

import { describe, expect, it } from 'vitest'
import {
  EMPTY_CHAT_SNAPSHOT, type ConversationNode, type ConversationSnapshot,
  type ConversationTimelineSnapshot, type SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  basename, changedPaths, defaultSelection, deriveSessionFiles, diffHunks, labelBudget,
  readPaths, READ_LIMIT, segmentLabel, sessionFilesOf, truncateHead, turnResolver,
} from '../src/client/session-files.ts'

const SID = 'files' as SessionId

/** A `turn/start` boundary at `seq`, in the shape the timeline publishes. */
function timeline(boundaries: ReadonlyArray<{ turn: number; seq: number }>): ConversationTimelineSnapshot {
  const turns = new Map(boundaries.map(({ turn, seq }) => [turn, { start: { seq } }]))
  return {
    turnOrder: boundaries.map(entry => entry.turn),
    turns,
  } as unknown as ConversationTimelineSnapshot
}

interface ResultOptions {
  seq: number
  callView?: unknown
  resultView?: unknown
  isError?: boolean
  tool?: string
}

/** One settled tool result, with only the fields the derivation reads. */
function result({ seq, callView = null, resultView = null, isError = false, tool = 'edit' }: ResultOptions): ConversationNode {
  return {
    // `time` tracks `seq` here so a merged ordering assertion reads naturally;
    // the snapshot always carries both.
    kind: 'tool-result', seq, time: seq, isError, callView, resultView, call: { name: tool, argsRaw: '{}' },
  } as unknown as ConversationNode
}

function diffView(paths: readonly string[], diffs?: unknown): unknown {
  return { card: 'diff', locations: paths.map(path => ({ path })), ...diffs === undefined ? {} : { diffs } }
}

function readView(paths: readonly string[]): unknown {
  return { card: 'generic', kind: 'read', locations: paths.map(path => ({ path })) }
}

type SnapshotOverrides =
  Partial<ConversationSnapshot>
  & { boundaries?: ReadonlyArray<{ turn: number; seq: number }> }

function snapshot(overrides: SnapshotOverrides = {}): ConversationSnapshot {
  const { boundaries = [{ turn: 1, seq: 0 }], ...rest } = overrides
  return {
    sessionId: SID,
    chat: { ...EMPTY_CHAT_SNAPSHOT, timeline: timeline(boundaries) },
    nodes: [], runningCalls: [], running: false, hasMore: false,
    ...rest,
  } as unknown as ConversationSnapshot
}

describe('render-intent vocabulary', () => {
  it('counts a diff card and a generic edit card as changes, nothing else', () => {
    expect(changedPaths(diffView(['a.ts']))).toEqual(['a.ts'])
    expect(changedPaths({ card: 'generic', kind: 'edit', locations: [{ path: 'b.ts' }] })).toEqual(['b.ts'])
    expect(changedPaths({ card: 'generic', kind: 'read', locations: [{ path: 'c.ts' }] })).toEqual([])
    expect(changedPaths({ card: 'terminal' })).toEqual([])
    expect(changedPaths(null)).toEqual([])
    expect(changedPaths('not a view')).toEqual([])
  })

  it('counts only the read tool as a read', () => {
    expect(readPaths(readView(['a.ts']))).toEqual(['a.ts'])
    expect(readPaths({ card: 'search', locations: [{ path: 'b.ts' }] })).toEqual([])
    expect(readPaths(diffView(['c.ts']))).toEqual([])
    expect(readPaths(null)).toEqual([])
    expect(readPaths('not a view')).toEqual([])
  })

  it('drops malformed locations rather than failing the panel', () => {
    expect(changedPaths({ card: 'diff', locations: 'nope' })).toEqual([])
    expect(changedPaths({ card: 'diff', locations: [null, 'x', { line: 3 }, { path: 7 }, { path: 'ok.ts' }] }))
      .toEqual(['ok.ts'])
  })
})

describe('diffHunks', () => {
  it('accepts well-formed hunks, including a create', () => {
    const hunks = diffHunks({ card: 'diff', diffs: [{ path: 'a.ts', oldText: null, newText: 'x' }] })
    expect(hunks).toEqual([{ path: 'a.ts', oldText: null, newText: 'x' }])
  })

  it('drops anything malformed and every non-diff view', () => {
    expect(diffHunks(null)).toEqual([])
    expect(diffHunks('nope')).toEqual([])
    expect(diffHunks({ card: 'generic' })).toEqual([])
    expect(diffHunks({ card: 'diff', diffs: 'nope' })).toEqual([])
    expect(diffHunks({
      card: 'diff',
      diffs: [
        null,
        'x',
        { path: 7, newText: 'a' },
        { path: 'a.ts', newText: 9 },
        { path: 'a.ts', oldText: 5, newText: 'a' },
        { path: 'a.ts', oldText: 'b', newText: 'a' },
      ],
    })).toEqual([{ path: 'a.ts', oldText: 'b', newText: 'a' }])
  })
})

describe('turnResolver', () => {
  it('resolves a seq to the latest boundary at or below it', () => {
    const resolve = turnResolver(timeline([{ turn: 2, seq: 20 }, { turn: 1, seq: 10 }]))
    expect(resolve(9)).toBeNull()
    expect(resolve(10)).toBe(1)
    expect(resolve(19)).toBe(1)
    expect(resolve(25)).toBe(2)
  })

  it('ignores a turn whose start fell outside the window', () => {
    const partial = {
      turnOrder: [1, 2],
      turns: new Map<number, unknown>([[1, {}], [2, { start: { seq: 5 } }]]),
    } as unknown as ConversationTimelineSnapshot
    expect(turnResolver(partial)(6)).toBe(2)
  })
})

describe('deriveSessionFiles', () => {
  it('accumulates one entry per path with its hunks, labelled by turn and tool', () => {
    const model = deriveSessionFiles(snapshot({
      boundaries: [{ turn: 1, seq: 0 }, { turn: 3, seq: 30 }],
      nodes: [
        result({
          seq: 10,
          callView: diffView(['a.ts']),
          resultView: diffView(['a.ts'], [
            { path: 'a.ts', oldText: 'one', newText: 'two' },
            { path: 'other.ts', oldText: 'x', newText: 'y' },
          ]),
        }),
        result({
          seq: 40,
          tool: 'write',
          callView: diffView(['a.ts']),
          resultView: diffView(['a.ts'], [{ path: 'a.ts', oldText: 'two', newText: 'three' }]),
        }),
      ],
    }))
    expect(model.changed).toHaveLength(1)
    expect(model.changed[0]).toMatchObject({ path: 'a.ts', firstSeq: 10, lastSeq: 40, writing: false })
    // The hunk stamped with another path belongs to that path, not this entry.
    expect(model.changed[0]?.segments).toEqual([
      { turn: 1, tool: 'edit', source: null, time: 10, oldText: 'one', newText: 'two' },
      { turn: 3, tool: 'write', source: null, time: 40, oldText: 'two', newText: 'three' },
    ])
  })

  it('orders entries by first change and keeps a re-edited file in place', () => {
    const model = deriveSessionFiles(snapshot({
      nodes: [
        result({ seq: 10, callView: diffView(['first.ts']) }),
        result({ seq: 20, callView: diffView(['second.ts']) }),
        result({ seq: 30, callView: diffView(['first.ts']) }),
      ],
    }))
    expect(model.changed.map(entry => entry.path)).toEqual(['first.ts', 'second.ts'])
    expect(model.changed[0]?.lastSeq).toBe(30)
  })

  it('ignores failed calls and reports a null tool when the call head is gone', () => {
    const orphan = {
      kind: 'tool-result', seq: 10, isError: false, callView: diffView(['a.ts']),
      resultView: diffView(['a.ts'], [{ path: 'a.ts', oldText: null, newText: 'x' }]), call: null,
    } as unknown as ConversationNode
    const model = deriveSessionFiles(snapshot({
      nodes: [
        { kind: 'user', seq: 1 } as unknown as ConversationNode,
        result({ seq: 5, isError: true, callView: diffView(['failed.ts']) }),
        orphan,
      ],
    }))
    expect(model.changed.map(entry => entry.path)).toEqual(['a.ts'])
    expect(model.changed[0]?.segments[0]).toMatchObject({ tool: null })
  })

  it('marks a path a running call is writing and sorts it last', () => {
    const model = deriveSessionFiles(snapshot({
      running: true,
      nodes: [result({ seq: 10, callView: diffView(['settled.ts']) })],
      runningCalls: [
        { callId: 'c1', callView: diffView(['live.ts']) },
        { callId: 'c2', callView: readView(['looked.ts']) },
      ] as unknown as ConversationSnapshot['runningCalls'],
    }))
    expect(model.changed.map(entry => entry.path)).toEqual(['settled.ts', 'live.ts'])
    expect(model.changed[1]?.writing).toBe(true)
    expect(model.read).toEqual(['looked.ts'])
  })

  it('keeps the read list live while running, newest first, deduplicated and capped', () => {
    const last = READ_LIMIT + 4
    const reads = Array.from({ length: READ_LIMIT + 5 }, (_v, index) => result({
      seq: index + 1, callView: readView([`file-${index}.ts`]),
    }))
    const model = deriveSessionFiles(snapshot({
      running: true,
      nodes: [...reads, result({ seq: 100, callView: readView([`file-${last}.ts`]) })],
    }))
    expect(model.read).toHaveLength(READ_LIMIT)
    // The re-read of the newest file stays one entry, at the front.
    expect(model.read[0]).toBe(`file-${last}.ts`)
    expect(model.read.filter(path => path === `file-${last}.ts`)).toHaveLength(1)
    // The cap drops the oldest reads, not the newest.
    expect(model.read).not.toContain('file-0.ts')
  })

  it('counts a path listed twice by one call as one entry', () => {
    const model = deriveSessionFiles(snapshot({
      nodes: [result({ seq: 10, callView: { card: 'diff', locations: [{ path: 'a.ts' }, { path: 'a.ts' }] } })],
    }))
    expect(model.changed).toHaveLength(1)
    expect(model.changed[0]).toMatchObject({ firstSeq: 10, lastSeq: 10 })
  })

  it('empties the read list once the agent is idle and passes the partial-history bit through', () => {
    const model = deriveSessionFiles(snapshot({
      hasMore: true,
      nodes: [result({ seq: 10, callView: readView(['looked.ts']) })],
    }))
    expect(model.read).toEqual([])
    expect(model.running).toBe(false)
    expect(model.hasMore).toBe(true)
  })
})

describe('sessionFilesOf', () => {
  it('derives once per snapshot', () => {
    const snap = snapshot({ nodes: [result({ seq: 10, callView: diffView(['a.ts']) })] })
    const first = sessionFilesOf(snap)
    expect(sessionFilesOf(snap)).toBe(first)
    expect(sessionFilesOf(snapshot())).not.toBe(first)
  })
})

describe('defaultSelection', () => {
  it('prefers the file being written, then the most recently changed', () => {
    const running = deriveSessionFiles(snapshot({
      running: true,
      nodes: [result({ seq: 10, callView: diffView(['settled.ts']) })],
      runningCalls: [{ callId: 'c1', callView: diffView(['live.ts']) }] as unknown as ConversationSnapshot['runningCalls'],
    }))
    expect(defaultSelection(running)).toBe('live.ts')

    const idle = deriveSessionFiles(snapshot({
      nodes: [
        result({ seq: 10, callView: diffView(['old.ts']) }),
        result({ seq: 20, callView: diffView(['new.ts']) }),
      ],
    }))
    expect(defaultSelection(idle)).toBe('new.ts')
    expect(defaultSelection(deriveSessionFiles(snapshot()))).toBeNull()

    // List order is first change, so the most recent change can sit above a
    // file that appeared later — the selection follows the change, not the row.
    const revisited = deriveSessionFiles(snapshot({
      nodes: [
        result({ seq: 10, callView: diffView(['early.ts']) }),
        result({ seq: 20, callView: diffView(['later.ts']) }),
        result({ seq: 30, callView: diffView(['early.ts']) }),
      ],
    }))
    expect(revisited.changed.map(entry => entry.path)).toEqual(['early.ts', 'later.ts'])
    expect(defaultSelection(revisited)).toBe('early.ts')
  })
})

describe('segmentLabel', () => {
  const t = (key: string, params?: Record<string, string>) =>
    ({
      'segment.turn': `Turn ${params?.turn ?? ''} · ${params?.tool ?? ''}`,
      'segment.looseTurn': params?.tool ?? '',
      'segment.change': 'Change',
      'segment.sourced': `${params?.source ?? ''} · ${params?.rest ?? ''}`,
    })[key] ?? key

  it('leads with the turn, drops it outside the window, and names an unknown tool', () => {
    expect(segmentLabel({ turn: 3, tool: 'edit', source: null }, t)).toBe('Turn 3 · edit')
    expect(segmentLabel({ turn: null, tool: 'write', source: null }, t)).toBe('write')
    expect(segmentLabel({ turn: 2, tool: null, source: null }, t)).toBe('Turn 2 · Change')
  })

  it('prefixes a descendant\'s change with the session that recorded it', () => {
    // Turn numbers restart per session, so the source is what keeps two
    // agents' turn 3 apart in one merged list.
    expect(segmentLabel({ turn: 3, tool: 'edit', source: 'reviewer' }, t)).toBe('reviewer · Turn 3 · edit')
  })
})

describe('row labels', () => {
  it('takes the trailing path segment on either separator', () => {
    expect(basename('a/b/c.ts')).toBe('c.ts')
    expect(basename('a\\b\\c.ts')).toBe('c.ts')
    expect(basename('c.ts')).toBe('c.ts')
  })

  it('scales the character budget with the rail width, never below a legible floor', () => {
    expect(labelBudget(300)).toBe(35)
    expect(labelBudget(0)).toBe(12)
  })

  it('drops the head so the distinguishing tail survives', () => {
    expect(truncateHead('notes.md', 20)).toBe('notes.md')
    // The two names differ only at the end; both keep that end.
    expect(truncateHead('2026-08-25-notes.md', 12)).toBe('…25-notes.md')
    expect(truncateHead('2026-08-25-notes.zh.md', 12)).toBe('…notes.zh.md')
  })
})
