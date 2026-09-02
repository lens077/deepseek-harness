import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory, AgentStatus } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionHeader } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import type { RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { GoalId } from '@deepseek-ai/dsh-goal'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

let nextRpc = 1

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`delete-${String(nextRpc++)}`), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

function stubAgent(session: Session, status: AgentStatus = 'idle'): Agent {
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status,
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/**
 * Compose the API over real Session, Agent, Storage, Domain, and Workspace
 * services, with a persistence fake holding one cold session that only
 * `agents.resume` can bring online — the production shape this regression is
 * about.
 */
async function harness(cold: (root: string) => SessionHeader[]) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-delete-')))
  const coldSessions = cold(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)

  const stored = new Map(coldSessions.map(header => [header.id, header]))
  const deleted: SessionId[] = []
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve([...stored.values()]),
    inspect: (id: SessionId) => {
      const meta = stored.get(id)
      if (meta === undefined) throw new Error(`no such stored session ${id}`)
      return Promise.resolve({ meta, events: [] })
    },
    delete: (id: SessionId) => {
      stored.delete(id)
      deleted.push(id)
      return Promise.resolve()
    },
    locate: () => undefined,
  } as never)
  await ctx.plugin(WorkspaceRegistry)

  // Session and Agent are entered and released as one lifecycle, like the real
  // factory: retirement must leave BOTH registries, because the cascade
  // re-checks `ctx.sessions` after the caller's retire capability returns.
  const publish = (session: Session) => {
    const detachSession = ctx.sessions.enter(session)
    ctx.sessions.announce(session)
    const agent = stubAgent(session)
    const detachAgent = ctx.agents.register(agent)
    return {
      agent,
      dispose: () => {
        detachAgent()
        detachSession()
        return Promise.resolve()
      },
    }
  }

  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      return publish(ctx.sessions.prepare(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      ))
    },
    // The cold path under test: a generic verb resumes a persisted identity.
    async resume(_ownerCtx, options) {
      const meta = stored.get(options.resumeSessionId)
      if (meta === undefined) throw new Error(`no such stored session ${options.resumeSessionId}`)
      return publish(ctx.sessions.prepare(options.resumeSessionId, { meta }))
    },
  }
  ctx.agents.setFactory(factory)
  ctx.provide('directoryPicker', { capability: () => ({ kind: 'native', pick: async () => null }) } as never)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: root,
  })
  return { api, ctx, deleted, root }
}

function coldHeader(id: string, cwd: string): SessionHeader {
  return { id: SessionId(id), createdAt: 1, cwd } as SessionHeader
}

describe('session.delete over an implicitly resumed session', () => {
  it('deletes an idle session that a generic read brought online', async () => {
    const { api, ctx, deleted } = await harness(root => [coldHeader('session-cold', root)])
    const sessionId = SessionId('session-cold')

    // A generic verb resolves the identity through the shared resolver, which
    // resumes the cold session. Before the fix this lifecycle was live but
    // unowned, so deletion could never retire it. The verb's own outcome is
    // irrelevant here — the resume it performs is what this covers.
    await api.goals.clear(request({ sessionId, ref: { id: GoalId('goal-none'), revision: 1 } }))
    expect(ctx.agents.get(sessionId)).toBeDefined()

    const response = await api.sessions.delete(request({ sessionId }))
    expect(expectOk(response).deletedSessionIds).toEqual([sessionId])
    expect(ctx.agents.get(sessionId)).toBeUndefined()
    expect(ctx.sessions.get(sessionId)).toBeUndefined()
    expect(deleted).toEqual([sessionId])
  })

  it('still refuses to delete a running session', async () => {
    const { api, ctx } = await harness(root => [coldHeader('session-busy', root)])
    const sessionId = SessionId('session-busy')
    await api.goals.clear(request({ sessionId, ref: { id: GoalId('goal-none'), revision: 1 } }))

    const agent = ctx.agents.get(sessionId)
    if (agent === undefined) throw new Error('expected a resumed agent')
    ;(agent as { status: AgentStatus }).status = 'running'

    const response = await api.sessions.delete(request({ sessionId }))
    expect(response.result).toMatchObject({ ok: false, error: { code: 'agent-busy' } })
    expect(ctx.sessions.get(sessionId)).toBeDefined()
  })
})
