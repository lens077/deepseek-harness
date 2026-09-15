/**
 * Session Controller turn-removal delegation through the composed
 * ContextRemovalExecutor. The agent factory is a structural stub over the real
 * SessionStore; the registered agent stub owns an idle `runMaintenance` so the
 * executor's maintenance claim runs the task directly.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ContextRemovalExecutor from '@deepseek-ai/dsh-context-remove'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createSessionTestRemote } from './test-remote.ts'

const sid = (id: string): SessionId => id as SessionId

async function composed(withRemoval = true): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(TokenMeter)
  if (withRemoval) await ctx.plugin(ContextRemovalExecutor)
  ctx.agents.setFactory({
    createAgent: (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: [...options.seed] },
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const agent = { id: session.id, session, status: 'idle', ctx: ownerCtx } as Agent
      ctx.agents.register(agent)
      return Promise.resolve({ agent, dispose: () => Promise.resolve() })
    },
    resume: () => Promise.reject(new Error('resume must not run: every source is attached')),
  })
  return ctx
}

/** Register one live idle agent whose log holds `turns` completed exchanges. */
function liveAgent(ctx: Context, id: string, turns: number, busy = false): Session {
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj' } })
  for (let turn = 1; turn <= turns; turn++) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `prompt ${String(turn)}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn, step: 1 })
    session.append('assistant/message', {
      stream: [],
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: `answer ${String(turn)}` }],
        source: { provider: 'p', model: 'm' },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  ctx.agents.register({
    id: session.id,
    session,
    status: 'idle',
    ctx,
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (busy) throw new Error('agent already has active work')
      return task(new AbortController().signal)
    },
  } as unknown as Agent)
  return session
}

const remote = (ctx: Context) => createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

function derivedText(session: Session): string[] {
  return session.deriveMessages().map(message => message.content
    .map(block => block.type === 'text' ? block.text : '')
    .join(''))
}

describe('sessions.removeTurns', () => {
  it('removes the requested turns through the composed executor and echoes the checkpoints', async () => {
    const ctx = await composed()
    const source = liveAgent(ctx, 'session-remove', 3)

    const removed = await remote(ctx).removeTurns({ sessionId: source.id, turns: [3, 1] })
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.value.turns).toEqual([1, 3])
    expect(removed.value.checkpointSeqs).toHaveLength(2)
    for (const seq of removed.value.checkpointSeqs) {
      const event = source.snapshotEvents()[seq]
      expect(event?.type).toBe('user/message')
      expect(event?.type === 'user/message' ? event.data.content : null).toEqual([])
    }
    expect(derivedText(source)).toEqual(['prompt 2', 'answer 2'])
  })

  it('rejects a malformed turn list before resolving the session', async () => {
    const ctx = await composed()
    const source = liveAgent(ctx, 'session-remove-bad', 1)

    for (const turns of [[], [1.5], [-1]]) {
      const response = await remote(ctx).removeTurns({ sessionId: source.id, turns })
      expect(response.ok).toBe(false)
      if (!response.ok) expect(response.error.code).toBe('gateway/bad-request')
    }
    expect(derivedText(source)).toEqual(['prompt 1', 'answer 1'])
  })

  it('maps an unavailable turn with its number and a busy agent to their business errors', async () => {
    const ctx = await composed()
    const source = liveAgent(ctx, 'session-remove-unavailable', 2)

    const unavailable = await remote(ctx).removeTurns({ sessionId: source.id, turns: [1, 7] })
    expect(unavailable.ok).toBe(false)
    if (!unavailable.ok) {
      expect(unavailable.error).toMatchObject({
        code: 'session/turn-remove-unavailable',
        details: { sessionId: source.id, turn: 7 },
      })
    }
    expect(derivedText(source)).toHaveLength(4)

    const busySource = liveAgent(ctx, 'session-remove-busy', 1, true)
    const busy = await remote(ctx).removeTurns({ sessionId: busySource.id, turns: [1] })
    expect(busy.ok).toBe(false)
    if (!busy.ok) expect(busy.error.code).toBe('session/agent-busy')
  })

  it('maps a cancelled request and other executor failures to internal', async () => {
    const ctx = await composed()
    const source = liveAgent(ctx, 'session-remove-cancel', 1)
    const controller = new AbortController()
    controller.abort(new Error('caller gone'))

    const cancelled = await remote(ctx).removeTurns({ sessionId: source.id, turns: [1] }, controller.signal)
    expect(cancelled.ok).toBe(false)
    if (!cancelled.ok) expect(cancelled.error.code).toBe('gateway/internal')
    expect(derivedText(source)).toHaveLength(2)
  })

  it('answers internal when the composition mounts no context-removal service', async () => {
    const ctx = await composed(false)
    const source = liveAgent(ctx, 'session-remove-none', 1)

    const response = await remote(ctx).removeTurns({ sessionId: source.id, turns: [1] })
    expect(response.ok).toBe(false)
    if (!response.ok) {
      expect(response.error.code).toBe('gateway/internal')
      expect(response.error.message).toMatch(/mounts no context-removal service/)
    }
  })
})
