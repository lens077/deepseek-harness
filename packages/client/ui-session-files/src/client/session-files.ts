/**
 * Pure derivation of the file panel's model from one conversation snapshot.
 *
 * The vocabulary is the mutation and read tools' own render intents, the same
 * source [ui-deliverables](../../../ui-deliverables) reads for its produced-file
 * row: a `card: 'diff'` view, or a `card: 'generic'` view whose `kind` is
 * `edit`, is a change; a `card: 'generic'` view whose `kind` is `read` is a
 * read. Nothing here consults the model's prose or a tool's name, so a new
 * mutation tool joins by declaring what it does.
 *
 * What a change's diff shows is this session's accumulated hunks for that file,
 * in the order they were recorded. Whole-file before/after never leaves the
 * host process and the recorded hunks carry no line numbers, so neither a
 * file-position ordering nor a merge of overlapping hunks is derivable here;
 * chronological order with a turn/tool label on each segment is what the data
 * supports.
 * @module
 */

import type {
  ConversationNode, ConversationSnapshot, ConversationTimelineSnapshot, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Read entries kept while the agent runs; older reads fall off the list. */
export const READ_LIMIT = 20

/**
 * Stand-in seq for a change still in flight: a running call has no settlement
 * seq yet, and sorting after every settled node is where it belongs in an
 * oldest-first list.
 */
const IN_FLIGHT_SEQ = Number.MAX_SAFE_INTEGER

/** One recorded change to one file, drawn as a labelled segment of its diff. */
export interface SessionFileSegment {
  /** Owning turn, or null when the window cut left this node's `turn/start` outside. */
  readonly turn: number | null
  /** The tool that made the change (`edit`, `write`), or null when the call head is outside the window. */
  readonly tool: string | null
  /**
   * The descendant session that recorded it, or null for this session's own
   * work. Turn numbers restart per session, so without this a merged view
   * cannot tell one agent's turn 3 from another's.
   */
  readonly source: string | null
  /**
   * Unix epoch ms of the settling event. Seqs are per-session, so this is the
   * only ordering that holds once descendant changes join the list.
   */
  readonly time: number
  /** Prior content of this hunk, or null for a create. */
  readonly oldText: string | null
  /** Content of this hunk after the change. */
  readonly newText: string
}

/** One file this session changed, with every recorded change to it. */
export interface SessionFileEntry {
  readonly path: string
  /** Total added lines across the recorded hunks. */
  readonly additions: number
  /** Total removed lines across the recorded hunks. */
  readonly deletions: number
  /** Seq of the first recorded change, which fixes this entry's place in the list. */
  readonly firstSeq: number
  /** Seq of the most recent recorded change, which picks the idle default selection. */
  readonly lastSeq: number
  /** Recorded hunks in the order they happened; empty when a mutation recorded no diff. */
  readonly segments: readonly SessionFileSegment[]
  /** Whether a call in flight right now is writing this path. */
  readonly writing: boolean
}

/** One file one turn changed, with that turn's own line totals for it. */
export interface SessionTurnFileEntry {
  readonly path: string
  /** Added lines across the hunks this turn recorded for the path. */
  readonly additions: number
  /** Removed lines across the hunks this turn recorded for the path. */
  readonly deletions: number
  /** Whether a call in flight right now is writing this path. */
  readonly writing: boolean
}

/** The panel's complete model for one session. */
export interface SessionFilesModel {
  /** Changed files, oldest first, so the newest file to be touched sits at the bottom. */
  readonly changed: readonly SessionFileEntry[]
  /**
   * The same changes sliced by the turn that made them, each list in the order
   * that turn first touched the file. A turn whose `turn/start` fell outside
   * the loaded window has no entry: its changes are in `changed`, but nothing
   * in the window says they were its.
   */
  readonly byTurn: ReadonlyMap<number, readonly SessionTurnFileEntry[]>
  /**
   * Files read while the agent runs, most recent first, capped at
   * {@link READ_LIMIT}. Empty while the agent is idle: this list answers what
   * the agent is doing now, and a finished task has no answer to give.
   */
  readonly read: readonly string[]
  /** Whether the agent is running, which drives the read list and the button's spinner. */
  readonly running: boolean
  /** Whether older history is unloaded, so the panel can say the list is partial. */
  readonly hasMore: boolean
}

/** The wire view fields this module reads; anything else on a view is ignored. */
interface CardView {
  readonly card?: unknown
  readonly kind?: unknown
  readonly locations?: unknown
  readonly diffs?: unknown
}

/** One validated hunk off a `card: 'diff'` view. */
interface Hunk {
  readonly path: string
  readonly oldText: string | null
  readonly newText: string
}

/**
 * Paths a view reports having created or changed, by render intent rather than
 * tool name. Mirrors ui-deliverables' rule so the two surfaces cannot disagree
 * about what counts as a change.
 * @param view - a call view off the snapshot, or null.
 * @returns the changed paths, or an empty list for every non-mutation view.
 */
export function changedPaths(view: unknown): readonly string[] {
  const card = view as CardView | null
  if (card === null || typeof card !== 'object') return []
  if (card.card === 'diff') return locationPaths(card.locations)
  if (card.card === 'generic' && card.kind === 'edit') return locationPaths(card.locations)
  return []
}

/**
 * Paths a view reports having read. Only the `read` tool's own intent
 * qualifies: a search returns a hit list, not files the agent opened.
 * @param view - a call view off the snapshot, or null.
 * @returns the read paths, or an empty list for every other view.
 */
export function readPaths(view: unknown): readonly string[] {
  const card = view as CardView | null
  if (card === null || typeof card !== 'object') return []
  if (card.card === 'generic' && card.kind === 'read') return locationPaths(card.locations)
  return []
}

/** The `path` of every well-formed entry in a view's `locations` array. */
function locationPaths(locations: unknown): readonly string[] {
  if (!Array.isArray(locations)) return []
  const paths: string[] = []
  for (const location of locations) {
    if (typeof location !== 'object' || location === null) continue
    const { path } = location as Record<string, unknown>
    if (typeof path === 'string') paths.push(path)
  }
  return paths
}

/**
 * Narrow a `card: 'diff'` view's `diffs` to well-formed hunks. The view crosses
 * the wire, so a version mismatch or an anomalous plugin can deliver a diff card
 * whose hunks are absent or malformed; those contribute no segment rather than
 * throwing inside the panel.
 * @param view - a result view off the snapshot, or null.
 * @returns the validated hunks, empty when the payload is unusable.
 */
export function diffHunks(view: unknown): readonly Hunk[] {
  const card = view as CardView | null
  if (card === null || typeof card !== 'object' || card.card !== 'diff') return []
  if (!Array.isArray(card.diffs)) return []
  const hunks: Hunk[] = []
  for (const hunk of card.diffs) {
    if (typeof hunk !== 'object' || hunk === null) continue
    const { path, oldText, newText } = hunk as Record<string, unknown>
    if (typeof path !== 'string' || typeof newText !== 'string') continue
    if (oldText !== null && typeof oldText !== 'string') continue
    hunks.push({ path, oldText, newText })
  }
  return hunks
}

/**
 * Resolve seqs to their owning turn.
 *
 * The timeline's `turn/start` seqs are the boundaries; a seq below the first
 * loaded boundary belongs to a turn the window cut away and resolves to null.
 * @param timeline - the snapshot's turn index.
 * @returns a resolver for ascending seqs, cheap to call once per node in order.
 */
export function turnResolver(timeline: ConversationTimelineSnapshot): (seq: number) => number | null {
  const boundaries: Array<{ turn: number; seq: number }> = []
  for (const turn of timeline.turnOrder) {
    const start = timeline.turns.get(turn)?.start
    if (start !== undefined) boundaries.push({ turn, seq: start.seq })
  }
  boundaries.sort((left, right) => left.seq - right.seq)
  return (seq) => {
    let owner: number | null = null
    for (const boundary of boundaries) {
      if (boundary.seq > seq) break
      owner = boundary.turn
    }
    return owner
  }
}

/**
 * Count logical lines while avoiding a phantom line after a trailing newline.
 *
 * @param text Hunk side to measure; `null` and the empty string both count as zero.
 * @returns Number of logical lines.
 */
export function textLineCount(text: string | null): number {
  if (text === null || text === '') return 0
  const endings = text.match(/\n/gu)?.length ?? 0
  return endings + (text.endsWith('\n') ? 0 : 1)
}

/**
 * Added and removed line totals across recorded hunks.
 *
 * @param segments Recorded changes for one file, in any order.
 * @returns Added and removed line totals summed over every segment.
 */
export function segmentLineStats(segments: readonly SessionFileSegment[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const segment of segments) {
    additions += textLineCount(segment.newText)
    deletions += textLineCount(segment.oldText)
  }
  return { additions, deletions }
}

/** Mutable accumulator for one path while the nodes are walked. */
interface Accumulated {
  firstSeq: number
  lastSeq: number
  segments: SessionFileSegment[]
}

/** Mutable per-turn line totals for one path. */
interface TurnAccumulated {
  additions: number
  deletions: number
  writing: boolean
}

/** Find or open the per-turn accumulator for one path, preserving first-touch order. */
function accumulateTurn(
  into: Map<number, Map<string, TurnAccumulated>>,
  turn: number,
  path: string,
): TurnAccumulated {
  let files = into.get(turn)
  if (files === undefined) {
    files = new Map()
    into.set(turn, files)
  }
  const existing = files.get(path)
  if (existing !== undefined) return existing
  const fresh: TurnAccumulated = { additions: 0, deletions: 0, writing: false }
  files.set(path, fresh)
  return fresh
}

/**
 * Derive the panel's model from one conversation snapshot.
 *
 * Only settled, successful calls contribute a change: a failed call changed
 * nothing, and a delete leaves nothing to open. Reads come from calls in flight
 * as well as settled ones, because the list exists to show what the agent is
 * reaching for right now.
 * @param snapshot - the session's current conversation snapshot.
 * @returns the changed files, the live read list, and the two status bits.
 */
export function deriveSessionFiles(snapshot: ConversationSnapshot): SessionFilesModel {
  const resolveTurn = turnResolver(snapshot.chat.timeline)
  const accumulated = new Map<string, Accumulated>()
  const perTurn = new Map<number, Map<string, TurnAccumulated>>()
  const reads: string[] = []

  for (const node of snapshot.nodes) {
    if (!isToolResult(node) || node.isError) continue
    for (const path of readPaths(node.callView)) reads.push(path)
    const changed = changedPaths(node.callView)
    if (changed.length === 0) continue
    const turn = resolveTurn(node.seq)
    const tool = node.call?.name ?? null
    const hunks = diffHunks(node.resultView)
    for (const path of changed) {
      const entry = accumulate(accumulated, path, node.seq)
      const owned = turn === null ? null : accumulateTurn(perTurn, turn, path)
      for (const hunk of hunks) {
        if (hunk.path !== path) continue
        entry.segments.push({
          turn, tool, source: null, time: node.time, oldText: hunk.oldText, newText: hunk.newText,
        })
        if (owned === null) continue
        owned.additions += textLineCount(hunk.newText)
        owned.deletions += textLineCount(hunk.oldText)
      }
    }
  }

  const writing = new Set<string>()
  for (const call of snapshot.runningCalls) {
    for (const path of readPaths(call.callView)) reads.push(path)
    for (const path of changedPaths(call.callView)) {
      writing.add(path)
      accumulate(accumulated, path, IN_FLIGHT_SEQ)
      accumulateTurn(perTurn, call.turn, path).writing = true
    }
  }

  const changed = [...accumulated.entries()]
    .map(([path, entry]) => ({
      path,
      ...segmentLineStats(entry.segments),
      firstSeq: entry.firstSeq,
      lastSeq: entry.lastSeq,
      segments: entry.segments,
      writing: writing.has(path),
    }))
    .sort((left, right) => left.firstSeq - right.firstSeq)

  const byTurn = new Map<number, readonly SessionTurnFileEntry[]>()
  for (const [turn, files] of perTurn) {
    byTurn.set(turn, [...files].map(([path, stats]) => ({
      path, additions: stats.additions, deletions: stats.deletions, writing: stats.writing,
    })))
  }

  return {
    changed,
    byTurn,
    read: snapshot.running ? recentReads(reads) : [],
    running: snapshot.running,
    hasMore: snapshot.hasMore,
  }
}

/**
 * One derivation per snapshot, shared by every reader.
 *
 * Snapshots are immutable and replaced on change, so the snapshot itself is the
 * cache key. Without this each selector call would walk the whole node list
 * again — the button, the rail, and every re-render, on every streaming frame
 * of a session that can run to hundreds of steps.
 */
const derived = new WeakMap<ConversationSnapshot, SessionFilesModel>()

/**
 * The panel model for one snapshot, computed at most once per snapshot.
 * @param snapshot - the session's current conversation snapshot.
 * @returns the derived model, from cache when this snapshot was seen before.
 */
export function sessionFilesOf(snapshot: ConversationSnapshot): SessionFilesModel {
  const cached = derived.get(snapshot)
  if (cached !== undefined) return cached
  const model = deriveSessionFiles(snapshot)
  derived.set(snapshot, model)
  return model
}

/** Find or open this path's accumulator and widen its seq span. */
function accumulate(into: Map<string, Accumulated>, path: string, seq: number): Accumulated {
  const existing = into.get(path)
  if (existing === undefined) {
    const fresh: Accumulated = { firstSeq: seq, lastSeq: seq, segments: [] }
    into.set(path, fresh)
    return fresh
  }
  if (seq > existing.lastSeq) existing.lastSeq = seq
  return existing
}

/** The most recent reads, newest first, deduplicated and capped. */
function recentReads(paths: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const recent: string[] = []
  for (const path of [...paths].reverse()) {
    if (recent.length >= READ_LIMIT) break
    if (seen.has(path)) continue
    seen.add(path)
    recent.push(path)
  }
  return recent
}

function isToolResult(node: ConversationNode): node is ToolResultNode {
  return node.kind === 'tool-result'
}

/** One question's changed files, as the rail draws one collapsible group. */
export interface SessionFileGroup {
  /** Stable group identity for collapse state; the turn number, or `other`. */
  readonly id: string
  /** The question that caused these changes, absent for the trailing group. */
  readonly question: { readonly number: number; readonly text: string; readonly key: string } | null
  readonly files: readonly SessionTurnFileEntry[]
  /** Added lines across the group's files. */
  readonly additions: number
  /** Removed lines across the group's files. */
  readonly deletions: number
}

/**
 * Group a session's changes under the question that caused each of them.
 *
 * Newest question first, because the change a reader came to check is the one
 * the agent just made. Everything the loaded window cannot attribute to a
 * question — a turn older than the window, and every file only a descendant
 * session touched — collects in one trailing group rather than being dropped,
 * so the grouped view still lists exactly what the flat one does.
 * @param model - the derived panel model, descendants already merged.
 * @param questions - loaded questions with their turns, oldest first.
 * @returns the non-empty groups, newest question first, trailing group last.
 */
export function groupFilesByQuestion(
  model: SessionFilesModel,
  questions: readonly { readonly turn: number; readonly text: string; readonly number: number; readonly key: string }[],
): readonly SessionFileGroup[] {
  const groups: SessionFileGroup[] = []
  const claimed = new Set<string>()
  for (const question of [...questions].reverse()) {
    const files = model.byTurn.get(question.turn) ?? []
    if (files.length === 0) continue
    for (const file of files) claimed.add(file.path)
    groups.push({
      id: String(question.turn),
      question: { number: question.number, text: question.text, key: question.key },
      files,
      ...totals(files),
    })
  }
  const rest = model.changed
    .filter(entry => !claimed.has(entry.path))
    .map(entry => ({
      path: entry.path, additions: entry.additions, deletions: entry.deletions, writing: entry.writing,
    }))
  if (rest.length > 0) groups.push({ id: 'other', question: null, files: rest, ...totals(rest) })
  return groups
}

/** Added and removed line totals across a group's files. */
function totals(files: readonly SessionTurnFileEntry[]): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const file of files) {
    additions += file.additions
    deletions += file.deletions
  }
  return { additions, deletions }
}

