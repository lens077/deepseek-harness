import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type SessionEventType } from '@deepseek-ai/dsh-session'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import SessionTitleService from '@deepseek-ai/dsh-session-title'
import UserQuestionService, { type AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import * as FileLock from '@deepseek-ai/dsh-tool-call-file-lock'
import { KEEP_WAITING_LABEL, READ_NOW_LABEL } from '@deepseek-ai/dsh-tool-call-file-lock'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'

/**
 * Real-composition suite: two root agents over the production agent loop,
 * the local filesystem provider, and the shipped fs tools (without the
 * observation policy, so a foreign overwrite needs no prior read), driven by
 * scripted mock adapters. Agent A holds its turn open with a `hold` tool while
 * agent B contends for the file A modified.
 */

let dir = ''
let ctx: Context
let holds: { release: () => void }[] = []

/** A tool whose call keeps the turn open until the test releases it. */
function holdTool() {
  return defineContentToolFixture({
    name: 'hold',
    description: 'wait until released',
    parameters: {},
    async execute(_args, exec) {
      await new Promise<void>((resolve) => {
        holds.push({ release: resolve })
        exec.signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
      return [{ type: 'text', text: 'released' }]
    },
  })
}

/** A tool with a path argument and a mode that turns a write rule into a read. */
function pathedTool() {
  return defineContentToolFixture({
    name: 'pathed',
    description: 'touch a path',
    parameters: { path: { type: 'string' }, mode: { type: 'string' } },
    async execute() {
      return [{ type: 'text', text: 'touched' }]
    },
  })
}

async function harness(
  config: Partial<FileLock.Config> = {},
  options: { userQuestions?: boolean; fileLock?: boolean } = {},
): Promise<Context> {
  const context = new Context()
  await mountAgentLoopTestDependencies(context)
  await context.plugin(AgentLoop, { agents: [] })
  await context.plugin(LocalFileSystem, { cwd: dir })
  await context.plugin(ToolFs)
  if (options.userQuestions !== false) await context.plugin(UserQuestionService)
  if (options.fileLock !== false) await context.plugin(FileLock, config as FileLock.Config)
  context.tools.register(holdTool())
  context.tools.register(pathedTool())
  return context
}

function idle(agent: Agent): Promise<void> {
  return agent.whenIdle()
}

async function agentWithScript(id: string, script: ConstructorParameters<typeof MockAdapter>[0], cwd?: string): Promise<Agent> {
  const provider = `mock-${id}`
  ctx.llm.registerAdapter([provider], new MockAdapter(script))
  const agent = await ctx.agentLoop.create(SessionId(id), { provider, model: 'mock' }, cwd === undefined ? {} : { cwd })
  go(agent)
  return agent
}

function go(agent: Agent): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
}

/** A child agent owned by `parent`, with its own scripted adapter. */
async function childWithScript(parent: Agent, id: string, script: ConstructorParameters<typeof MockAdapter>[0]): Promise<Agent> {
  const provider = `mock-${id}`
  ctx.llm.registerAdapter([provider], new MockAdapter(script))
  const handle = await parent.ctx.agents.create({ sessionId: SessionId(id), parentAgent: parent, agentOptions: { provider, model: 'mock' } })
  go(handle.agent)
  return handle.agent
}

function events<T extends SessionEventType>(agent: Agent, type: T): SessionEvent<T>[] {
  return agent.session.snapshotEvents().filter((event): event is SessionEvent<T> => event.type === type)
}

function toolResults(agent: Agent): { isError: boolean; text: string }[] {
  return events(agent, 'tool/result').map((event) => {
    const [block] = event.data.message.content
    return {
      isError: block.isError === true,
      text: block.content.map(part => part.type === 'text' ? part.text : '').join(''),
    }
  })
}

function notices(agent: Agent): string[] {
  return events(agent, 'user/message')
    .filter(event => event.data.source.kind === 'plugin' && event.data.source.plugin === 'file-lock')
    .map(event => event.data.content.map(block => block.type === 'text' ? block.text : '').join(''))
}

/** Wait until agent A's `hold` call is parked and its lease is in place. */
async function untilHeld(): Promise<void> {
  while (holds.length === 0) await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
}

/** Wait until `agent` logged an event of `type`. */
async function untilEvent(agent: Agent, type: SessionEventType): Promise<void> {
  while (events(agent, type).length === 0) await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
}

function releaseHold(): void {
  for (const hold of holds.splice(0)) hold.release()
}

/** Agent A: modify `path` and then hold its turn open. */
const holderScript = (path: string) => [
  toolCallResponse('a-write', 'write', { file_path: path, content: 'from A\n' }),
  toolCallResponse('a-hold', 'hold', {}),
  textResponse('A done'),
]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-file-lock-'))
  holds = []
})

