import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ModelRouter } from '../src/index.ts'
import type { ModelRouteDecision, ModelRouteInput } from '../src/index.ts'

class EchoRouter extends ModelRouter {
  route(input: ModelRouteInput): Promise<ModelRouteDecision> {
    return Promise.resolve({ selection: input.baseline, reason: 'echo' })
  }
}

describe('ModelRouter Service Definition', () => {
  it('publishes one implementation as ctx.modelRouter and disposes with its fiber', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(EchoRouter)
    expect(ctx.get('modelRouter')).toBeInstanceOf(EchoRouter)
    const baseline = { provider: 'p', model: 'm' }
    await expect(ctx.modelRouter.route({ baseline, prompt: { text: 'hi', hasImage: false } }))
      .resolves.toEqual({ selection: baseline, reason: 'echo' })
    await fiber.dispose()
    expect(ctx.get('modelRouter')).toBeUndefined()
  })
})
