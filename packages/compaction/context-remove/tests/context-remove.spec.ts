import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import * as CompactionInvariant from '@deepseek-ai/dsh-compaction/invariant'
import { isContextRemovalSource } from '@deepseek-ai/dsh-compaction'
import {
  createAssistantMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
  LlmAdapter,
  ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { LlmResolvedModelInfo, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { Agent } from '@deepseek-ai/dsh-agent'
import ContextRemovalExecutor, { ContextRemovalError } from '@deepseek-ai/dsh-context-remove'
import type { ContextRemovalAgentContext } from '@deepseek-ai/dsh-context-remove'

const MODEL = 'mock'
const SIGNAL = new AbortController().signal

/** One text answer per request. */
class TextAdapter extends LlmAdapter {
  readonly requests: Message[][] = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: 100_000 },
    })
  }

  override async * stream(options: { messages: readonly Message[] }): AsyncIterable<StreamChunk> {
    this.requests.push([...options.messages])
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'answer' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Text of every derived model-visible message, in request order. */
function derivedText(session: Session): string[] {
  return session.deriveMessages().map(message => message.content
    .map(block => block.type === 'text' ? block.text : '')
    .join(''))
}

interface TurnOptions {
  /** Append a tool call/result pair inside the turn. */
  readonly tool?: boolean
  /** Append a tool call the turn never answers, then abort the turn. */
  readonly danglingTool?: boolean
  /** Append a usage-only empty assistant message before the answer. */
  readonly emptyAssistant?: boolean
  /** Leave the turn open (no `turn/end`). */
  readonly open?: boolean
}

/** Append one complete conversational turn to a detached session. */
function appendTurn(session: Session, turn: number, options: TurnOptions = {}): void {
  session.append('turn/start', { turn })
  if (turn === 1) {
    session.append('system/message', {
      turn, step: 1, message: createSystemMessage('You are helpful.', 'test'),
    }, { surfaceOp: 'append' })
  }
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `question ${turn}` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn, step: 1 })
  if (options.danglingTool === true) {
    const callId = ToolCallId(`dangling-${turn}`)
    session.append('assistant/message', {
      stream: [],
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'tool-call', id: callId, name: 'bash', arguments: '{}' }],
        source: { provider: MODEL, model: MODEL },
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/call', { turn, step: 1, callId, name: 'bash', arguments: '{}' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'aborted', reason: { kind: 'legacy' } } })
    return
  }
  if (options.emptyAssistant === true) {
    session.append('assistant/message', {
      stream: [],
      turn,
      step: 1,
      message: createAssistantMessage({ content: [], source: { provider: MODEL, model: MODEL } }),
      usage: { inputTokens: 1, outputTokens: 0 },
    }, { surfaceOp: 'append' })
  }
  if (options.tool === true) {
    const callId = ToolCallId(`call-${turn}`)
    session.append('assistant/message', {
      stream: [],
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'tool-call', id: callId, name: 'bash', arguments: '{}' }],
        source: { provider: MODEL, model: MODEL },
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/call', { turn, step: 1, callId, name: 'bash', arguments: '{}' })
    session.append('tool/result', {
      turn,
      step: 1,
      message: createToolResultMessage({ callId, content: [{ type: 'text', text: `result ${turn}` }], isError: false }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('step/start', { turn, step: 2 })
  }
  session.append('assistant/message', {
    stream: [],
    turn,
    step: options.tool === true ? 2 : 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: `answer ${turn}` }],
      source: { provider: MODEL, model: MODEL },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: options.tool === true ? 2 : 1 })
  if (options.open !== true) session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

/** A detached session with `turns` completed conversational turns. */
function conversation(turns: number, options: (turn: number) => TurnOptions = () => ({})): Session {
  const session = Session.create(SessionId(`conversation-${turns}`))
  for (let turn = 1; turn <= turns; turn += 1) appendTurn(session, turn, options(turn))
  return session
}

/** A fake idle agent whose maintenance claim is scripted per test. */
function fakeAgent(
  session: Session,
  busy = false,
  maintenanceSignal = new AbortController().signal,
): ContextRemovalAgentContext {
  return {
    session,
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (busy) throw new Error('agent already has active work')
      return task(maintenanceSignal)
    },
  }
}

/** Service over a store-detached session. */
function detachedService(): { ctx: Context; executor: ContextRemovalExecutor; flushes: () => number } {
  const ctx = new Context()
  void new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  void new TokenMeter(ctx)
  let flushes = 0
  vi.spyOn(ctx.sessions, 'flush').mockImplementation(() => {
    flushes += 1
    return Promise.resolve(false)
  })
  return { ctx, executor: new ContextRemovalExecutor(ctx), flushes: () => flushes }
}

