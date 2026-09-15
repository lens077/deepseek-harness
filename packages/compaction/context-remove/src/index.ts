/**
 * Idle-session removal of complete turns from model-visible history
 * (`ctx.contextRemoval`). One request replaces each contiguous group of
 * selected turns with an empty-content checkpoint user message that projects to
 * no wire message, so the model no longer sees those turns while the
 * append-only log, the human transcript, and replay keep every removed event.
 * @module @deepseek-ai/dsh-context-remove
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  deriveEventMessage,
  isReplacementSurfaceEvent,
  isSurfaceEligibleType,
  isSurfaceEvent,
  SessionSeq,
  type Session,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import {
  ContextRemovalId, contextRemovalSource, isContextRemovalSource, toolPairingBalancedAfter, toolPairingBalancedBefore,
} from '@deepseek-ai/dsh-compaction'
// Type-only: the `ctx.tokenMeter` Context merge for the declared injection.
import type {} from '@deepseek-ai/dsh-token-meter'
import type {
  ContextRemovalAgentContext,
  ContextRemovalErrorCode,
  ContextRemovalGroup,
  ContextRemovalResult,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    contextRemoval: ContextRemovalExecutor
  }
}

/** Expected removal failure suitable for a direct human-facing result. */
export class ContextRemovalError extends Error {
  override readonly name = 'ContextRemovalError'

