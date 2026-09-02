// The session-tree derivation: folding a descendant's raw history page into
// changed files with the same vocabulary the local walk uses, and merging those
// into the local model as one row per file with per-segment provenance.

import { describe, expect, it } from 'vitest'
import type { SessionFilesModel } from '../src/client/session-files.ts'
import {
  deriveTreeFiles, mergeTreeChanges, type TreeHistoryEntry, type TreeSource,
} from '../src/client/tree-files.ts'

function turnStart(seq: number, turn: number): TreeHistoryEntry {
  return { event: { type: 'turn/start', seq, time: seq, data: { turn } } }
}

function call(seq: number, callId: string, path: string, name = 'edit'): TreeHistoryEntry {
  return {
    event: { type: 'tool/call', seq, time: seq, data: { callId, name } },
    view: { card: 'diff', locations: [{ path }] },
  }
}

function settled(
  seq: number,
  callId: string,
  diffs: unknown,
  isError = false,
): TreeHistoryEntry {
  return {
    event: {
      type: 'tool/result',
      seq,
      time: seq,
      data: { message: { content: [{ isError }], source: { callId } } },
    },
    view: diffs === undefined ? undefined : { card: 'diff', diffs },
  }
}

describe('deriveTreeFiles', () => {
  it('pairs a call with its result and labels the segment by turn, tool, and source', () => {
    const files = deriveTreeFiles([
      turnStart(1, 4),
      call(2, 'c1', 'src/app.ts'),
      settled(3, 'c1', [{ path: 'src/app.ts', oldText: 'a', newText: 'b' }]),
    ], 'reviewer')
    expect(files).toEqual([{
      path: 'src/app.ts',
      firstSeq: 3,
      lastSeq: 3,
      segments: [{ turn: 4, tool: 'edit', source: 'reviewer', time: 3, oldText: 'a', newText: 'b' }],
    }])
  })

  it('leaves the turn null for a page that starts mid-turn and times an undated event at zero', () => {
    const files = deriveTreeFiles([
      call(2, 'c1', 'a.ts'),
      {
        event: { type: 'tool/result', seq: 3, data: { message: { content: [{}], source: { callId: 'c1' } } } },
        view: { card: 'diff', diffs: [{ path: 'a.ts', oldText: null, newText: 'x' }] },
      },
    ], 'child')
    expect(files[0]?.segments[0]).toMatchObject({ turn: null, time: 0 })
  })

  it('widens a path\'s seq span across repeat changes and keeps hunks of other paths out', () => {
    const files = deriveTreeFiles([
      turnStart(1, 1),
      call(2, 'c1', 'a.ts'),
      settled(3, 'c1', [
        { path: 'a.ts', oldText: 'one', newText: 'two' },
        { path: 'elsewhere.ts', oldText: 'x', newText: 'y' },
      ]),
      call(4, 'c2', 'a.ts', 'write'),
      settled(5, 'c2', [{ path: 'a.ts', oldText: 'two', newText: 'three' }]),
    ], 'child')
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ path: 'a.ts', firstSeq: 3, lastSeq: 5 })
    expect(files[0]?.segments.map(segment => segment.tool)).toEqual(['edit', 'write'])
  })

  it('ignores failed calls, unpaired results, malformed ids, and non-mutations', () => {
    const files = deriveTreeFiles([
      turnStart(1, 1),
      // A turn boundary whose payload is not a number resets to no turn.
      { event: { type: 'turn/start', seq: 2, data: { turn: 'second' } } },
      { event: { type: 'tool/call', seq: 3, data: { callId: 7 } }, view: { card: 'diff', locations: [{ path: 'x.ts' }] } },
      call(4, 'failed', 'failed.ts'),
      settled(5, 'failed', [{ path: 'failed.ts', oldText: 'a', newText: 'b' }], true),
      settled(6, 'never-called', [{ path: 'ghost.ts', oldText: 'a', newText: 'b' }]),
      { event: { type: 'tool/result', seq: 7, data: { message: { content: [{}], source: { callId: 9 } } } } },
      { event: { type: 'session/end', seq: 8, data: {} } },
      // A read is a call with a view, but not a mutation.
      {
        event: { type: 'tool/call', seq: 9, data: { callId: 'r1', name: 'read' } },
        view: { card: 'generic', kind: 'read', locations: [{ path: 'looked.ts' }] },
      },
      settled(10, 'r1', undefined),
    ], 'child')
    expect(files).toEqual([])
  })

  it('names no tool when the call head carried none, and counts a repeated location once', () => {
    const files = deriveTreeFiles([
      turnStart(1, 1),
      {
        event: { type: 'tool/call', seq: 2, time: 2, data: { callId: 'c1' } },
        view: { card: 'diff', locations: [{ path: 'a.ts' }, { path: 'a.ts' }] },
      },
      settled(3, 'c1', [{ path: 'a.ts', oldText: 'x', newText: 'y' }]),
    ], 'child')
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ firstSeq: 3, lastSeq: 3 })
    // Both passes over the repeated location append their hunk to one row.
    expect(files[0]?.segments).toHaveLength(2)
    expect(files[0]?.segments[0]).toMatchObject({ tool: null })
  })

  it('records a mutation that carried no hunks as a file with no segments', () => {
    const files = deriveTreeFiles([
      call(1, 'c1', 'a.ts'),
      settled(2, 'c1', undefined),
    ], 'child')
    expect(files).toEqual([{ path: 'a.ts', firstSeq: 2, lastSeq: 2, segments: [] }])
  })
})

