import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelection as AgentModelSelection } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { ModelRouter } from '@deepseek-ai/dsh-model-router'
import type { ModelRouteDecision, ModelRouteInput } from '@deepseek-ai/dsh-model-router'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import type { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import type { SessionRequestId } from '../src/types.ts'
import { installSessionReadTestServices } from './test-remote.ts'

const SESSION = SessionId('routing-session')
const BASELINE: AgentModelSelection = { provider: 'fixture', model: 'fixture-model', reasoningEffort: 'high' as never }

class ScriptedRouter extends ModelRouter {
  answer: (input: ModelRouteInput) => Promise<ModelRouteDecision> = input =>
    Promise.resolve({ selection: input.baseline, reason: 'no rule matched' })

  route(input: ModelRouteInput): Promise<ModelRouteDecision> {
    return this.answer(input)
  }
}

async function routingHarness(mountRouter = true): Promise<{
  ctx: Context
  controller: SessionCommandController
  agent: Agent
  router: ScriptedRouter | undefined
  followup: ReturnType<typeof vi.fn>
  routeForNextRequest: ReturnType<typeof vi.fn>
  resolveCallConfig: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  const session = ctx.sessions.create(SESSION, { meta: { cwd: '/workspace' } })
  const followup = vi.fn()
  const agent = {
    id: session.id,
    session,
    inbox: createInboxStub(),
    status: 'idle',
    ctx,
    steer: vi.fn(),
    followup,
    cancel: vi.fn(),
  } as unknown as Agent
  ctx.agents.register(agent)
  const resolveCallConfig = vi.fn((config: AgentModelSelection) => Promise.resolve(config))
  ctx.provide('llm', {
    listProviders: () => [{ id: 'fixture', name: 'Fixture' }],
    resolveCallConfig,
    resolveModelInfo: () => Promise.resolve({ inputModalities: ['text', 'image'] }),
  } as never)
  ctx.provide('attachments', {
    admitPromptContent: (content: unknown) => Promise.resolve(content),
  } as never)
  ctx.provide('fileUploads', {
    resolve: () => undefined,
    bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }),
  } as never)
  const warn = vi.fn()
  ctx.logger.warn = warn as never
  const routeForNextRequest = vi.fn()
  const agents = {
    resolveAgent: () => Promise.resolve({ agent }),
    selectionFor: () => ({ current: { ...BASELINE } }),
    baselineFor: () => ({ ...BASELINE }),
    routeForNextRequest,
    serializeImageAdmission: <Value>(_agent: Agent, operation: () => Promise<Value>) => operation(),
  } as unknown as ApiSessionAgentController
  const router = mountRouter ? (await ctx.plugin(ScriptedRouter), ctx.modelRouter as ScriptedRouter) : undefined
  return {
    ctx,
    controller: new SessionCommandController(ctx, agents, '/workspace'),
    agent,
    router,
    followup,
    routeForNextRequest,
    resolveCallConfig,
    warn,
  }
}

function prompt(text: string, image = false) {
  return {
    requestId: 'req-1' as SessionRequestId,
    sessionId: SESSION,
    mode: 'queue' as const,
    content: [
      { type: 'text' as const, text },
      ...image ? [{ type: 'image' as const, mediaType: 'image/png' as const, data: 'AAAA' }] : [],
    ],
  }
}

function routeEvents(agent: Agent) {
  return agent.session.snapshotEvents().flatMap(event => event.type === 'model/route' ? [event.data] : [])
}