afterEach(async () => {
  releaseHold()
  await ctx.fiber.dispose()
  await rm(dir, { recursive: true, force: true })
})

describe('write lease', () => {
  it('refuses a foreign write after writeWaitMs and names the holder', async () => {
    ctx = await harness({ writeWaitMs: 50 })
    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-write', 'write', { file_path: path, content: 'from B\n' }),
      textResponse('B done'),
    ])
    await idle(b)

    const [refused] = toolResults(b).filter(result => result.isError)
    expect(refused?.text).toContain(`file lock: "${path}" is being modified by session a`)
    expect(refused?.text).toContain('Wait for that session to finish its turn')
    expect(events(b, 'file-lock/waiting')[0]?.data).toMatchObject({ path, access: 'write', holder: { session: 'a' } })
    expect(events(b, 'file-lock/settled')[0]?.data).toMatchObject({ path, access: 'write', outcome: 'refused' })
    expect(events(a, 'file-lock/acquired')[0]?.data).toEqual({ path })
    expect(ctx.sessionProjections.stateOf(a.session, 'fileLocks')).toEqual({ held: [path], waiting: null })

    releaseHold()
    await idle(a)
    expect(ctx.sessionProjections.stateOf(a.session, 'fileLocks')).toEqual({ held: [], waiting: null })
  })

  it('grants a queued foreign write when the holder turn ends', async () => {
    ctx = await harness({ writeWaitMs: 5000 })
    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-write', 'write', { file_path: path, content: 'from B\n' }),
      textResponse('B done'),
    ])
    await untilEvent(b, 'file-lock/waiting')
    expect(ctx.sessionProjections.stateOf(b.session, 'fileLocks')?.waiting).toMatchObject({ path, access: 'write', phase: 'waiting' })
    releaseHold()
    await idle(a)
    await idle(b)
    expect(toolResults(b).every(result => !result.isError)).toBe(true)
    expect(events(b, 'file-lock/settled')[0]?.data).toMatchObject({ outcome: 'released', access: 'write' })
    expect(events(b, 'file-lock/acquired')[0]?.data).toMatchObject({ path })
  })

  it('does not touch tools outside the rules or calls of the same session', async () => {
    ctx = await harness({ writeWaitMs: 50 })
    const path = join(dir, 'own.txt')
    const a = await agentWithScript('a', [
      toolCallResponse('a-write', 'write', { file_path: path, content: 'one\n' }),
      toolCallResponse('a-read', 'read', { file_path: path }),
      toolCallResponse('a-edit', 'edit', { file_path: path, old_string: 'one', new_string: 'two' }),
      textResponse('A done'),
    ])
    await idle(a)
    expect(toolResults(a).every(result => !result.isError)).toBe(true)
    expect(events(a, 'file-lock/waiting')).toHaveLength(0)
    expect(events(a, 'file-lock/acquired')).toHaveLength(1)
    expect(notices(a)).toHaveLength(0)
  })
})