describe('mergeTreeChanges', () => {
  const local: SessionFilesModel = {
    changed: [
      {
        path: 'shared.ts',
        firstSeq: 10,
        lastSeq: 10,
        writing: false,
        additions: 1,
        deletions: 1,
        segments: [{ turn: 1, tool: 'edit', source: null, time: 300, oldText: 'a', newText: 'b' }],
      },
      { path: 'own.ts', firstSeq: 20, lastSeq: 20, writing: true, additions: 0, deletions: 0, segments: [] },
    ],
    byTurn: new Map(),
    read: [],
    running: false,
    hasMore: false,
  }

  const source = (label: string, path: string, time: number): TreeSource => ({
    sessionId: `s-${label}`,
    label,
    files: [{
      path,
      firstSeq: 1,
      lastSeq: 1,
      segments: [{ turn: 2, tool: 'write', source: label, time, oldText: 'x', newText: 'y' }],
    }],
  })

  it('returns the model untouched when nothing was read', () => {
    expect(mergeTreeChanges(local, [])).toBe(local)
  })

  it('keeps one row per file and orders its segments by wall clock', () => {
    const merged = mergeTreeChanges(local, [source('reviewer', 'shared.ts', 100)])
    expect(merged.changed).toHaveLength(2)
    const shared = merged.changed[0]
    expect(shared?.path).toBe('shared.ts')
    // The descendant's change happened first; the merged row says so.
    expect(shared?.segments.map(segment => segment.source)).toEqual(['reviewer', null])
    // The local row keeps everything else it carried.
    expect(merged.changed[1]).toMatchObject({ path: 'own.ts', writing: true })
  })

  it('appends descendant-only files after the local rows, in discovery order', () => {
    const merged = mergeTreeChanges(local, [
      source('first', 'only-a.ts', 1),
      source('second', 'only-b.ts', 2),
    ])
    expect(merged.changed.map(entry => entry.path)).toEqual(['shared.ts', 'own.ts', 'only-a.ts', 'only-b.ts'])
    expect(merged.changed[2]?.segments[0]?.source).toBe('first')
  })

  it('carries the status bits through untouched', () => {
    const partial = { ...local, hasMore: true, running: true, read: ['looked.ts'] }
    const merged = mergeTreeChanges(partial, [source('child', 'only.ts', 1)])
    expect(merged).toMatchObject({ hasMore: true, running: true, read: ['looked.ts'] })
  })
})
