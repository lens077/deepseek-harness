/**
 * The `sessionStats` projection unit: a pure fold of step boundaries, stream
 * chunks, tool pairs, and assembled assistant messages into whole-log counts
 * and wall times.
 *
 * `step/end` — not `assistant/message` — is the counted step event because it
 * is the step lifecycle authority: the loop appends exactly one per entered
 * step, in a `finally`, so completed, failed, cancelled, and max-tokens steps
 * all land one. Counting assembled assistant messages instead would overcount
 * max-tokens usage-host messages (empty content, excluded from the surface)
 * and undercount cancelled steps (aborted before the message assembles).
 *
 * Complete lifecycle time pairs turn/start→turn/end and step/start→step/end.
 * Model time retains the client window fold's narrower
 * step/start→assistant/message definition; first token is the first non-empty
 * delta chunk and survives an in-step llm/retry, decode spans first token to
 * the assembled message on usage-reporting steps, and tool time pairs calls
 * with results by callId. A cancelled step therefore contributes stepMs and
 * turnMs without inventing model-completion, TTFT, or decode time.
 *
 * @module @deepseek-ai/dsh-session-stats/projection
 */

import { z } from 'zod'
import { isTokenDelta } from '@deepseek-ai/dsh-llm/message'
import type {} from '@deepseek-ai/dsh-llm-retry'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

/** Accumulated whole-log figures (the view is exactly these totals). */
interface SessionStatsTotals {
  turns: number
  steps: number
  turnMs: number
  stepMs: number
  llmMs: number
  toolMs: number
  toolCalls: number
  toolResults: number
  toolErrors: number
  llmRetries: number
  retryDelayMs: number
  completedTurns: number
  errorTurns: number
  abortedTurns: number
  blockedTurns: number
  maxTokenTurns: number
  interruptedTurns: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
  decodeTokens: number
}

/**
 * Fold state: the totals plus the in-flight boundaries they accrue from.
 * Turn numbers are host-assigned and monotonic per session, so a single
 * `lastTurn` slot decides "first closed step of a new turn"; the state is
 * plain JSON per the unit contract (persisted-cache precondition).
 */
interface SessionStatsState extends SessionStatsTotals {
  /** Turn of the last counted `step/end`; null before the first. */
  lastTurn: number | null
  /** Current turn boundary used for complete turn wall time. */
  openTurn: { turn: number; startTime: number } | null
  /** Current step boundary retained until `step/end`, including cancelled steps. */
  openStepBoundary: { turn: number; step: number; startTime: number } | null
  /** Model boundary retained only until one assistant message assembles. */
  openStep: { turn: number; step: number; startTime: number; firstTokenTime: number | null } | null
  /** Dispatch times of tool calls whose result has not landed, by callId. */
  pendingCalls: Record<string, number>
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    sessionStats: SessionStatsState
  }
}

const sessionStatsSchema = z.object({
  turns: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  turnMs: z.number().nonnegative(),
  stepMs: z.number().nonnegative(),
  llmMs: z.number().nonnegative(),
  toolMs: z.number().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  toolResults: z.number().int().nonnegative(),
  toolErrors: z.number().int().nonnegative(),
  llmRetries: z.number().int().nonnegative(),
  retryDelayMs: z.number().nonnegative(),
  completedTurns: z.number().int().nonnegative(),
  errorTurns: z.number().int().nonnegative(),
  abortedTurns: z.number().int().nonnegative(),
  blockedTurns: z.number().int().nonnegative(),
  maxTokenTurns: z.number().int().nonnegative(),
  interruptedTurns: z.number().int().nonnegative(),
  ttftMs: z.number().nonnegative(),
  ttftSteps: z.number().int().nonnegative(),
  decodeMs: z.number().nonnegative(),
  decodeTokens: z.number().nonnegative(),
}).strict()