describe('foreign read', () => {
  it('resumes a read within readWaitMs when the lease is released and notes the wait', async () => {
    ctx = await harness({ readWaitMs: 5000 })
    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-read', 'read', { file_path: path }),
      textResponse('B done'),
    ])
    await untilEvent(b, 'file-lock/waiting')
    releaseHold()
    await idle(a)
    await idle(b)
    expect(toolResults(b)[0]).toMatchObject({ isError: false })
    expect(toolResults(b)[0]?.text).toContain('from A')
    expect(notices(b)[0]).toMatch(/^\[file-lock\] waited \d+s until session a finished modifying/)
    expect(events(b, 'file-lock/settled')[0]?.data).toMatchObject({ access: 'read', outcome: 'released' })
    expect(events(b, 'file-lock/asked')).toHaveLength(0)
  })

  it('asks the user after readWaitMs; "Read now" reads immediately and is remembered for the turn', async () => {
    ctx = await harness({ readWaitMs: 20 })
    const asked: AskUserQuestionRequest[] = []
    ctx.on('user-questions/request', (request) => {
      asked.push(request)
      return Promise.resolve({ answers: [{ id: 'file-lock', selected: [READ_NOW_LABEL] }] })
    })
    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-read-1', 'read', { file_path: path }),
      toolCallResponse('b-read-2', 'read', { file_path: path }),
      textResponse('B done'),
    ])
    await idle(b)

    expect(asked).toHaveLength(1)
    expect(asked[0]?.questions[0]?.options?.map(option => option.label)).toEqual([READ_NOW_LABEL, KEEP_WAITING_LABEL])
    expect(toolResults(b).map(result => result.isError)).toEqual([false, false])
    expect(notices(b)).toHaveLength(2)
    expect(notices(b)[0]).toContain('may be incomplete or change again')
    expect(events(b, 'file-lock/asked')).toHaveLength(1)
    expect(events(b, 'file-lock/answered')[0]?.data).toEqual({ path, choice: 'read-now', by: 'user' })
    expect(events(b, 'file-lock/settled')[0]?.data).toMatchObject({ outcome: 'read-now' })
    releaseHold()
    await idle(a)
  })

  it('"Keep waiting" subscribes without a bound and reads as soon as the lease is released', async () => {
    ctx = await harness({ readWaitMs: 20 })
    ctx.on('user-questions/request', () => Promise.resolve({ answers: [{ id: 'file-lock', selected: [KEEP_WAITING_LABEL] }] }))
    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-read', 'read', { file_path: path }),
      textResponse('B done'),
    ])
    await untilEvent(b, 'file-lock/subscribed')
    expect(ctx.sessionProjections.stateOf(b.session, 'fileLocks')?.waiting?.phase).toBe('subscribed')
    releaseHold()
    await idle(a)
    await idle(b)
    expect(events(b, 'file-lock/answered')[0]?.data).toEqual({ path, choice: 'keep-waiting', by: 'user' })
    expect(events(b, 'file-lock/settled')[0]?.data).toMatchObject({ outcome: 'released' })
    expect(toolResults(b)[0]?.text).toContain('from A')
    expect(ctx.sessionProjections.stateOf(b.session, 'fileLocks')).toEqual({ held: [], waiting: null })
  })

  it('withdraws a pending question when the lease is released first', async () => {
    ctx = await harness({ readWaitMs: 20 })
    let questionSignal: AbortSignal | undefined
    ctx.on('user-questions/request', request => new Promise((_resolve, reject) => {
      questionSignal = request.signal
      request.signal?.addEventListener('abort', () => { reject(new Error('withdrawn')) }, { once: true })
    }))
    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-read', 'read', { file_path: path }),
      textResponse('B done'),
    ])
    await untilEvent(b, 'file-lock/asked')
    releaseHold()
    await idle(a)
    await idle(b)
    expect(questionSignal?.aborted).toBe(true)
    expect(events(b, 'file-lock/answered')).toHaveLength(0)
    expect(events(b, 'file-lock/settled')[0]?.data).toMatchObject({ outcome: 'released' })
    expect(toolResults(b)[0]?.text).toContain('from A')
  })

  it('applies the delegated policy when no user-questions service is mounted', async () => {
    ctx = await harness({ readWaitMs: 20, delegatedReadTimeout: 'read-now' }, { userQuestions: false })
    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-read', 'read', { file_path: path }),
      textResponse('B done'),
    ])
    await idle(b)
    expect(events(b, 'file-lock/answered')[0]?.data).toEqual({ path, choice: 'read-now', by: 'policy' })
    expect(events(b, 'file-lock/asked')).toHaveLength(0)
    expect(notices(b)[0]).toContain('may be incomplete')
    releaseHold()
    await idle(a)
  })

  it('a cancelled waiter settles as aborted', async () => {
    ctx = await harness({ readWaitMs: 5000 })
    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-read', 'read', { file_path: path }),
      textResponse('B done'),
    ])
    await untilEvent(b, 'file-lock/waiting')
    b.cancel({ kind: 'user' })
    await idle(b)
    expect(events(b, 'file-lock/settled')[0]?.data).toMatchObject({ outcome: 'aborted' })
    releaseHold()
    await idle(a)
  })
})