/**
 * The entry the panel selects when the reader has not chosen one: the file
 * being written if a call is in flight, otherwise the most recently changed.
 * @param model - the derived panel model.
 * @returns the default path, or null when this session changed nothing.
 */
export function defaultSelection(model: SessionFilesModel): string | null {
  const writing = model.changed.find(entry => entry.writing)
  if (writing !== undefined) return writing.path
  let latest: SessionFileEntry | undefined
  for (const entry of model.changed) {
    if (latest === undefined || entry.lastSeq > latest.lastSeq) latest = entry
  }
  return latest?.path ?? null
}

/**
 * Trailing path segment, the part that identifies the file at a glance.
 * @param path - slash- or backslash-separated path.
 * @returns the final segment, or the whole string when separator-free.
 */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * Provenance header for one segment. The turn is what distinguishes one call
 * that changed two places from two calls that changed one place each, so it
 * leads; a window that cut the owning `turn/start` away leaves the tool alone,
 * and a window that also lost the call head leaves the neutral word. A segment
 * a descendant session recorded is prefixed with that descendant, because turn
 * numbers restart per session and would otherwise collide in one list.
 * @param segment - one recorded change.
 * @param t - the plugin's bound translate.
 * @returns the label the inline diff draws above the segment.
 */
export function segmentLabel(
  segment: Pick<SessionFileSegment, 'turn' | 'tool' | 'source'>,
  t: (
    key: 'segment.turn' | 'segment.looseTurn' | 'segment.change' | 'segment.sourced',
    params?: Record<string, string>,
  ) => string,
): string {
  const tool = segment.tool ?? t('segment.change')
  const own = segment.turn === null
    ? t('segment.looseTurn', { tool })
    : t('segment.turn', { turn: String(segment.turn), tool })
  return segment.source === null ? own : t('segment.sourced', { source: segment.source, rest: own })
}

