/**
 * Pure derivation joining the transcript's user questions to the turns that
 * answered them.
 *
 * One walk over the Chat order produces the question index, and one walk over
 * the timeline's turn boundaries attaches each question to the turn that ran
 * after it. Every surface that has to say what the reader is currently looking
 * at — the sticky question bar, the completed-turn recap, the compact turn
 * list — reads this one index, so they cannot disagree about which question
 * owns which answer, and none of them scans the Chat Nodes itself.
 * @module
 */

import type {
  ConversationTimelineSnapshot, TurnLocation, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'

/** One user question in transcript order, as the navigation surfaces show it. */
export interface QuestionEntry {
  /** Stable Chat Node key, which is also the transcript's scroll anchor. */
  key: string
  node: UserMessageNode
  /** Display text: the message's prose, or the image stand-in for a picture-only ask. */
  text: string
}

/**
 * How a turn ended, reduced to what a one-line summary can show.
 *
 * `TurnEndReason` is merge-extensible, so every reason this display does not
 * name — `blocked`, `max-tokens`, `interrupted`, and any variant a plugin
 * merges later — resolves to `other`: the turn is over and the reader is not
 * told a story the summary cannot stand behind.
 */
export type TurnOutcome = 'running' | 'completed' | 'stopped' | 'failed' | 'other'

/** One turn reduced to the facts a question-level summary shows. */
export interface TurnSummary {
  readonly turn: number
  /** Chat Node key of the question that opened the turn; null when the loaded window starts inside it. */
  readonly questionKey: string | null
  /** Position of that question in the loaded question index, for the navigator's numbering. */
  readonly questionIndex: number | null
  readonly outcome: TurnOutcome
  /** `turn/start` wall clock, or null when that boundary is outside the window. */
  readonly startTime: number | null
  /** `turn/end` wall clock, or null while the turn is still open. */
  readonly endTime: number | null
}

/** The question index and its two joins, derived once per snapshot. */
export interface QuestionTurnIndex {
  /** Questions in transcript order. */
  readonly questions: readonly QuestionEntry[]
  /** Turn summaries in log order. */
  readonly turns: readonly TurnSummary[]
  /** Summary by turn number. */
  readonly byTurn: ReadonlyMap<number, TurnSummary>
  /** Turn that answered one question, by that question's Chat Node key. */
  readonly turnOfQuestion: ReadonlyMap<string, number>
}

/** Prose of a user message, or the image stand-in when it carries only pictures. */
function questionText(node: UserMessageNode, imageLabel: string): string {
  const text = node.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
  if (text !== '') return text
  return node.content.some(block => block.type === 'image') ? imageLabel : '—'
}

/**
 * The loaded user questions, in transcript order.
 * @param order - the Chat snapshot's node order.
 * @param nodeStore - the Chat snapshot's keyed Node reader.
 * @param imageLabel - localized stand-in for a message carrying only images.
 * @returns one entry per finalized user message.
 */
export function questionEntries(
  order: readonly string[],
  nodeStore: { get: (key: string) => unknown },
  imageLabel: string,
): QuestionEntry[] {
  const entries: QuestionEntry[] = []
  for (const key of order) {
    const candidate = nodeStore.get(key) as { kind?: string; data?: unknown } | undefined
    if (candidate?.kind !== 'user') continue
    const node = candidate.data as UserMessageNode
    entries.push({ key, node, text: questionText(node, imageLabel) })
  }
  return entries
}

/** Reduce one turn's recorded end to the outcome a summary shows. */
function outcomeOf(turn: TurnLocation): TurnOutcome {
  if (turn.end === undefined) return turn.status === 'closed' ? 'other' : 'running'
  switch (turn.end.data.reason.kind) {
    case 'completed': return 'completed'
    case 'aborted': return 'stopped'
    case 'error': return 'failed'
    // Merge-extensible union: an unnamed reason is a finished turn this
    // summary does not characterize.
    default: return 'other'
  }
}

/**
 * Join the loaded questions to the turns that answered them.
 *
 * A question belongs to the last turn that opened at or before it. That is the
 * order the log records: the loop opens the turn and only then writes the
 * `user/message` events entering its first step, so a question's own seq falls
 * inside its turn. One batch of queued messages entering one step therefore
 * shares that turn, and the first of them is the turn's displayed opener. A
 * question below the first loaded boundary maps to nothing, because the window
 * holds no boundary that could own it.
 *
 * This is the same seq-to-turn rule the file rail attributes changes with, so
 * a question and the files its turn changed cannot disagree about ownership.
 * @param questions - the loaded question index, in transcript order.
 * @param timeline - the snapshot's turn index.
 * @returns the questions and both directions of the question/turn join.
 */
export function buildQuestionTurnIndex(
  questions: readonly QuestionEntry[],
  timeline: ConversationTimelineSnapshot,
): QuestionTurnIndex {
  const boundaries: Array<{ turn: number; seq: number }> = []
  for (const turn of timeline.turnOrder) {
    const start = timeline.turns.get(turn)?.start
    if (start !== undefined) boundaries.push({ turn, seq: start.seq })
  }
  boundaries.sort((left, right) => left.seq - right.seq)

  const turnOfQuestion = new Map<string, number>()
  const openerOf = new Map<number, { key: string; index: number }>()
  let owner: { turn: number; seq: number } | undefined
  let next = 0
  questions.forEach((question, index) => {
    // Questions and boundaries both ascend by seq, so the cursor only moves
    // forward across the whole index.
    for (;;) {
      const candidate = boundaries[next]
      if (candidate === undefined || candidate.seq > question.node.seq) break
      owner = candidate
      next += 1
    }
    if (owner === undefined) return
    turnOfQuestion.set(question.key, owner.turn)
    if (!openerOf.has(owner.turn)) openerOf.set(owner.turn, { key: question.key, index })
  })

  const turns: TurnSummary[] = []
  const byTurn = new Map<number, TurnSummary>()
  for (const turnNumber of timeline.turnOrder) {
    const location = timeline.turns.get(turnNumber)
    if (location === undefined) continue
    const opener = openerOf.get(turnNumber)
    const summary: TurnSummary = {
      turn: turnNumber,
      questionKey: opener?.key ?? null,
      questionIndex: opener?.index ?? null,
      outcome: outcomeOf(location),
      startTime: location.start?.time ?? null,
      endTime: location.end?.time ?? null,
    }
    turns.push(summary)
    byTurn.set(turnNumber, summary)
  }
  return { questions, turns, byTurn, turnOfQuestion }
}

/**
 * Rows a turn must span before its tail repeats the question.
 *
 * A short exchange needs no recap: the question is still on screen under the
 * answer, and a line restating it would be noise on every turn of a linear
 * read. Rows are the proxy for scroll distance available without measuring
 * layout, and a turn that produced this many is one whose opening message the
 * reader has to travel to reach.
 */
export const RECAP_MIN_ROWS = 4

/** What one completed turn's tail restates about the question that opened it. */
export interface TurnRecap {
  /** 1-based question number, matching the navigator and the sticky bar. */
  readonly number: number
  readonly text: string
  /** Chat Node key of the question, for the jump the recap offers. */
  readonly key: string
}

/**
 * Which completed turns should restate their question, keyed by the Chat Node
 * key of the tail that draws it.
 *
 * One pass over the same order the question index was built from: a tail whose
 * turn has a loaded opener far enough above it gets a recap, and every other
 * tail gets nothing.
 * @param order - the Chat snapshot's node order.
 * @param nodeStore - the Chat snapshot's keyed Node reader.
 * @param index - the question/turn join over the same snapshot.
 * @param minRows - rows the turn must span; defaults to {@link RECAP_MIN_ROWS}.
 * @returns recaps by turn-tail node key, empty when no turn is long enough.
 */
export function buildTurnRecaps(
  order: readonly string[],
  nodeStore: { get: (key: string) => unknown },
  index: QuestionTurnIndex,
  minRows: number = RECAP_MIN_ROWS,
): ReadonlyMap<string, TurnRecap> {
  const positionOf = new Map<string, number>()
  order.forEach((key, position) => { positionOf.set(key, position) })
  const recaps = new Map<string, TurnRecap>()
  order.forEach((key, position) => {
    const candidate = nodeStore.get(key) as { kind?: string; data?: { turn?: number } } | undefined
    if (candidate?.kind !== 'turn-tail') return
    const turn = candidate.data?.turn
    if (turn === undefined) return
    const summary = index.byTurn.get(turn)
    if (summary === undefined) return
    const openerKey = summary.questionKey
    const openerIndex = summary.questionIndex
    if (openerKey === null || openerIndex === null) return
    const openerPosition = positionOf.get(openerKey)
    if (openerPosition === undefined || position - openerPosition < minRows) return
    const opener = index.questions[openerIndex]
    if (opener === undefined) return
    recaps.set(key, { number: openerIndex + 1, text: opener.text, key: openerKey })
  })
  return recaps
}

/** One turn's contiguous run of Chat Nodes, in transcript order. */
export interface TurnGroup {
  /** Owning turn, or null for nodes below the first loaded boundary. */
  readonly turn: number | null
  readonly keys: readonly string[]
}

/**
 * Split the transcript into the turns that produced it.
 *
 * Nodes are attributed by their anchor seq against the loaded `turn/start`
 * boundaries — the same rule the question join and the file rail use, rather
 * than each Node's resolved Location, so a Node the window cannot place lands
 * in the unattributed group instead of vanishing.
 *
 * One group per turn, not per contiguous run: a turn is the unit a reader
 * folds, and it must stay one row however its Nodes are ordered. Turn order
 * follows first appearance, which is transcript order for a seq-ordered
 * Chat — the only ordering the Chat target publishes.
 * @param order - the Chat snapshot's node order.
 * @param nodeStore - the Chat snapshot's keyed Node reader.
 * @param timeline - the snapshot's turn index.
 * @returns one group per owning turn, in first-appearance order.
 */
export function buildTurnGroups(
  order: readonly string[],
  nodeStore: { get: (key: string) => unknown },
  timeline: ConversationTimelineSnapshot,
): readonly TurnGroup[] {
  const boundaries: Array<{ turn: number; seq: number }> = []
  for (const turn of timeline.turnOrder) {
    const start = timeline.turns.get(turn)?.start
    if (start !== undefined) boundaries.push({ turn, seq: start.seq })
  }
  boundaries.sort((left, right) => left.seq - right.seq)
  const owner = (seq: number): number | null => {
    let found: number | null = null
    for (const boundary of boundaries) {
      if (boundary.seq > seq) break
      found = boundary.turn
    }
    return found
  }
  const groups: Array<{ turn: number | null; keys: string[] }> = []
  const byTurn = new Map<number | null, { turn: number | null; keys: string[] }>()
  for (const key of order) {
    const node = nodeStore.get(key) as { anchorSeq?: number } | undefined
    const turn = node?.anchorSeq === undefined ? null : owner(node.anchorSeq)
    let group = byTurn.get(turn)
    if (group === undefined) {
      group = { turn, keys: [] }
      byTurn.set(turn, group)
      groups.push(group)
    }
    group.keys.push(key)
  }
  return groups
}

/**
 * How long a turn has been running, or ran.
 * @param summary - the turn's derived summary.
 * @param now - current wall clock, used while the turn is still open.
 * @returns elapsed milliseconds, or null without a recorded start.
 */
export function turnElapsedMs(summary: TurnSummary, now: number): number | null {
  if (summary.startTime === null) return null
  return Math.max(0, (summary.endTime ?? now) - summary.startTime)
}
