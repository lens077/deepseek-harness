import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import { ModelRouter, MODEL_ROUTING_SETTINGS_NAMESPACE } from '../src/index.ts'
import type { ModelRouteDecision, ModelRouteInput } from '../src/index.ts'

class EchoRouter extends ModelRouter {
  route(input: ModelRouteInput): Promise<ModelRouteDecision> {
    return Promise.resolve({ selection: input.baseline, reason: 'echo' })
  }
}

/** Writable in-memory settings provider for the section integration. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

describe('ModelRouter Service Definition', () => {
  it('publishes one implementation as ctx.modelRouter, enabled without a settings provider, and disposes with its fiber', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(EchoRouter)
    expect(ctx.get('modelRouter')).toBeInstanceOf(EchoRouter)
    expect(ctx.modelRouter.enabled()).toBe(true)
    const baseline = { provider: 'p', model: 'm' }
    await expect(ctx.modelRouter.route({ baseline, candidates: [baseline], prompt: { text: 'hi', hasImage: false } }))
      .resolves.toEqual({ selection: baseline, reason: 'echo' })
    await fiber.dispose()
    expect(ctx.get('modelRouter')).toBeUndefined()
  })

  it('serves the model-routing settings section and reads its enabled switch per call', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings)
    const fiber = await ctx.plugin(EchoRouter)
    expect(ctx.settings.describe().some(section => section.ns === MODEL_ROUTING_SETTINGS_NAMESPACE)).toBe(true)
    expect(ctx.modelRouter.enabled()).toBe(true)
    await ctx.settings.update(MODEL_ROUTING_SETTINGS_NAMESPACE, { enabled: false })
    expect(ctx.modelRouter.enabled()).toBe(false)
    await ctx.settings.update(MODEL_ROUTING_SETTINGS_NAMESPACE, { enabled: true })
    expect(ctx.modelRouter.enabled()).toBe(true)
    await fiber.dispose()
    expect(ctx.settings.describe().some(section => section.ns === MODEL_ROUTING_SETTINGS_NAMESPACE)).toBe(false)
  })
})