/**
 * The fold state's shape (totals plus in-flight boundaries), validated on
 * persisted-cache rows after their `ver` gate — the unit's input boundary.
 * The view is a strict subset of the state, so this schema extends
 * `sessionStatsSchema` (the wire output boundary) with the boundary fields.
 */
const sessionStatsStateSchema = sessionStatsSchema.extend({
  lastTurn: z.number().int().nonnegative().nullable(),
  openTurn: z.object({
    turn: z.number().int().nonnegative(),
    startTime: z.number().nonnegative(),
  }).nullable(),
  openStepBoundary: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    startTime: z.number().nonnegative(),
  }).nullable(),
  openStep: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    startTime: z.number().nonnegative(),
    firstTokenTime: z.number().nonnegative().nullable(),
  }).nullable(),
  pendingCalls: z.record(z.string(), z.number().nonnegative()),
})

/**
 * Provider-reported completion tokens, guarded the way the window fold guards
 * node usage.
 * @param usage - the assistant/message event's optional usage record.
 * @returns the output-token count, or null when unreported or invalid.
 */
function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null
  const value = (usage as { outputTokens?: unknown }).outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Clamp an optional duration-like value to a finite non-negative contribution. */
function durationValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

/** Namespace provider-minted ids so special object property names stay ordinary keys. */
function pendingCallKey(callId: string): string {
  return `call:${callId}`
}

