/**
 * The `sessionStats` projection unit: mounting the plugin beside the
 * projection registry serves whole-log counts and wall times folded from step
 * boundaries, chunks, tool pairs, and assembled messages; compositions
 * without the registry are unaffected; unmounting the plugin removes the key
 * (HMR safety). The two counting regressions pinned here are the reasons the
 * fold counts step boundaries instead of assistant messages: a cancelled step
 * never assembles a message but still counts, and a max-tokens usage-host
 * message (empty content) adds no extra step. Wall-time math runs against the
 * exported definition directly, where event times are controlled.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SessionStatsPlugin from '@deepseek-ai/dsh-session-stats'
import { sessionStatsProjectionDefinition } from '@deepseek-ai/dsh-session-stats/src/projection.ts'
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats/types'

async function harness(withStatsPlugin: boolean): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withStatsPlugin) await ctx.plugin(SessionStatsPlugin)
  return { ctx, session: ctx.sessions.create(SessionId('counted')) }
}

/** Close one step; returns the counted `step/end` seq. */
function closeStep(session: Session, turn: number, step: number): number {
  session.append('step/start', { turn, step })
  return session.append('step/end', { turn, step }).seq
}

/** Append the max-tokens usage-host shape: an assistant/message with empty content. */
function appendEmptyAssistantMessage(session: Session, turn: number, step: number): void {
  session.append('assistant/message', {
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content: [],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [] })
}

/** The all-zero projection value plus overrides, for exact fold expectations. */
function totals(overrides: Partial<SessionStatsProjection> = {}): SessionStatsProjection {
  return {
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
    ...overrides,
  }
}