/** Horizontal space a rail row spends on padding, gap, and the writing spinner. */
const ROW_CHROME_PX = 52

/**
 * Deliberately pessimistic average glyph width for the rail's 13px UI font. Too
 * high truncates a few characters early, which costs nothing; too low lets the
 * CSS ellipsis fire and take the tail away, which is the whole failure this
 * estimate exists to avoid.
 */
const GLYPH_PX = 7

/**
 * Characters a rail row can show at one width.
 * @param width - the rail's current width in px.
 * @returns a character budget, never below a legible floor.
 */
export function labelBudget(width: number): number {
  return Math.max(12, Math.floor((width - ROW_CHROME_PX) / GLYPH_PX))
}

/**
 * Drop the head of an over-long name, keeping the tail.
 *
 * Names in one session differ at the end far more often than at the start — a
 * document and its translation are `notes.md` and `notes.zh.md`, and a dated
 * series shares its whole prefix. A trailing ellipsis renders those as the same
 * string, so this keeps the end and marks the cut at the front. Truncating here
 * rather than through `direction: rtl` avoids bidi reordering: in an rtl
 * context a leading digit run moves to the end of the line.
 * @param text - the name to fit.
 * @param budget - characters available, from {@link labelBudget}.
 * @returns the name, or a leading ellipsis and its last `budget - 1` characters.
 */
export function truncateHead(text: string, budget: number): string {
  if (text.length <= budget) return text
  return `…${text.slice(text.length - budget + 1)}`
}