/** Await one classified rejection. */
async function rejection(operation: Promise<unknown>): Promise<ContextRemovalError> {
  let caught: unknown
  try {
    const value = await operation
    throw new Error(`expected a rejection, resolved with ${String(value)}`)
  } catch (error: unknown) {
    caught = error
  }
  if (!(caught instanceof ContextRemovalError)) {
    throw new Error(`expected a ContextRemovalError, got ${String(caught)}`)
  }
  return caught
}

function checkpoints(session: Session): SessionEvent<'user/message'>[] {
  return session.snapshotEvents().filter((event): event is SessionEvent<'user/message'> =>
    event.type === 'user/message' && isContextRemovalSource(event.data.source))
}

describe('ContextRemovalExecutor.removeTurns over a detached session', () => {
  it('replaces one completed turn with an empty checkpoint that projects to no message', async () => {
    const { executor, flushes } = detachedService()
    const session = conversation(3)
    expect(derivedText(session)).toEqual([
      'You are helpful.', 'question 1', 'answer 1', 'question 2', 'answer 2', 'question 3', 'answer 3',
    ])

    const result = await executor.removeTurns(fakeAgent(session), [2], SIGNAL)

    expect(result.turns).toEqual([2])
    expect(result.groups).toHaveLength(1)
    expect(derivedText(session)).toEqual([
      'You are helpful.', 'question 1', 'answer 1', 'question 3', 'answer 3',
    ])
    const [checkpoint] = checkpoints(session)
    expect(checkpoint?.data.content).toEqual([])
    expect(checkpoint?.data.source).toMatchObject({
      kind: 'plugin', plugin: 'context-remove', removalId: result.removalId, turns: [2],
    })
    const group = result.groups[0]
    expect(checkpoint?.seq).toBe(group?.checkpointSeq)
    // The shadow-price event is immediately adjacent and prices the exact span.
    const prune = session.eventAt(group?.pruneSeq ?? SessionSeq(0))
    expect(prune?.type).toBe('compaction/prune')
    expect(prune?.seq).toBe((checkpoint?.seq ?? 0) - 1)
    expect(group?.shadowedTokenCount).toBeGreaterThan(0)
    if (prune?.type === 'compaction/prune') {
      expect(prune.data.shadowedSeqs).toEqual(group?.shadowedSeqs)
      expect(prune.data.shadowedTokenCount).toBe(group?.shadowedTokenCount)
    }
    // The question seq is named so a transcript can mark the removed row.
    const promptSeq = session.snapshotEvents().find(event =>
      event.type === 'user/message' && event.data.content.some(block => block.type === 'text' && block.text === 'question 2'))?.seq
    expect(checkpoint?.data.source).toMatchObject({ promptSeqs: [promptSeq] })
    // The removed events remain in the append-only log and are cited.
    expect(checkpoint?.sourceEventSeqs).toEqual([group?.pruneSeq, ...group?.shadowedSeqs ?? []])
    expect(flushes()).toBe(1)
  })

  it('keeps the first system-prompt node when removing the first turn', async () => {
    const { executor } = detachedService()
    const session = conversation(2)

    await executor.removeTurns(fakeAgent(session), [1], SIGNAL)

    expect(derivedText(session)).toEqual(['You are helpful.', 'question 2', 'answer 2'])
  })

  it('merges surface-adjacent turns into one replacement and lands separate groups otherwise', async () => {
    const { executor } = detachedService()
    const session = conversation(5)

    const result = await executor.removeTurns(fakeAgent(session), [4, 1, 2], SIGNAL)

    expect(result.turns).toEqual([1, 2, 4])
    expect(result.groups.map(group => group.turns)).toEqual([[1, 2], [4]])
    expect(derivedText(session)).toEqual([
      'You are helpful.', 'question 3', 'answer 3', 'question 5', 'answer 5',
    ])
    expect(checkpoints(session)).toHaveLength(2)
    expect(session.snapshotEvents().filter(event => event.type === 'compaction/prune')).toHaveLength(2)
  })

  it('removes a turn together with its tool call and result', async () => {
    const { executor } = detachedService()
    const session = conversation(2, turn => ({ tool: turn === 1 }))

    await executor.removeTurns(fakeAgent(session), [1], SIGNAL)

    expect(derivedText(session)).toEqual(['You are helpful.', 'question 2', 'answer 2'])
  })

  it('removes a turn whose tool result was pruned by citing the replacement', async () => {
    const { executor } = detachedService()
    const session = conversation(2, turn => ({ tool: turn === 1 }))
    const original = session.snapshotEvents().find(event => event.type === 'tool/result')
    if (original?.type !== 'tool/result') throw new Error('expected a tool result')
    session.append('compaction/prune', {
      shadowedRange: { start: original.seq, end: original.seq },
      shadowedSeqs: [original.seq],
      shadowedTokenCount: 1,
    })
    session.append('tool/result', {
      ...original.data,
      message: {
        ...original.data.message,
        content: [{ ...original.data.message.content[0], content: [{ type: 'text', text: 'pruned' }] }],
      },
    }, { surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq }, sourceEventSeqs: [original.seq] })
    expect(JSON.stringify(session.deriveMessages())).toContain('pruned')

    await executor.removeTurns(fakeAgent(session), [1], SIGNAL)

    expect(derivedText(session)).toEqual(['You are helpful.', 'question 2', 'answer 2'])
  })

  it('rejects an unknown, open, or already-removed turn as unavailable without writing', async () => {
    const { executor, flushes } = detachedService()
    const session = conversation(2)
    const unknown = await rejection(executor.removeTurns(fakeAgent(session), [1, 9], SIGNAL))
    expect(unknown.code).toBe('unavailable')
    expect(unknown.turn).toBe(9)

    appendTurn(session, 3, { open: true })
    const before = session.seq
    // Turn 3 is durably open, so the log is busy for every request.
    const open = await rejection(executor.removeTurns(fakeAgent(session), [3], SIGNAL))
    expect(open.code).toBe('busy')
    expect(session.seq).toBe(before)
    expect(flushes()).toBe(0)

    session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
    await executor.removeTurns(fakeAgent(session), [1], SIGNAL)
    const again = await rejection(executor.removeTurns(fakeAgent(session), [1], SIGNAL))
    expect(again.code).toBe('unavailable')
    expect(again.message).toContain('already absent')
  })

  it('rejects a turn whose span shares a compaction summary with other history', async () => {
    const { executor } = detachedService()
    const session = conversation(3)
    const nodes = session.surface.nodes
    // Shadow turns 1 and 2 (surface nodes 1..4) with one summary node.
    const start = nodes[1]
    const end = nodes[4]
    if (start === undefined || end === undefined) throw new Error('expected surface nodes')
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'summary' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), { surfaceOp: { op: 'replace', startSeq: start, endSeq: end }, sourceEventSeqs: nodes.slice(1, 5) })

    const error = await rejection(executor.removeTurns(fakeAgent(session), [2], SIGNAL))
    expect(error.code).toBe('unavailable')
    expect(error.message).toContain('compaction summary')
    // Turn 3 is untouched and still removable.
    await executor.removeTurns(fakeAgent(session), [3], SIGNAL)
    expect(derivedText(session)).toEqual(['You are helpful.', 'summary'])
  })

  it('prices a usage-only empty assistant node at zero inside a removed span', async () => {
    const { executor } = detachedService()
    const session = conversation(2, turn => ({ emptyAssistant: turn === 1 }))
    const plain = conversation(2)

    const withEmpty = await executor.removeTurns(fakeAgent(session), [1], SIGNAL)
    const withoutEmpty = await executor.removeTurns(fakeAgent(plain), [1], SIGNAL)

    expect(withEmpty.groups[0]?.shadowedSeqs.length).toBe((withoutEmpty.groups[0]?.shadowedSeqs.length ?? 0) + 1)
    expect(withEmpty.groups[0]?.shadowedTokenCount).toBe(withoutEmpty.groups[0]?.shadowedTokenCount)
  })

  it('rejects a turn whose unanswered tool call would be split from its result position', async () => {
    const { executor } = detachedService()
    const session = conversation(2, turn => ({ danglingTool: turn === 1 }))

    const error = await rejection(executor.removeTurns(fakeAgent(session), [1], SIGNAL))
    expect(error.code).toBe('unavailable')
    expect(error.message).toContain('balanced')
  })

  it('treats markers before a seed boundary as an earlier lifecycle', async () => {
    const { executor } = detachedService()
    const session = conversation(2)
    session.append('compaction/start', { compactionId: 'stale' as never, turn: null })
    appendTurn(session, 3, { open: true })
    session.append('session/end-seed', {})

    // Neither the stale bracket nor the unterminated turn blocks the log …
    await executor.removeTurns(fakeAgent(session), [1], SIGNAL)
    expect(derivedText(session)).toEqual(['You are helpful.', 'question 2', 'answer 2', 'question 3', 'answer 3'])
    // … but the unterminated turn itself is not a completed turn.
    const error = await rejection(executor.removeTurns(fakeAgent(session), [3], SIGNAL))
    expect(error.code).toBe('unavailable')
    expect(error.message).toContain('not completed')
  })

  it('rejects an empty request, a busy agent, and an open compaction bracket', async () => {
    const { executor } = detachedService()
    const session = conversation(2)

    expect((await rejection(executor.removeTurns(fakeAgent(session), [], SIGNAL))).code).toBe('unavailable')
    expect((await rejection(executor.removeTurns(fakeAgent(session, true), [1], SIGNAL))).code).toBe('busy')
    session.append('compaction/start', { compactionId: 'c1' as never, turn: null })
    expect((await rejection(executor.removeTurns(fakeAgent(session), [1], SIGNAL))).code).toBe('busy')
    session.append('compaction/end', { compactionId: 'c1' as never, turn: null, error: 'abandoned' })
    await executor.removeTurns(fakeAgent(session), [1], SIGNAL)
    expect(derivedText(session)).toEqual(['You are helpful.', 'question 2', 'answer 2'])
  })

  it('propagates an already-aborted caller signal before claiming the agent', async () => {
    const { executor } = detachedService()
    const session = conversation(1)
    const controller = new AbortController()
    controller.abort(new Error('caller gone'))
    await expect(executor.removeTurns(fakeAgent(session), [1], controller.signal)).rejects.toThrow('caller gone')
  })

  it('classifies an agent cancellation and a failed durability checkpoint', async () => {
    const { ctx, executor } = detachedService()
    const session = conversation(2)
    const cancelled = new AbortController()
    cancelled.abort(new Error('agent cancel'))
    const cancel = await rejection(executor.removeTurns(fakeAgent(session, false, cancelled.signal), [1], SIGNAL))
    expect(cancel.code).toBe('cancelled')
    expect(checkpoints(session)).toHaveLength(0)

    vi.spyOn(ctx.sessions, 'flush').mockRejectedValue(new Error('disk full'))
    const persistence = await rejection(executor.removeTurns(fakeAgent(session), [1], SIGNAL))
    expect(persistence.code).toBe('persistence')
    // The replacement landed before the checkpoint failed.
    expect(checkpoints(session)).toHaveLength(1)
  })
})