describe('sessionStats projection unit (registry drive)', () => {
  it('serves zero figures on the empty log', async () => {
    const { ctx, session } = await harness(true)
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats).toEqual(totals())
  })

  it('counts distinct turns and closed steps and notifies the change feed with the causing seq', async () => {
    const { ctx, session } = await harness(true)
    const changes: { key: string; value: unknown; seq: number }[] = []
    ctx.sessionProjections.onChanged((_session, key, value, seq) => {
      changes.push({ key, value, seq })
    })
    session.append('turn/start', { turn: 1 })
    const firstSeq = closeStep(session, 1, 1)
    const secondSeq = closeStep(session, 1, 2)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    closeStep(session, 2, 1)
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    // Turn and step boundaries update internal timing state; their closing
    // events commit counts, durations, and outcome classifications.
    expect(changes.every(change => change.key === 'sessionStats')).toBe(true)
    expect(changes.find(change => change.seq === firstSeq)?.value)
      .toMatchObject({ turns: 1, steps: 1 })
    expect(changes.at(-1)).toMatchObject({
      key: 'sessionStats',
      seq: session.events.at(-1)?.seq,
      value: { turns: 2, steps: 3, completedTurns: 2 },
    })
    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.values.sessionStats).toMatchObject({ turns: 2, steps: 3, completedTurns: 2 })
    expect(snapshot.asOfSeq).toBe(session.seq - 1)
    expect(changes.map(change => change.seq)).toContain(secondSeq)
  })

  it('does not count a rejected turn as work but records its blocked outcome', async () => {
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'blocked' } })
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 0, steps: 0, blockedTurns: 1 })
  })

  it('counts a cancelled step that closed without an assistant message', async () => {
    // Regression: an aborted stream never assembles assistant/message, but the
    // loop's finally still appends step/end — the step happened and counts.
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    closeStep(session, 1, 1)
    session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'legacy' } } })
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 1 })
  })

  it('adds no extra step for a max-tokens usage-host assistant message', async () => {
    // Regression: the empty-content assistant/message exists only to host
    // usage and is excluded from the surface; the step counts once, from its
    // step/end, while the message contributes only its model wall time.
    const { ctx, session } = await harness(true)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    appendEmptyAssistantMessage(session, 1, 1)
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'max-tokens' } })
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 1, ttftSteps: 0, decodeTokens: 0 })
  })

  it('folds steps already in the log when the plugin mounts late (lazy cell build)', async () => {
    const { ctx, session } = await harness(false)
    session.append('turn/start', { turn: 1 })
    closeStep(session, 1, 1)
    closeStep(session, 1, 2)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await ctx.plugin(SessionStatsPlugin)
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 2 })
  })

  it('has no sessionStats key without the plugin, and drops it when the plugin unloads (HMR safety)', async () => {
    const { ctx, session } = await harness(false)
    expect('sessionStats' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    const fiber = await ctx.plugin(SessionStatsPlugin)
    session.append('turn/start', { turn: 1 })
    closeStep(session, 1, 1)
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats)
      .toMatchObject({ turns: 1, steps: 1 })
    await fiber.dispose()
    expect('sessionStats' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})

/** Build one synthetic committed event with a controlled timestamp. */
function at(time: number, type: string, data: unknown): SessionEvent {
  return { type, seq: time, time, data } as unknown as SessionEvent
}

/** Fold a synthetic event list through the definition and view the result. */
function fold(events: readonly SessionEvent[]): SessionStatsProjection {
  const state = events.reduce<Parameters<typeof sessionStatsProjectionDefinition.apply>[0]>(
    (folded, event) => sessionStatsProjectionDefinition.apply(folded, event),
    sessionStatsProjectionDefinition.init(),
  )
  return sessionStatsProjectionDefinition.wire.view(state)
}

describe('sessionStats wall-time fold (controlled timestamps)', () => {
  const message = createMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'answer' }],
    source: { kind: 'model', provider: 'mock', model: 'mock' },
  })

  it('accrues model, first-token, and decode time from one fully recorded step', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_800, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } }),
      at(4_800, 'assistant/message', { turn: 1, step: 1, message, usage: { inputTokens: 10, outputTokens: 60 } }),
      at(4_900, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({
      turns: 1, steps: 1, stepMs: 3_900, llmMs: 3_800,
      ttftMs: 800, ttftSteps: 1, decodeMs: 3_000, decodeTokens: 60,
    }))
  })

  it('keeps the first attempt token boundary across an in-step retry (window resetForRetry parity)', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_200, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'x' } }),
      at(2_000, 'llm/retry', { turn: 1, step: 1, delayMs: 750 }),
      at(3_000, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'y' } }),
      at(5_000, 'assistant/message', { turn: 1, step: 1, message }),
      at(5_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({
      turns: 1, steps: 1, stepMs: 4_100, llmMs: 4_000,
      llmRetries: 1, retryDelayMs: 750, ttftMs: 200, ttftSteps: 1,
    }))
  })

  it('ignores retry and close records outside their matching lifecycle boundary', () => {
    expect(fold([
      at(500, 'llm/retry', { turn: 1, step: 1, delayMs: 999 }),
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'llm/retry', { turn: 1, step: 2, delayMs: 999 }),
      at(1_200, 'llm/retry', { turn: 1, step: 1, delayMs: 250 }),
      at(1_300, 'step/end', { turn: 1, step: 2 }),
      at(1_500, 'assistant/message', { turn: 1, step: 1, message }),
      at(1_600, 'llm/retry', { turn: 1, step: 1, delayMs: 999 }),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
      at(2_100, 'llm/retry', { turn: 1, step: 1, delayMs: 999 }),
      at(2_200, 'step/end', { turn: 1, step: 1 }),
      at(3_000, 'turn/end', { turn: 2, reason: { kind: 'error', error: { code: 'ORPHAN', message: 'x' } } }),
      at(4_000, 'turn/start', { turn: 2 }),
      at(4_100, 'turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'WRONG', message: 'x' } } }),
      at(5_000, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
      at(5_100, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ])).toEqual(totals({
      turns: 1,
      steps: 1,
      turnMs: 1_000,
      stepMs: 1_000,
      llmMs: 500,
      llmRetries: 1,
      retryDelayMs: 250,
      completedTurns: 1,
    }))
  })

  it('ignores empty deltas, non-token chunks, and chunks outside the open step', () => {
    expect(fold([
      // Chunk before any step/start: no open boundary.
      at(500, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'stray' } }),
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } }),
      at(1_200, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '' } }),
      at(1_300, 'assistant/chunk', { turn: 2, step: 9, chunk: { type: 'text-delta', index: 0, text: 'other' } }),
      at(1_400, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'first' } }),
      at(2_000, 'assistant/message', { turn: 1, step: 1, message }),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({
      turns: 1, steps: 1, stepMs: 1_100, llmMs: 1_000, ttftMs: 400, ttftSteps: 1,
    }))
  })

  it('leaves a cancelled step untimed: counted by step/end, no assembled message to accrue from', () => {
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_500, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'partial' } }),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1, stepMs: 1_000 }))
  })

  it('pairs tool wall time by callId, ignores orphan results, and prunes leftovers at turn/end', () => {
    const result = (callId: string, isError = false): unknown => ({
      turn: 1,
      step: 1,
      message: { source: { kind: 'tool', callId }, content: [{ type: 'text', text: '', isError }] },
    })
    const paired = fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'tool/call', { turn: 1, step: 1, callId: 'a', name: 'read', arguments: '{}' }),
      at(1_200, 'tool/call', { turn: 1, step: 1, callId: 'b', name: 'read', arguments: '{}' }),
      // Out-of-order settlement pairs by id, not adjacency.
      at(4_200, 'tool/result', result('b')),
      at(1_600, 'tool/result', result('a')),
      at(5_000, 'tool/result', result('ghost', true)),
      at(5_100, 'step/end', { turn: 1, step: 1 }),
    ])
    expect(paired).toEqual(totals({
      turns: 1, steps: 1, stepMs: 4_100, toolMs: 3_500,
      toolCalls: 2, toolResults: 3, toolErrors: 1,
    }))
    // An unresolved call is dropped at turn/end; a later result cannot pair.
    const pruned = fold([
      at(500, 'turn/start', { turn: 1 }),
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'tool/call', { turn: 1, step: 1, callId: 'orphan', name: 'read', arguments: '{}' }),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
      at(2_100, 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'legacy' } } }),
      at(9_000, 'tool/result', result('orphan')),
    ])
    expect(pruned).toEqual(totals({
      turns: 1, steps: 1, turnMs: 1_600, stepMs: 1_000,
      toolCalls: 1, toolResults: 1, abortedTurns: 1,
    }))
  })

  it('handles provider-minted prototype property names as ordinary pending-call keys', () => {
    const result = (callId: string): unknown => ({
      turn: 1,
      step: 1,
      message: { source: { kind: 'tool', callId }, content: [{ type: 'text', text: '', isError: false }] },
    })
    // Crash recovery (TOOL_NOT_STARTED) emits results with no preceding call;
    // prototype names must remain absent instead of reading inherited values.
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_500, 'tool/result', result('toString')),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1, stepMs: 1_000, toolResults: 1 }))
    // The same name pairs normally once its call is recorded.
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'tool/call', { turn: 1, step: 1, callId: 'constructor', name: 'read', arguments: '{}' }),
      at(1_600, 'tool/result', result('constructor')),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({
      turns: 1, steps: 1, stepMs: 1_000, toolMs: 500, toolCalls: 1, toolResults: 1,
    }))
    expect(fold([
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_100, 'tool/call', { turn: 1, step: 1, callId: '__proto__', name: 'read', arguments: '{}' }),
      at(1_700, 'tool/result', result('__proto__')),
      at(2_000, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({
      turns: 1, steps: 1, stepMs: 1_000, toolMs: 600, toolCalls: 1, toolResults: 1,
    }))
  })

  it('skips decode for an invalid usage report and ignores a duplicate assembled message', () => {
    const events = [
      at(1_000, 'step/start', { turn: 1, step: 1 }),
      at(1_400, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } }),
      // A malformed provider report: guarded like the window fold guards node usage.
      at(2_000, 'assistant/message', { turn: 1, step: 1, message, usage: { inputTokens: 1, outputTokens: -5 } }),
    ]
    expect(fold([...events, at(2_100, 'step/end', { turn: 1, step: 1 })]))
      .toEqual(totals({
        turns: 1, steps: 1, stepMs: 1_100, llmMs: 1_000, ttftMs: 400, ttftSteps: 1,
      }))
    // The first message closed the step boundary; a defensive duplicate finds
    // no open step and folds to the same reference.
    const state = events.reduce<Parameters<typeof sessionStatsProjectionDefinition.apply>[0]>(
      (folded, event) => sessionStatsProjectionDefinition.apply(folded, event),
      sessionStatsProjectionDefinition.init(),
    )
    expect(sessionStatsProjectionDefinition.apply(
      state,
      at(2_050, 'assistant/message', { turn: 1, step: 1, message }),
    )).toBe(state)
  })

  it('classifies every core turn outcome and sums complete turn wall time', () => {
    expect(fold([
      at(1_000, 'turn/start', { turn: 1 }),
      at(1_500, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      at(2_000, 'turn/start', { turn: 2 }),
      at(2_600, 'turn/end', { turn: 2, reason: { kind: 'error', error: { code: 'TEST', message: 'x' } } }),
      at(3_000, 'turn/start', { turn: 3 }),
      at(3_700, 'turn/end', { turn: 3, reason: { kind: 'aborted', reason: { kind: 'legacy' } } }),
      at(4_000, 'turn/start', { turn: 4 }),
      at(4_800, 'turn/end', { turn: 4, reason: { kind: 'blocked' } }),
      at(5_000, 'turn/start', { turn: 5 }),
      at(5_900, 'turn/end', { turn: 5, reason: { kind: 'max-tokens' } }),
      at(6_000, 'turn/start', { turn: 6 }),
      at(7_000, 'turn/end', { turn: 6, reason: { kind: 'interrupted' } }),
    ])).toEqual(totals({
      turnMs: 4_500,
      completedTurns: 1,
      errorTurns: 1,
      abortedTurns: 1,
      blockedTurns: 1,
      maxTokenTurns: 1,
      interruptedTurns: 1,
    }))
  })

  it('accrues nothing for unrelated events and clamps negative clock skew to zero', () => {
    const state = sessionStatsProjectionDefinition.init()
    const untouched = sessionStatsProjectionDefinition.apply(state, at(1, 'user/message', { content: [] }))
    expect(untouched).toBe(state)
    expect(fold([
      at(2_000, 'step/start', { turn: 1, step: 1 }),
      at(1_000, 'assistant/message', { turn: 1, step: 1, message }),
      at(2_100, 'step/end', { turn: 1, step: 1 }),
    ])).toEqual(totals({ turns: 1, steps: 1, stepMs: 100 }))
  })
})
