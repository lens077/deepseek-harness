/**
 * Session-tree derivation: the same vocabulary as the local one, read off raw
 * history entries instead of assembled Chat nodes.
 *
 * A subagent works in its own session and the parent log records only the
 * delegation call and its result, so a turn whose work was delegated
 * contributes nothing to {@link deriveSessionFiles}. `subagent.history` serves
 * a child's transcript — live or cold — as `{ event, view }` pairs carrying the
 * same host-computed render intents the local snapshot holds, so the change
 * vocabulary needs no second definition here; only the walk does.
 * @module
 */

import {
  changedPaths, diffHunks,
  type SessionFileEntry, type SessionFileSegment, type SessionFilesModel,
} from './session-files.ts'

/**
 * One history page item: the raw event plus its host-computed tool view.
 *
 * Declared structurally rather than against `SessionEvent`. These entries cross
 * the wire, so every payload field this walk reads is narrowed at the point of
 * use anyway, and the three fields it needs are the whole relationship — the
 * same treatment `changedPaths` and `diffHunks` give a view.
 */
export interface TreeHistoryEntry {
  readonly event: {
    readonly type: string
    readonly seq: number
    /** Unix epoch ms; the only ordering that survives leaving its own session. */
    readonly time?: number
    readonly data: unknown
  }
  readonly view?: unknown
}

/** One file a descendant session changed, with the changes it recorded. */
export interface TreeFileChange {
  readonly path: string
  /** Seq of the first recorded change inside its own session. */
  readonly firstSeq: number
  /** Seq of the most recent recorded change inside its own session. */
  readonly lastSeq: number
  readonly segments: readonly SessionFileSegment[]
}

/** One descendant's contribution, with the name its segments are labelled by. */
export interface TreeSource {
  readonly sessionId: string
  /** Display name for this descendant, drawn into every segment it contributes. */
  readonly label: string
  readonly files: readonly TreeFileChange[]
}

/**
 * Fold descendant changes into the local model: one row per file, whatever
 * recorded it.
 *
 * A file is the unit a reader reviews, so a file two agents touched stays one
 * row rather than splitting by author — the author rides each segment's label
 * instead. Within a row the segments sort by wall-clock time, the only ordering
 * that survives leaving its own session, because seqs restart per session. The
 * rows themselves keep the local order first and append descendant-only files
 * after it: mixing row order across sessions would reshuffle the list every
 * time a descendant read lands.
 * @param model - this session's own derived model.
 * @param sources - descendant contributions, in discovery order.
 * @returns the merged model; the input is returned unchanged when nothing was read.
 */
export function mergeTreeChanges(
  model: SessionFilesModel,
  sources: readonly TreeSource[],
): SessionFilesModel {
  if (sources.length === 0) return model
  const merged = new Map<string, { entry: SessionFileEntry; segments: SessionFileSegment[] }>()
  for (const entry of model.changed) {
    merged.set(entry.path, { entry, segments: [...entry.segments] })
  }
  const appended: string[] = []
  for (const source of sources) {
    for (const file of source.files) {
      const existing = merged.get(file.path)
      if (existing !== undefined) {
        existing.segments.push(...file.segments)
        continue
      }
      merged.set(file.path, {
        entry: {
          path: file.path,
          firstSeq: file.firstSeq,
          lastSeq: file.lastSeq,
          segments: [],
          writing: false,
        },
        segments: [...file.segments],
      })
      appended.push(file.path)
    }
  }
  const order = [...model.changed.map(entry => entry.path), ...appended]
  return {
    ...model,
    changed: order.map((path) => {
      const held = merged.get(path) as { entry: SessionFileEntry; segments: SessionFileSegment[] }
      return {
        ...held.entry,
        segments: [...held.segments].sort((left, right) => left.time - right.time),
      }
    }),
  }
}

/** Minimal shape of the `tool/result` payload this walk reads. */
interface ToolResultData {
  readonly message?: {
    readonly content?: ReadonlyArray<{ readonly isError?: unknown }>
    readonly source?: { readonly callId?: unknown }
  }
}

/** Minimal shape of the `tool/call` payload this walk reads. */
interface ToolCallData {
  readonly callId?: unknown
}

/** Minimal shape of the `turn/start` payload this walk reads. */
interface TurnStartData {
  readonly turn?: unknown
}

/**
 * Fold one session's history page into its changed files.
 *
 * Entries arrive in ascending seq order. A `tool/call` parks its render intent
 * under its call id; the paired `tool/result` decides whether it counted — a
 * failed call changed nothing — and carries the applied hunks. Turn boundaries
 * come from `turn/start`, so a page that starts mid-turn labels its first
 * segments with no turn rather than guessing one.
 * @param entries - one session's history entries, ascending.
 * @param source - the descendant's display name, stamped on every segment.
 * @returns one accumulator per changed path, in first-seen order.
 */
export function deriveTreeFiles(
  entries: readonly TreeHistoryEntry[],
  source: string,
): readonly TreeFileChange[] {
  const callViews = new Map<string, unknown>()
  const byPath = new Map<string, { firstSeq: number; lastSeq: number; segments: SessionFileSegment[] }>()
  let turn: number | null = null
  let tool: string | null = null
  const toolNames = new Map<string, string>()

  for (const entry of entries) {
    const { event } = entry
    if (event.type === 'turn/start') {
      const started = (event.data as TurnStartData).turn
      turn = typeof started === 'number' ? started : null
      continue
    }
    if (event.type === 'tool/call') {
      const callId = (event.data as ToolCallData).callId
      if (typeof callId !== 'string') continue
      callViews.set(callId, entry.view)
      const name = (event.data as { name?: unknown }).name
      if (typeof name === 'string') toolNames.set(callId, name)
      continue
    }
    if (event.type !== 'tool/result') continue
    const data = event.data as ToolResultData
    if (data.message?.content?.[0]?.isError === true) continue
    const callId = data.message?.source?.callId
    if (typeof callId !== 'string') continue
    const changed = changedPaths(callViews.get(callId))
    if (changed.length === 0) continue
    tool = toolNames.get(callId) ?? null
    const hunks = diffHunks(entry.view)
    for (const path of changed) {
      const existing = byPath.get(path)
      const accumulator = existing ?? { firstSeq: event.seq, lastSeq: event.seq, segments: [] }
      if (existing === undefined) byPath.set(path, accumulator)
      else if (event.seq > accumulator.lastSeq) accumulator.lastSeq = event.seq
      for (const hunk of hunks) {
        if (hunk.path !== path) continue
        accumulator.segments.push({
          turn, tool, source, time: event.time ?? 0, oldText: hunk.oldText, newText: hunk.newText,
        })
      }
    }
  }

  return [...byPath.entries()].map(([path, value]) => ({
    path,
    firstSeq: value.firstSeq,
    lastSeq: value.lastSeq,
    segments: value.segments,
  }))
}