describe('lease lifetime', () => {
  it('releases at leaseTtlMs while the turn is still open and records the release', async () => {
    ctx = await harness({ leaseTtlMs: 40, readWaitMs: 5000 })
    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-read', 'read', { file_path: path }),
      textResponse('B done'),
    ])
    await idle(b)
    expect(events(a, 'file-lock/released')[0]?.data).toEqual({ paths: [path], reason: 'ttl' })
    expect(ctx.sessionProjections.stateOf(a.session, 'fileLocks')).toEqual({ held: [], waiting: null })
    expect(events(b, 'file-lock/settled')[0]?.data).toMatchObject({ outcome: 'released' })
    releaseHold()
    await idle(a)
  })

  it('disposing the plugin removes its wrapper, projection, and leases', async () => {
    ctx = await harness({}, { fileLock: false })
    const fiber = await ctx.plugin(FileLock, { writeWaitMs: 50 } as FileLock.Config)
    expect(ctx.sessionProjections.stateOf(await (async () => {
      const probe = await ctx.agentLoop.create(SessionId('probe'), { provider: 'none', model: 'none' })
      return probe.session
    })(), 'fileLocks')).toEqual({ held: [], waiting: null })
    await fiber.dispose()

    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-write', 'write', { file_path: path, content: 'from B\n' }),
      textResponse('B done'),
    ])
    await idle(b)
    expect(toolResults(b).every(result => !result.isError)).toBe(true)
    expect(events(b, 'file-lock/waiting')).toHaveLength(0)
    expect(events(a, 'file-lock/acquired')).toHaveLength(0)
    releaseHold()
    await idle(a)
  })
})

describe('tool rules', () => {
  const rule = { tool: 'pathed', pathArgument: 'path', access: 'write' as const, readWhenArgument: 'mode', readWhenValues: ['view'] }

  it('reads under the readWhen values, writes otherwise, and skips calls without a string path', async () => {
    ctx = await harness({ writeWaitMs: 30, readWaitMs: 5000, tools: [...FileLock.DEFAULT_TOOL_RULES, rule] })
    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-1', 'pathed', { path, mode: 'other' }),
      toolCallResponse('b-2', 'pathed', { path, mode: 7 }),
      toolCallResponse('b-3', 'pathed', { mode: 'view' }),
      toolCallResponse('b-4', 'pathed', { path, mode: 'view' }),
      textResponse('B done'),
    ])
    while (events(b, 'file-lock/waiting').length < 3) await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    expect(events(b, 'file-lock/settled').map(event => event.data.outcome)).toEqual(['refused', 'refused'])
    expect(events(b, 'file-lock/waiting').at(-1)?.data.access).toBe('read')
    releaseHold()
    await idle(a)
    await idle(b)
    expect(toolResults(b).map(result => result.isError)).toEqual([true, true, false, false])
    expect(events(b, 'file-lock/settled').map(event => event.data.outcome)).toEqual(['refused', 'refused', 'released'])
  })
})

describe('holder identity', () => {
  it('names the holder by title and workspace when both exist', async () => {
    ctx = await harness({ writeWaitMs: 30 })
    await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 40 })
    const path = join(dir, 'shared.txt')
    const untitled = join(dir, 'untitled.txt')
    const a = await agentWithScript('a', holderScript(path), dir)
    ctx.sessionTitle.rename(a.session, 'Alpha work')
    const c = await agentWithScript('c', holderScript(untitled))
    while (holds.length < 2) await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    const b = await agentWithScript('b', [
      toolCallResponse('b-write', 'write', { file_path: path, content: 'from B\n' }),
      toolCallResponse('b-write-2', 'write', { file_path: untitled, content: 'from B\n' }),
      textResponse('B done'),
    ])
    await idle(b)
    expect(toolResults(b)[0]?.text).toContain(`is being modified by session "Alpha work" (workspace ${dir})`)
    expect(toolResults(b)[1]?.text).toContain('is being modified by session "go" since')
    expect(events(b, 'file-lock/waiting')[0]?.data.holder).toEqual({ session: 'a', cwd: dir, title: 'Alpha work' })
    releaseHold()
    await idle(a)
    await idle(c)
  })

  it('shares a lease across a runtime family and applies the delegated policy to an owned child', async () => {
    ctx = await harness({ readWaitMs: 20 })
    const asked: AskUserQuestionRequest[] = []
    ctx.on('user-questions/request', (request) => {
      asked.push(request)
      return Promise.resolve({ answers: [{ id: 'file-lock', selected: [READ_NOW_LABEL] }] })
    })
    const own = join(dir, 'own.txt')
    const foreign = join(dir, 'foreign.txt')
    const a = await agentWithScript('a', holderScript(own))
    await untilHeld()
    const b = await agentWithScript('b', holderScript(foreign))
    while (holds.length < 2) await new Promise<void>((resolve) => { setTimeout(resolve, 5) })
    const child = await childWithScript(a, 'a-child', [
      toolCallResponse('c-write', 'write', { file_path: own, content: 'from child\n' }),
      toolCallResponse('c-read', 'read', { file_path: foreign }),
      textResponse('child done'),
    ])
    await untilEvent(child, 'file-lock/subscribed')
    expect(events(child, 'file-lock/waiting').map(event => event.data.path)).toEqual([foreign])
    expect(events(child, 'file-lock/answered')[0]?.data).toEqual({ path: foreign, choice: 'keep-waiting', by: 'policy' })
    expect(asked).toHaveLength(0)
    releaseHold()
    await idle(a)
    await idle(b)
    await idle(child)
    expect(toolResults(child).map(result => result.isError)).toEqual([false, false])
  })

  it('releases every lease of an agent disposed mid-turn', async () => {
    ctx = await harness({ writeWaitMs: 5000 })
    const path = join(dir, 'shared.txt')
    ctx.llm.registerAdapter(['mock-a'], new MockAdapter(holderScript(path)))
    const handle = await ctx.agents.create({ sessionId: SessionId('a'), agentOptions: { provider: 'mock-a', model: 'mock' } })
    go(handle.agent)
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-write', 'write', { file_path: path, content: 'from B\n' }),
      textResponse('B done'),
    ])
    await untilEvent(b, 'file-lock/waiting')
    await handle.dispose()
    await idle(b)
    expect(events(b, 'file-lock/settled')[0]?.data).toMatchObject({ outcome: 'released' })
  })
})

