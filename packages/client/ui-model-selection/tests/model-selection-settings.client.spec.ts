import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_QUICK_SWITCH, MODEL_SELECTION_SETTINGS_NAMESPACE, RECENT_MODELS_LIMIT,
  apply, rememberRecentModel, type RecentModel,
} from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

const route = (model: string, reasoningEffort?: string): RecentModel => ({
  provider: 'deepseek-official',
  model,
  ...reasoningEffort === undefined ? {} : { reasoningEffort },
})

describe('ui-model-selection Host settings', () => {
  it('registers, validates, and disposes the model selection preferences namespace', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = MODEL_SELECTION_SETTINGS_NAMESPACE

    expect(ctx.settings.get(ns)).toEqual({ quickSwitch: DEFAULT_QUICK_SWITCH, recentModels: [] })
    expect(DEFAULT_QUICK_SWITCH).toBe(true)
    await ctx.settings.update(ns, { quickSwitch: false })
    expect(ctx.settings.get(ns)).toEqual({ quickSwitch: false, recentModels: [] })
    await expect(ctx.settings.update(ns, { quickSwitch: 'yes' })).rejects.toThrow()

    await ctx.settings.update(ns, { recentModels: [route('deepseek-v4-pro', 'max'), route('deepseek-v4-flash')] })
    expect(ctx.settings.get(ns)).toEqual({
      quickSwitch: false,
      recentModels: [route('deepseek-v4-pro', 'max'), route('deepseek-v4-flash')],
    })
    await expect(ctx.settings.update(ns, { recentModels: [{ provider: 'deepseek-official' }] })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { recentModels: 'deepseek-v4-pro' })).rejects.toThrow()

    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('loads without a settings provider', async () => {
    const ctx = new Context()
    await expect(ctx.plugin({ apply }).await()).resolves.toBeDefined()
  })
})

describe('rememberRecentModel', () => {
  it('puts the selection first and the replaced route right behind it', () => {
    expect(rememberRecentModel([], route('pro', 'max'), route('flash', 'high')))
      .toEqual([route('pro', 'max'), route('flash', 'high')])
  })

  it('keeps one entry per route, carrying the effort it was last used with', () => {
    const before = [route('flash', 'high'), route('pro', 'max')]
    expect(rememberRecentModel(before, route('pro', 'off'), route('flash', 'high')))
      .toEqual([route('pro', 'off'), route('flash', 'high')])
  })

  it('records an effort-only change as the same route and no previous entry', () => {
    const before = [route('flash', 'high'), route('pro', 'max')]
    expect(rememberRecentModel(before, route('flash', 'max'), route('flash', 'high')))
      .toEqual([route('flash', 'max'), route('pro', 'max')])
  })

  it('returns the same reference when the list already stands as it would fold', () => {
    const before = [route('pro', 'max'), route('flash', 'high')]
    expect(rememberRecentModel(before, route('pro', 'max'), route('flash', 'high'))).toBe(before)
    expect(rememberRecentModel(before, route('pro', 'max'), null)).toBe(before)
  })

  it('evicts the oldest entries past the limit', () => {
    let recent: readonly RecentModel[] = []
    for (let index = 0; index < RECENT_MODELS_LIMIT + 3; index += 1) {
      recent = rememberRecentModel(recent, route(`m${index}`), null)
    }
    expect(recent).toHaveLength(RECENT_MODELS_LIMIT)
    expect(recent[0]).toEqual(route(`m${RECENT_MODELS_LIMIT + 2}`))
    expect(recent.at(-1)).toEqual(route('m3'))
  })
})
