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
const STRONG: AgentModelSelection = { provider: 'fixture', model: 'strong-model' }
const VISION: AgentModelSelection = { provider: 'other', model: 'vision-model' }

class ScriptedRouter extends ModelRouter {
  answer: (input: ModelRouteInput) => Promise<ModelRouteDecision> = input =>
    Promise.resolve({ selection: input.baseline, reason: 'no rule matched' })

  route(input: ModelRouteInput): Promise<ModelRouteDecision> {
    return this.answer(input)
  }
}

interface Catalog {
  readonly providers: readonly string[]
  readonly models: Record<string, readonly string[] | Error>
  readonly info: Record<string, { inputModalities?: string[]; context?: { contextWindow: number } }>
}

const DEFAULT_CATALOG: Catalog = {
  providers: ['fixture', 'other'],
  models: { fixture: ['fixture-model', 'strong-model'], other: ['vision-model'] },
  info: {
    'fixture/fixture-model': {},
    'fixture/strong-model': { inputModalities: ['text'], context: { contextWindow: 1000 } },
    'other/vision-model': { inputModalities: ['text', 'image'] },
  },
}

interface HarnessOptions {
  readonly mountRouter?: boolean
  readonly catalog?: Catalog
  readonly measuredTokens?: number
  /** Selection the Agent currently carries; the baseline stays fixed. */
  readonly current?: AgentModelSelection
}

async function routingHarness(options: HarnessOptions = {}): Promise<{
  ctx: Context
  controller: SessionCommandController
  agent: Agent
  router: ScriptedRouter | undefined
  followup: ReturnType<typeof vi.fn>
  routeForNextRequest: ReturnType<typeof vi.fn>
  resolveCallConfig: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
}> {
  const catalog = options.catalog ?? DEFAULT_CATALOG
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
    listProviders: () => catalog.providers.map(id => ({ id, name: id })),
    listModels: (provider: string) => {
      const models = catalog.models[provider]
      return models instanceof Error ? Promise.reject(models) : Promise.resolve(models!.map(id => ({ id, name: id })))
    },
    resolveCallConfig,
    resolveModelInfo: (provider: string, model: string) => {
      const info = catalog.info[`${provider}/${model}`]
      return info === undefined
        ? Promise.reject(new LlmError(`unknown model ${provider}/${model}`, 'NO_ADAPTER'))
        : Promise.resolve({ provider, id: model, name: model, ...info })
    },
  } as never)
  if (options.measuredTokens !== undefined) {
    const totalTokens = options.measuredTokens
    ctx.provide('tokenMeter', { measure: () => ({ totalTokens }) } as never)
  }
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
    selectionFor: () => ({ current: { ...(options.current ?? BASELINE) } }),
    baselineFor: () => ({ ...BASELINE }),
    routeForNextRequest,
    serializeImageAdmission: <Value>(_agent: Agent, operation: () => Promise<Value>) => operation(),
  } as unknown as ApiSessionAgentController
  const router = options.mountRouter === false
    ? undefined
    : (await ctx.plugin(ScriptedRouter), ctx.modelRouter as ScriptedRouter)
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

function propose(selection: AgentModelSelection, rule: string): (input: ModelRouteInput) => Promise<ModelRouteDecision> {
  return () => Promise.resolve({ selection, reason: `rule "${rule}" matched`, rule })
}