describe('cancellation', () => {
  it('a cancelled queued write settles as aborted', async () => {
    ctx = await harness({ writeWaitMs: 5000 })
    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-write', 'write', { file_path: path, content: 'from B\n' }),
      textResponse('B done'),
    ])
    await untilEvent(b, 'file-lock/waiting')
    b.cancel({ kind: 'user' })
    await idle(b)
    expect(events(b, 'file-lock/settled')[0]?.data).toMatchObject({ access: 'write', outcome: 'aborted' })
    releaseHold()
    await idle(a)
  })

  it('a cancelled pending question settles as aborted', async () => {
    ctx = await harness({ readWaitMs: 20 })
    ctx.on('user-questions/request', request => new Promise((_resolve, reject) => {
      request.signal?.addEventListener('abort', () => { reject(new Error('withdrawn')) }, { once: true })
    }))
    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-read', 'read', { file_path: path }),
      textResponse('B done'),
    ])
    await untilEvent(b, 'file-lock/asked')
    b.cancel({ kind: 'user' })
    await idle(b)
    expect(events(b, 'file-lock/settled')[0]?.data).toMatchObject({ outcome: 'aborted' })
    expect(events(b, 'file-lock/answered')).toHaveLength(0)
    releaseHold()
    await idle(a)
  })

  it('a cancelled subscription settles as aborted', async () => {
    ctx = await harness({ readWaitMs: 20 })
    ctx.on('user-questions/request', () => Promise.resolve({ answers: [{ id: 'file-lock', selected: [KEEP_WAITING_LABEL] }] }))
    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-read', 'read', { file_path: path }),
      textResponse('B done'),
    ])
    await untilEvent(b, 'file-lock/subscribed')
    b.cancel({ kind: 'user' })
    await idle(b)
    expect(events(b, 'file-lock/settled')[0]?.data).toMatchObject({ outcome: 'aborted' })
    releaseHold()
    await idle(a)
  })

  it('a question no answerer can serve falls to the delegated policy', async () => {
    ctx = await harness({ readWaitMs: 20, delegatedReadTimeout: 'read-now' })
    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-read', 'read', { file_path: path }),
      textResponse('B done'),
    ])
    await idle(b)
    expect(events(b, 'file-lock/asked')).toHaveLength(1)
    expect(events(b, 'file-lock/answered')[0]?.data).toEqual({ path, choice: 'read-now', by: 'policy' })
    releaseHold()
    await idle(a)
  })
})

describe('settings', () => {
  it('reads the user section over the composition entry', async () => {
    ctx = await harness({}, { fileLock: false })
    await ctx.plugin(MemorySettings, { doc: { 'file-lock': { writeWaitMs: 30 } } })
    await ctx.plugin(FileLock, { writeWaitMs: 5000 } as FileLock.Config)
    expect(ctx.settings.describe().find(entry => entry.ns === 'file-lock')?.value).toMatchObject({ writeWaitMs: 30, readWaitMs: 30_000 })
    const path = join(dir, 'shared.txt')
    const a = await agentWithScript('a', holderScript(path))
    await untilHeld()
    const b = await agentWithScript('b', [
      toolCallResponse('b-write', 'write', { file_path: path, content: 'from B\n' }),
      textResponse('B done'),
    ])
    await idle(b)
    expect(events(b, 'file-lock/settled')[0]?.data).toMatchObject({ outcome: 'refused' })
    releaseHold()
    await idle(a)
  })
})