describe('Session prompt model routing', () => {
  it('records nothing and applies nothing without a mounted router', async () => {
    const { controller, agent, followup, routeForNextRequest } = await routingHarness(false)
    await expect(controller.prompt(prompt('hello'))).resolves.toEqual({ accepted: true })
    expect(followup).toHaveBeenCalledOnce()
    expect(routeForNextRequest).not.toHaveBeenCalled()
    expect(routeEvents(agent)).toEqual([])
  })

  it('applies a validated effort on the baseline route and records the decision before queueing', async () => {
    const { controller, agent, router, followup, routeForNextRequest, resolveCallConfig } = await routingHarness()
    const seen: ModelRouteInput[] = []
    router!.answer = (input) => {
      seen.push(input)
      return Promise.resolve({
        selection: { ...input.baseline, reasoningEffort: 'low' as never },
        reason: 'rule "short" matched',
        rule: 'short',
      })
    }
    await expect(controller.prompt(prompt('hi?'))).resolves.toEqual({ accepted: true })
    expect(seen).toEqual([{ baseline: BASELINE, prompt: { text: 'hi?', hasImage: false } }])
    expect(resolveCallConfig).toHaveBeenCalledWith({ provider: 'fixture', model: 'fixture-model', reasoningEffort: 'low' })
    const applied = { provider: 'fixture', model: 'fixture-model', reasoningEffort: 'low' }
    expect(routeForNextRequest).toHaveBeenCalledWith(agent, applied)
    expect(routeEvents(agent)).toEqual([{ baseline: BASELINE, selection: applied, reason: 'rule "short" matched', rule: 'short' }])
    expect(routeForNextRequest.mock.invocationCallOrder[0]).toBeLessThan(followup.mock.invocationCallOrder[0]!)
    await controller.prompt({ ...prompt('look', true), requestId: 'req-2' as SessionRequestId })
    expect(seen[1]).toEqual({ baseline: BASELINE, prompt: { text: 'look', hasImage: true } })
  })

  it('restores the baseline effort when no rule matches and skips validation for an unchanged effort', async () => {
    const { controller, agent, routeForNextRequest, resolveCallConfig } = await routingHarness()
    await controller.prompt(prompt('a longer sentence'))
    expect(resolveCallConfig).not.toHaveBeenCalled()
    expect(routeForNextRequest).toHaveBeenCalledWith(agent, BASELINE)
    expect(routeEvents(agent)).toEqual([{ baseline: BASELINE, selection: BASELINE, reason: 'no rule matched' }])
  })

  it('refuses a decision that changes the provider or model', async () => {
    const { controller, agent, router, routeForNextRequest } = await routingHarness()
    router!.answer = () => Promise.resolve({
      selection: { provider: 'other', model: 'other-model' }, reason: 'cheaper', rule: 'downgrade',
    })
    await controller.prompt(prompt('hi?'))
    expect(routeForNextRequest).toHaveBeenCalledWith(agent, BASELINE)
    expect(routeEvents(agent)).toEqual([{
      baseline: BASELINE,
      selection: BASELINE,
      reason: 'refused: routing may change only the reasoning effort (proposed other/other-model)',
      rule: 'downgrade',
    }])
  })

  it('refuses an effort the exact model rejects', async () => {
    const { controller, agent, router, routeForNextRequest, resolveCallConfig } = await routingHarness()
    router!.answer = input => Promise.resolve({
      selection: { ...input.baseline, reasoningEffort: 'ultra' as never }, reason: 'rule "hard" matched', rule: 'hard',
    })
    resolveCallConfig.mockRejectedValueOnce(new LlmError('model "fixture-model" does not support reasoning effort "ultra"', 'UNSUPPORTED_REASONING_EFFORT'))
    await controller.prompt(prompt('prove it'))
    expect(routeForNextRequest).toHaveBeenCalledWith(agent, BASELINE)
    expect(routeEvents(agent)).toEqual([{
      baseline: BASELINE,
      selection: BASELINE,
      reason: 'refused: model "fixture-model" does not support reasoning effort "ultra"',
      rule: 'hard',
    }])
    resolveCallConfig.mockRejectedValueOnce('adapter gone')
    await controller.prompt({ ...prompt('prove it'), requestId: 'req-2' as SessionRequestId })
    expect(routeEvents(agent).at(-1)).toMatchObject({ reason: 'refused: adapter gone' })
  })

  it('applies a decision that drops the effort so the model default governs', async () => {
    const { controller, agent, router, routeForNextRequest, resolveCallConfig } = await routingHarness()
    router!.answer = input => Promise.resolve({
      selection: { provider: input.baseline.provider, model: input.baseline.model }, reason: 'rule "default" matched', rule: 'default',
    })
    await controller.prompt(prompt('plain'))
    expect(resolveCallConfig).not.toHaveBeenCalled()
    expect(routeForNextRequest).toHaveBeenCalledWith(agent, { provider: 'fixture', model: 'fixture-model' })
    expect(routeEvents(agent)).toEqual([{
      baseline: BASELINE,
      selection: { provider: 'fixture', model: 'fixture-model' },
      reason: 'rule "default" matched',
      rule: 'default',
    }])
  })

  it('keeps the baseline, warns, and still queues the prompt when the router fails', async () => {
    const { controller, agent, router, followup, routeForNextRequest, warn } = await routingHarness()
    router!.answer = () => Promise.reject(new Error('classifier offline'))
    await expect(controller.prompt(prompt('hello'))).resolves.toEqual({ accepted: true })
    expect(followup).toHaveBeenCalledOnce()
    expect(routeForNextRequest).toHaveBeenCalledWith(agent, BASELINE)
    expect(routeEvents(agent)).toEqual([{ baseline: BASELINE, selection: BASELINE, reason: 'router failed: classifier offline' }])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('model routing failed for "routing-session": classifier offline'))
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- non-Error provider normalization is the scenario.
    router!.answer = () => Promise.reject('offline')
    await controller.prompt({ ...prompt('again'), requestId: 'req-2' as SessionRequestId })
    expect(routeEvents(agent).at(-1)).toMatchObject({ reason: 'router failed: offline' })
  })
})