/** The `sessionStats` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export const sessionStatsProjectionDefinition = {
  key: 'sessionStats',
  stateVersion: 3,
  stateSchema: sessionStatsStateSchema,
  init: () => ({
    turns: 0,
    steps: 0,
    turnMs: 0,
    stepMs: 0,
    llmMs: 0,
    toolMs: 0,
    toolCalls: 0,
    toolResults: 0,
    toolErrors: 0,
    llmRetries: 0,
    retryDelayMs: 0,
    completedTurns: 0,
    errorTurns: 0,
    abortedTurns: 0,
    blockedTurns: 0,
    maxTokenTurns: 0,
    interruptedTurns: 0,
    ttftMs: 0,
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
    lastTurn: null,
    openTurn: null,
    openStepBoundary: null,
    openStep: null,
    pendingCalls: {},
  }),
  apply: (state, event) => {
    // Every uninteresting event returns the same reference (Object.is gates the change feed).
    switch (event.type) {
      case 'turn/start':
        return { ...state, openTurn: { turn: event.data.turn, startTime: event.time } }
      case 'step/start':
        return {
          ...state,
          openStepBoundary: { turn: event.data.turn, step: event.data.step, startTime: event.time },
          openStep: { turn: event.data.turn, step: event.data.step, startTime: event.time, firstTokenTime: null },
        }
      case 'assistant/chunk': {
        const open = state.openStep
        if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
        if (open.firstTokenTime !== null || !isTokenDelta(event.data.chunk)) return state
        return { ...state, openStep: { ...open, firstTokenTime: event.time } }
      }
      case 'assistant/message': {
        const open = state.openStep
        if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
        // One assembled message per step: closing the boundary means a
        // defensive duplicate cannot accrue twice.
        const next: SessionStatsState = {
          ...state,
          llmMs: state.llmMs + Math.max(0, event.time - open.startTime),
          openStep: null,
        }
        if (open.firstTokenTime !== null) {
          next.ttftMs += Math.max(0, open.firstTokenTime - open.startTime)
          next.ttftSteps += 1
          const outputTokens = usageOutputTokens(event.data.usage)
          if (outputTokens !== null) {
            next.decodeMs += Math.max(0, event.time - open.firstTokenTime)
            next.decodeTokens += outputTokens
          }
        }
        return next
      }
      case 'tool/call': {
        const key = pendingCallKey(event.data.callId)
        return {
          ...state,
          toolCalls: state.toolCalls + 1,
          pendingCalls: { ...state.pendingCalls, [key]: event.time },
        }
      }
      case 'tool/result': {
        // Namespacing makes provider-minted prototype names ordinary own keys;
        // the own-key check still treats an orphan result as unmatched.
        const key = pendingCallKey(event.data.message.source.callId)
        const dispatched = Object.hasOwn(state.pendingCalls, key) ? state.pendingCalls[key] : undefined
        const pendingCalls = dispatched === undefined
          ? state.pendingCalls
          : Object.fromEntries(Object.entries(state.pendingCalls).filter(([id]) => id !== key))
        return {
          ...state,
          toolResults: state.toolResults + 1,
          toolErrors: state.toolErrors + (event.data.message.content[0].isError === true ? 1 : 0),
          toolMs: state.toolMs + (dispatched === undefined ? 0 : Math.max(0, event.time - dispatched)),
          pendingCalls,
        }
      }
      case 'llm/retry': {
        const boundary = state.openStep
        if (boundary === null || boundary.turn !== event.data.turn || boundary.step !== event.data.step) return state
        return {
          ...state,
          llmRetries: state.llmRetries + 1,
          retryDelayMs: state.retryDelayMs + durationValue(event.data.delayMs),
        }
      }
      case 'step/end': {
        const boundary = state.openStepBoundary
        if (boundary === null || boundary.turn !== event.data.turn || boundary.step !== event.data.step) return state
        const stepMs = Math.max(0, event.time - boundary.startTime)
        return {
          ...state,
          turns: state.lastTurn === event.data.turn ? state.turns : state.turns + 1,
          steps: state.steps + 1,
          stepMs: state.stepMs + stepMs,
          lastTurn: event.data.turn,
          openStepBoundary: null,
          openStep: null,
        }
      }
      case 'turn/end': {
        const boundary = state.openTurn
        if (boundary === null || boundary.turn !== event.data.turn) return state
        const turnMs = Math.max(0, event.time - boundary.startTime)
        const outcome: Partial<SessionStatsTotals> = {}
        switch (event.data.reason.kind) {
          case 'completed':
            outcome.completedTurns = state.completedTurns + 1
            break
          case 'error':
            outcome.errorTurns = state.errorTurns + 1
            break
          case 'aborted':
            outcome.abortedTurns = state.abortedTurns + 1
            break
          case 'blocked':
            outcome.blockedTurns = state.blockedTurns + 1
            break
          case 'max-tokens':
            outcome.maxTokenTurns = state.maxTokenTurns + 1
            break
          case 'interrupted':
            outcome.interruptedTurns = state.interruptedTurns + 1
            break
          default:
            break
        }
        // Calls whose result never landed belong to the closed turn; clear them
        // instead of retaining unbounded projection state.
        return {
          ...state,
          ...outcome,
          turnMs: state.turnMs + turnMs,
          openTurn: null,
          openStepBoundary: null,
          openStep: null,
          pendingCalls: {},
        }
      }
      default:
        return state
    }
  },
  wire: {
    viewSchema: sessionStatsSchema,
    view: state => ({
      turns: state.turns,
      steps: state.steps,
      turnMs: state.turnMs,
      stepMs: state.stepMs,
      llmMs: state.llmMs,
      toolMs: state.toolMs,
      toolCalls: state.toolCalls,
      toolResults: state.toolResults,
      toolErrors: state.toolErrors,
      llmRetries: state.llmRetries,
      retryDelayMs: state.retryDelayMs,
      completedTurns: state.completedTurns,
      errorTurns: state.errorTurns,
      abortedTurns: state.abortedTurns,
      blockedTurns: state.blockedTurns,
      maxTokenTurns: state.maxTokenTurns,
      interruptedTurns: state.interruptedTurns,
      ttftMs: state.ttftMs,
      ttftSteps: state.ttftSteps,
      decodeMs: state.decodeMs,
      decodeTokens: state.decodeTokens,
    }),
  },
} satisfies ProjectionDefinition<'sessionStats', SessionStatsState>
