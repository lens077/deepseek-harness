import { Context } from '@deepseek-ai/cordis'
import type { ModelRouteInput } from '@deepseek-ai/dsh-model-router'
import { describe, expect, it } from 'vitest'
import { RulesModelRouter } from '../src/index.ts'
import type { Config, RuleConfig } from '../src/index.ts'

const baseline = { provider: 'deepseek-official', model: 'deepseek-v4-flash' }

async function router(rules: RuleConfig[]): Promise<RulesModelRouter> {
  const ctx = new Context()
  await ctx.plugin(RulesModelRouter, { rules } satisfies Config)
  return ctx.modelRouter as RulesModelRouter
}

function input(text: string, hasImage = false): ModelRouteInput {
  return { baseline, prompt: { text, hasImage } }
}

describe('RulesModelRouter', () => {
  it('applies the first rule whose conditions all hold and keeps the baseline route', async () => {
    const routed = await router([
      { id: 'image', hasImage: true, reasoningEffort: 'high' },
      { id: 'short', maxBytes: 12, reasoningEffort: 'low' },
      { id: 'code', pattern: '```', minBytes: 13, reasoningEffort: 'max' },
    ])
    await expect(routed.route(input('hi?'))).resolves.toEqual({
      selection: { ...baseline, reasoningEffort: 'low' },
      reason: 'rule "short" matched',
      rule: 'short',
    })
    await expect(routed.route(input('hi?', true))).resolves.toMatchObject({ rule: 'image' })
    await expect(routed.route(input('please fix:\n```ts\nx\n```'))).resolves.toMatchObject({ rule: 'code' })
    await expect(routed.route(input('a plain sentence that is longer'))).resolves.toEqual({
      selection: baseline,
      reason: 'no rule matched',
    })
  })

  it('measures prompt length in UTF-8 bytes and matches patterns with the u and s flags', async () => {
    const routed = await router([
      { id: 'long', minBytes: 100, reasoningEffort: 'max' },
      { id: 'cjk', maxBytes: 6, reasoningEffort: 'low' },
      { id: 'multiline', pattern: '^first.*second$', reasoningEffort: 'high' },
    ])
    await expect(routed.route(input('你好'))).resolves.toMatchObject({ rule: 'cjk' })
    await expect(routed.route(input('你好吗'))).resolves.toMatchObject({ reason: 'no rule matched' })
    await expect(routed.route(input('first\nsecond'))).resolves.toMatchObject({ rule: 'multiline' })
  })

  it.each<[string, RuleConfig[], RegExp]>([
    ['an empty list', [], /at least one rule/],
    ['an empty id', [{ id: '', maxBytes: 1, reasoningEffort: 'low' }], /non-empty id/],
    ['a repeated id', [
      { id: 'a', maxBytes: 1, reasoningEffort: 'low' },
      { id: 'a', minBytes: 1, reasoningEffort: 'low' },
    ], /declared more than once/],
    ['an empty effort', [{ id: 'a', maxBytes: 1, reasoningEffort: '' }], /non-empty reasoningEffort/],
    ['no condition', [{ id: 'a', reasoningEffort: 'low' }], /at least one of pattern/],
    ['crossed byte bounds', [{ id: 'a', minBytes: 5, maxBytes: 4, reasoningEffort: 'low' }], /minBytes greater than maxBytes/],
    ['an invalid pattern', [{ id: 'a', pattern: '(', reasoningEffort: 'low' }], /invalid pattern/],
  ])('fails at load on %s', async (_label, rules, message) => {
    await expect(router(rules)).rejects.toThrow(message)
  })

  it('rejects a rule list the plugin schema cannot type', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(RulesModelRouter, { rules: [{ id: 'a', maxBytes: 'many', reasoningEffort: 'low' }] } as never))
      .rejects.toThrow(/expected number/)
  })
})