describe('ContextRemovalExecutor through the real loop', () => {
  async function loopHarness(): Promise<{ ctx: Context; agent: Agent; adapter: TextAdapter }> {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(SessionInvariant)
    await ctx.plugin(AgentInvariant)
    await ctx.plugin(AgentLoopInvariant)
    await ctx.plugin(CompactionInvariant)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TokenMeter)
    await ctx.plugin(ContextRemovalExecutor)
    const adapter = new TextAdapter()
    ctx.llm.registerAdapter([MODEL], adapter)
    const agent = await ctx.agentLoop.create(SessionId('context-remove-loop'), { provider: MODEL, model: MODEL })
    return { ctx, agent, adapter }
  }

  async function ask(agent: Agent, text: string): Promise<void> {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }

  it('drops the removed turn from the next model request and keeps the log replayable', async () => {
    const { ctx, agent, adapter } = await loopHarness()
    await ask(agent, 'first question')
    await ask(agent, 'second question')
    await ask(agent, 'third question')
    const turns = agent.session.snapshotEvents()
      .filter(event => event.type === 'turn/end')
      .map(event => event.type === 'turn/end' ? event.data.turn : 0)
    expect(turns).toHaveLength(3)

    const result = await ctx.contextRemoval.removeTurns(agent, [turns[1] ?? 0], SIGNAL)
    expect(result.turns).toEqual([turns[1]])
    await ask(agent, 'fourth question')

    const texts = (adapter.requests.at(-1) ?? []).map(message => message.content
      .map(block => block.type === 'text' ? block.text : '')
      .join(''))
    expect(texts).toContain('first question')
    expect(texts).toContain('third question')
    expect(texts).toContain('fourth question')
    expect(texts.some(text => text.includes('second question'))).toBe(false)
    // Invariant companions accepted every appended event, and a fresh fold of
    // the persisted log reproduces the same model-visible history.
    const replay = Session.create(SessionId('replay'), agent.session.snapshotEvents())
    expect(derivedText(replay)).toEqual(derivedText(agent.session))
  })

  it('refuses while a turn is running', async () => {
    const { ctx, agent } = await loopHarness()
    await ask(agent, 'first question')
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
    const error = await rejection(ctx.contextRemoval.removeTurns(agent, [1], SIGNAL))
    expect(error.code).toBe('busy')
    await agent.whenIdle()
  })
})