  /**
   * Create one classified removal failure.
   * @param code - stable failure class.
   * @param message - diagnostic retained as the Error message.
   * @param turn - the first turn the failure is about, when one is.
   * @param options - optional original failure.
   */
  constructor(
    readonly code: ContextRemovalErrorCode,
    message: string,
    readonly turn?: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

/** One turn's validated contiguous surface span. */
interface TurnSpan {
  readonly turn: number
  readonly startIdx: number
  readonly endIdx: number
  readonly promptSeqs: SessionSeq[]
}

/** One contiguous group of turn spans, before its replacement is appended. */
interface PlannedGroup {
  readonly turns: number[]
  readonly startIdx: number
  endIdx: number
  readonly promptSeqs: SessionSeq[]
  readonly shadowedSeqs: SessionSeq[]
}

/** Durable facts one forward log scan yields for a removal request. */
interface LogScan {
  readonly bounds: Map<number, { start: SessionSeq; end?: SessionSeq }>
  readonly openTurn: number | null
  readonly openCompaction: boolean
}

/** Read the turn boundaries of the requested turns and the durable lock state in one pass. */
function scanLog(session: Session, turns: ReadonlySet<number>): LogScan {
  const bounds = new Map<number, { start: SessionSeq; end?: SessionSeq }>()
  let openTurn: number | null = null
  let openCompaction = false
  for (let seq = 0; seq < session.seq; seq += 1) {
    // Every seq below the log length is a committed event.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const event = session.eventAt(SessionSeq(seq))!
    switch (event.type) {
      case 'turn/start':
        openTurn = event.data.turn
        if (turns.has(event.data.turn)) bounds.set(event.data.turn, { start: event.seq })
        break
      case 'turn/end': {
        openTurn = null
        const bound = bounds.get(event.data.turn)
        if (bound !== undefined && bound.end === undefined) bound.end = event.seq
        break
      }
      case 'compaction/start':
        openCompaction = true
        break
      case 'compaction/end':
        openCompaction = false
        break
      case 'session/end-seed':
        // An unmatched bracket or turn before a seed boundary belongs to an
        // earlier session lifecycle, whatever ended it.
        openCompaction = false
        openTurn = null
        break
      default:
        break
    }
  }
  return { bounds, openTurn, openCompaction }
}

/** How one current surface node relates to a turn's log range. */
type NodeMembership = 'inside' | 'outside' | 'shared'

/**
 * Classify a current surface node against one turn's log range. A replacement
 * copy (a pruned tool result, a compaction summary) sits at the shadowed
 * position; it is inside the turn when every surface event it cites is, and
 * shared when its cited surface events straddle the range — that turn cannot
 * be removed without also removing history the summary condensed.
 */
function nodeMembership(session: Session, event: SessionEvent, start: SessionSeq, end: SessionSeq): NodeMembership {
  if (event.seq >= start && event.seq <= end) return 'inside'
  if (!isSurfaceEvent(event) || !isReplacementSurfaceEvent(event)) return 'outside'
  // An earlier removal checkpoint already removed what it cites; it is not
  // turn material, so a removed turn reads as absent rather than removable.
  if (event.type === 'user/message' && isContextRemovalSource(event.data.source)) return 'outside'
  // Log-only citations (a compaction's own markers) say where the replacement
  // was written, not what it replaced.
  // The fold admits a replacement only with citations covering every shadowed
  // node, each an earlier committed event.
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const material = event.sourceEventSeqs!.filter(seq => isSurfaceEligibleType(session.eventAt(seq)!.type))
  const inside = material.filter(seq => seq >= start && seq <= end).length
  if (inside === 0) return 'outside'
  return inside === material.length ? 'inside' : 'shared'
}

/** Resolve one completed turn to its contiguous, balanced current surface span. */
function turnSpan(session: Session, turn: number, scan: LogScan): TurnSpan {
  const bound = scan.bounds.get(turn)
  if (bound === undefined) {
    throw new ContextRemovalError('unavailable', `turn ${turn} is not in this session`, turn)
  }
  const { start, end } = bound
  if (end === undefined) {
    throw new ContextRemovalError('unavailable', `turn ${turn} has not completed`, turn)
  }
  const nodes = session.surface.nodes
  const indices: number[] = []
  const promptSeqs: SessionSeq[] = []
  nodes.forEach((seq, index) => {
    // Every surface seq is a committed log event.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const event = session.eventAt(seq)!
    // Surface node 0 holds the system prompt that the first turn appended; it
    // is never part of a removable span.
    if (index === 0 && event.type === 'system/message') return
    const membership = nodeMembership(session, event, start, end)
    if (membership === 'shared') {
      throw new ContextRemovalError(
        'unavailable',
        `turn ${turn} shares a compaction summary with other history and cannot be removed alone`,
        turn,
      )
    }
    if (membership === 'outside') return
    indices.push(index)
    if (event.type === 'user/message' && event.surfaceOp === 'append' && event.data.source.kind === 'user') {
      promptSeqs.push(seq)
    }
  })
  if (indices.length === 0) {
    throw new ContextRemovalError('unavailable', `turn ${turn} is already absent from model history`, turn)
  }
  // A turn's log range is contiguous and replacements shadow contiguous spans,
  // so its surface nodes stay adjacent: the first and last indices bound them.
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const first = indices[0]!
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const last = indices.at(-1)!
  // Both nodes exist: their indices were just read off the surface.
  // oxlint-disable-next-line typescript/no-non-null-assertion
  if (!toolPairingBalancedBefore(session, nodes[first]!) || !toolPairingBalancedAfter(session, nodes[last]!)) {
    throw new ContextRemovalError(
      'unavailable',
      `turn ${turn} is not a balanced span (a tool call would lose its result)`,
      turn,
    )
  }
  return { turn, startIdx: first, endIdx: last, promptSeqs }
}

/** Order spans by surface position and merge surface-adjacent turns into one group. */
function groupSpans(session: Session, spans: readonly TurnSpan[]): PlannedGroup[] {
  const nodes = session.surface.nodes
  const ordered = [...spans].sort((left, right) => left.startIdx - right.startIdx)
  const groups: PlannedGroup[] = []
  for (const span of ordered) {
    const previous = groups.at(-1)
    if (previous !== undefined && previous.endIdx + 1 === span.startIdx) {
      previous.turns.push(span.turn)
      previous.promptSeqs.push(...span.promptSeqs)
      previous.shadowedSeqs.push(...nodes.slice(span.startIdx, span.endIdx + 1))
      previous.endIdx = span.endIdx
      continue
    }
    groups.push({
      turns: [span.turn],
      startIdx: span.startIdx,
      endIdx: span.endIdx,
      promptSeqs: [...span.promptSeqs],
      shadowedSeqs: nodes.slice(span.startIdx, span.endIdx + 1),
    })
  }
  return groups
}

/**
 * Remove complete turns from one idle agent's model-visible history. Load one
 * instance per context as `ctx.contextRemoval`.
 */
export class ContextRemovalExecutor extends Service {
  // The token meter prices each shadowed span for its logged shadow-price event
  // and the session store owns the durability checkpoint after the replacements.
  static inject = ['tokenMeter', 'sessions']

  constructor(ctx: Context) {
    super(ctx, 'contextRemoval')
  }

  /**
   * Remove the complete surface span of each requested completed turn from
   * model history, one replacement per contiguous group of selected turns.
   * Validation and every append run synchronously inside the agent's idle
   * maintenance phase, so either all groups land or none does; the durability
   * checkpoint follows.
   *
   * Each replacement is an empty-content user message carrying
   * {@link contextRemovalSource} with a `replace` surface operation over the
   * group's span, immediately preceded by a `compaction/prune` shadow-price
   * event pricing that span through the token meter. The first system-prompt
   * node is never part of a span; later system nodes inside a removed turn are
   * shadowed with it, and the loop's normalization restores the prompt on the
   * next request.
   * @param agent - idle agent whose session is rewritten.
   * @param turns - completed turn numbers to remove; duplicates are ignored.
   * @param signal - cancellation scoped to this request.
   * @returns the landed replacements.
   * @throws {@link ContextRemovalError} for busy, unavailable, cancelled, or persistence failures.
   */
  removeTurns(
    agent: ContextRemovalAgentContext,
    turns: readonly number[],
    signal: AbortSignal,
  ): Promise<ContextRemovalResult> {
    if (signal.aborted) return Promise.reject(signal.reason as Error)
    const requested = new Set(turns)
    if (requested.size === 0) {
      return Promise.reject(new ContextRemovalError('unavailable', 'no turns were requested'))
    }
    try {
      return agent.runMaintenance(async (agentSignal) => {
        const operationSignal = AbortSignal.any([agentSignal, signal])
        let result: ContextRemovalResult
        try {
          operationSignal.throwIfAborted()
          result = this.commit(agent.session, requested)
        } catch (error: unknown) {
          if (agentSignal.aborted && operationSignal.reason === agentSignal.reason) {
            throw new ContextRemovalError('cancelled', 'context removal was cancelled', undefined, { cause: error })
          }
          throw error
        }
        try {
          await this.ctx.sessions.flush(agent.session)
        } catch (error: unknown) {
          throw new ContextRemovalError(
            'persistence',
            'context removal durability checkpoint failed',
            undefined,
            { cause: error },
          )
        }
        return result
      })
    } catch (error: unknown) {
      return Promise.reject(new ContextRemovalError(
        'busy',
        'context removal requires an idle agent with no waking queued work',
        undefined,
        { cause: error },
      ))
    }
  }

  /** Validate every requested turn against the current log, then append all groups without yielding. */
  private commit(session: Session, requested: ReadonlySet<number>): ContextRemovalResult {
    const scan = scanLog(session, requested)
    if (scan.openCompaction) {
      throw new ContextRemovalError('busy', 'context removal: a compaction is in progress')
    }
    if (scan.openTurn !== null) {
      throw new ContextRemovalError('busy', `context removal: turn ${scan.openTurn} is still open`)
    }
    const spans = [...requested].map(turn => turnSpan(session, turn, scan))
    const removalId = ContextRemovalId(randomUUID())
    const groups: ContextRemovalGroup[] = []
    for (const group of groupSpans(session, spans)) {
      const shadowedTokenCount = group.shadowedSeqs.reduce((total, seq) => {
        // Every shadowed seq is a current surface node.
        // oxlint-disable-next-line typescript/no-non-null-assertion
        const message = deriveEventMessage(session.eventAt(seq)!)
        return total + (message === null ? 0 : this.ctx.tokenMeter.estimateMessage(message))
      }, 0)
      // Both edges exist: the group was built from a non-empty span.
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const start = group.shadowedSeqs[0]!
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const end = group.shadowedSeqs.at(-1)!
      // Shadow-price protocol: the metering event and its replacement are
      // appended synchronously adjacent, so pure consumers subtract the
      // span's heuristic price without retaining per-node state.
      const prune = session.append('compaction/prune', {
        shadowedRange: { start, end },
        shadowedSeqs: [...group.shadowedSeqs],
        shadowedTokenCount,
      })
      const checkpoint = session.append('user/message', createUserMessage({
        content: [],
        source: contextRemovalSource(removalId, group.turns, group.promptSeqs),
      }), {
        surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
        sourceEventSeqs: [prune.seq, ...group.shadowedSeqs],
      })
      groups.push({
        turns: group.turns,
        pruneSeq: prune.seq,
        checkpointSeq: checkpoint.seq,
        shadowedSeqs: group.shadowedSeqs,
        shadowedTokenCount,
      })
    }
    return {
      removalId,
      turns: groups.flatMap(group => group.turns),
      groups,
    }
  }
}

export default ContextRemovalExecutor