describe('Session prompt model routing', () => {
  it('records nothing and applies nothing without a mounted router', async () => {
    const { controller, agent, followup, routeForNextRequest } = await routingHarness({ mountRouter: false })
    await expect(controller.prompt(prompt('hello'))).resolves.toEqual({ accepted: true })
    expect(followup).toHaveBeenCalledOnce()
    expect(routeForNextRequest).not.toHaveBeenCalled()
    expect(routeEvents(agent)).toEqual([])
  })

  it('hands the router the baseline, configured routes, and prompt, then applies a validated effort before queueing', async () => {
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
    expect(seen).toEqual([{
      baseline: BASELINE,
      candidates: [{ provider: 'fixture', model: 'fixture-model' }, STRONG, VISION],
      prompt: { text: 'hi?', hasImage: false },
    }])
    expect(resolveCallConfig).toHaveBeenCalledWith({ provider: 'fixture', model: 'fixture-model', reasoningEffort: 'low' })
    const applied = { provider: 'fixture', model: 'fixture-model', reasoningEffort: 'low' }
    expect(routeForNextRequest).toHaveBeenCalledWith(agent, applied)
    expect(routeEvents(agent)).toEqual([{ baseline: BASELINE, selection: applied, reason: 'rule "short" matched', rule: 'short' }])
    expect(routeForNextRequest.mock.invocationCallOrder[0]).toBeLessThan(followup.mock.invocationCallOrder[0]!)
    await controller.prompt({ ...prompt('look', true), requestId: 'req-2' as SessionRequestId })
    expect(seen[1]).toMatchObject({ prompt: { text: 'look', hasImage: true } })
  })

  it('restores the baseline when no rule matches and skips validation for an unchanged effort', async () => {
    const { controller, agent, routeForNextRequest, resolveCallConfig } = await routingHarness()
    await controller.prompt(prompt('a longer sentence'))
    expect(resolveCallConfig).not.toHaveBeenCalled()
    expect(routeForNextRequest).toHaveBeenCalledWith(agent, BASELINE)
    expect(routeEvents(agent)).toEqual([{ baseline: BASELINE, selection: BASELINE, reason: 'no rule matched' }])
  })

  it('switches to a configured route, validating its effort and recording the switch', async () => {
    const { controller, agent, router, routeForNextRequest, resolveCallConfig } = await routingHarness()
    router!.answer = propose({ ...STRONG, reasoningEffort: 'max' as never }, 'hard')
    await controller.prompt(prompt('prove it'))
    expect(resolveCallConfig).toHaveBeenCalledWith({ ...STRONG, reasoningEffort: 'max' })
    expect(routeForNextRequest).toHaveBeenCalledWith(agent, { ...STRONG, reasoningEffort: 'max' })
    expect(routeEvents(agent)).toEqual([{
      baseline: BASELINE, selection: { ...STRONG, reasoningEffort: 'max' }, reason: 'rule "hard" matched', rule: 'hard',
    }])
    router!.answer = propose(STRONG, 'plain')
    resolveCallConfig.mockClear()
    await controller.prompt({ ...prompt('design'), requestId: 'req-2' as SessionRequestId })
    expect(resolveCallConfig).not.toHaveBeenCalled()
    expect(routeForNextRequest).toHaveBeenLastCalledWith(agent, STRONG)
  })

  it('degrades to the proposed effort on the baseline when fewer than two routes are configured', async () => {
    const { controller, agent, router, routeForNextRequest, resolveCallConfig } = await routingHarness({
      catalog: { providers: ['fixture'], models: { fixture: ['fixture-model'] }, info: DEFAULT_CATALOG.info },
    })
    router!.answer = propose({ ...STRONG, reasoningEffort: 'low' as never }, 'cheap')
    await controller.prompt(prompt('hi?'))
    expect(resolveCallConfig).toHaveBeenCalledWith({ provider: 'fixture', model: 'fixture-model', reasoningEffort: 'low' })
    expect(routeForNextRequest).toHaveBeenCalledWith(agent, { provider: 'fixture', model: 'fixture-model', reasoningEffort: 'low' })
    expect(routeEvents(agent)[0]?.reason).toBe(
      'rule "cheap" matched; effort only: model switching needs at least two configured routes (found 1)',
    )
  })

  it.each<[string, AgentModelSelection, HarnessOptions, boolean, string]>([
    ['an unconfigured route', { provider: 'fixture', model: 'ghost' }, {}, false, 'fixture/ghost is not a configured route'],
    ['a text-only route for an image prompt', STRONG, {}, true, 'fixture/strong-model does not declare image input'],
    ['a context window below the measured Session', STRONG, { measuredTokens: 1001 }, false,
      "fixture/strong-model context window (1000) is below the Session's 1001 measured tokens"],
  ])('refuses %s and keeps the baseline', async (_label, proposed, options, image, reason) => {
    const { controller, agent, router, routeForNextRequest } = await routingHarness(options)
    router!.answer = propose(proposed, 'switch')
    await controller.prompt(prompt('look', image))
    expect(routeForNextRequest).toHaveBeenCalledWith(agent, BASELINE)
    expect(routeEvents(agent)).toEqual([{
      baseline: BASELINE, selection: BASELINE, reason: `rule "switch" matched; effort only: ${reason}`, rule: 'switch',
    }])
  })

  it('accepts a switch when the measured Session fits and when no meter or window is known', async () => {
    const fits = await routingHarness({ measuredTokens: 1000 })
    fits.router!.answer = propose(STRONG, 'switch')
    await fits.controller.prompt(prompt('go'))
    expect(fits.routeForNextRequest).toHaveBeenCalledWith(fits.agent, STRONG)
    const unknown = await routingHarness({ measuredTokens: 5000 })
    unknown.router!.answer = propose(VISION, 'switch')
    await unknown.controller.prompt(prompt('go', true))
    expect(unknown.routeForNextRequest).toHaveBeenCalledWith(unknown.agent, VISION)
  })

  it('refuses a route whose effort the registry rejects, then still tries the effort on the baseline', async () => {
    const { controller, agent, router, routeForNextRequest, resolveCallConfig } = await routingHarness()
    router!.answer = propose({ ...STRONG, reasoningEffort: 'ultra' as never }, 'hard')
    resolveCallConfig.mockRejectedValueOnce(new LlmError('model "strong-model" does not support reasoning effort "ultra"', 'UNSUPPORTED_REASONING_EFFORT'))
    resolveCallConfig.mockRejectedValueOnce('adapter gone')
    await controller.prompt(prompt('prove it'))
    expect(routeForNextRequest).toHaveBeenCalledWith(agent, BASELINE)
    expect(routeEvents(agent)).toEqual([{
      baseline: BASELINE,
      selection: BASELINE,
      reason: 'refused: model "strong-model" does not support reasoning effort "ultra"; adapter gone',
      rule: 'hard',
    }])
    resolveCallConfig.mockRejectedValueOnce('registry gone')
    resolveCallConfig.mockRejectedValueOnce(new LlmError('model "fixture-model" does not support reasoning effort "ultra"', 'UNSUPPORTED_REASONING_EFFORT'))
    await controller.prompt({ ...prompt('prove it'), requestId: 'req-2' as SessionRequestId })
    expect(routeEvents(agent).at(-1)?.reason).toBe(
      'refused: registry gone; model "fixture-model" does not support reasoning effort "ultra"',
    )
  })

  it('ignores a provider whose catalog cannot be read', async () => {
    const { controller, router } = await routingHarness({
      catalog: {
        providers: ['fixture', 'broken'],
        models: { fixture: ['fixture-model', 'strong-model'], broken: new Error('catalog offline') },
        info: DEFAULT_CATALOG.info,
      },
    })
    const seen: ModelRouteInput[] = []
    router!.answer = (input) => {
      seen.push(input)
      return Promise.resolve({ selection: input.baseline, reason: 'no rule matched' })
    }
    await controller.prompt(prompt('hello'))
    expect(seen[0]?.candidates).toEqual([{ provider: 'fixture', model: 'fixture-model' }, STRONG])
  })

  it('does not consult a switched-off router and restores a Session left on a routed selection', async () => {
    const { controller, agent, router, routeForNextRequest } = await routingHarness()
    let asked = 0
    router!.answer = () => { asked += 1; return Promise.reject(new Error('must not be asked')) }
    router!.enabled = () => false
    await controller.prompt(prompt('hello'))
    expect(asked).toBe(0)
    expect(routeForNextRequest).not.toHaveBeenCalled()
    expect(routeEvents(agent)).toEqual([])
    const routedHarness = await routingHarness({ current: { ...STRONG, reasoningEffort: 'max' as never } })
    routedHarness.router!.enabled = () => false
    await routedHarness.controller.prompt(prompt('hello'))
    expect(routedHarness.routeForNextRequest).toHaveBeenCalledWith(routedHarness.agent, BASELINE)
    expect(routeEvents(routedHarness.agent)).toEqual([{
      baseline: BASELINE, selection: BASELINE, reason: 'routing switched off: baseline restored',
    }])
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
