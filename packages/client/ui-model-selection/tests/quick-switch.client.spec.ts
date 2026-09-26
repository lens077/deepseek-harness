// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { ModelSelectionSettings, RecentModel } from '../src/model-selection-settings.ts'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { QuickSwitchPolicy, quickModelChips } from '../src/client/quick-switch.ts'

const route = (model: string, reasoningEffort?: string): RecentModel => ({
  provider: 'deepseek-official',
  model,
  ...reasoningEffort === undefined ? {} : { reasoningEffort },
})

describe('QuickSwitchPolicy', () => {
  it('starts enabled with nothing remembered and publishes the toggle before persistence settles', () => {
    const host = stubSettingsScope<ModelSelectionSettings>()
    const policy = new QuickSwitchPolicy(host.scope)
    expect(policy.state.getSnapshot()).toEqual({ enabled: true, recent: [] })

    policy.setEnabled(false)
    expect(policy.state.getSnapshot().enabled).toBe(false)
    expect(host.set).toHaveBeenCalledWith('quickSwitch', false)
    policy.setEnabled(false)
    expect(host.set).toHaveBeenCalledTimes(1)
  })

  it('records accepted selections newest first and persists the folded list', () => {
    const host = stubSettingsScope<ModelSelectionSettings>()
    const policy = new QuickSwitchPolicy(host.scope)

    policy.record(route('pro', 'max'), route('flash', 'high'))
    expect(policy.state.getSnapshot().recent).toEqual([route('pro', 'max'), route('flash', 'high')])
    expect(host.set).toHaveBeenCalledWith('recentModels', [route('pro', 'max'), route('flash', 'high')])

    // Re-selecting the head changes nothing and writes nothing.
    policy.record(route('pro', 'max'), route('flash', 'high'))
    expect(host.set).toHaveBeenCalledTimes(1)
  })

  it('adopts Host state and ignores identical sections', () => {
    const host = stubSettingsScope<ModelSelectionSettings>()
    const policy = new QuickSwitchPolicy(host.scope)
    const section = { quickSwitch: false, recentModels: [route('pro', 'max')] }
    host.publish({ status: 'ready', value: section, revision: 1, writable: true })
    expect(policy.state.getSnapshot()).toEqual({ enabled: false, recent: [route('pro', 'max')] })

    const before = policy.state.getSnapshot()
    host.publish({ value: { quickSwitch: false, recentModels: [route('pro', 'max')] }, revision: 2 })
    expect(policy.state.getSnapshot()).toBe(before)

    host.publish({ value: { quickSwitch: false, recentModels: [route('pro', 'off')] }, revision: 3 })
    expect(policy.state.getSnapshot().recent).toEqual([route('pro', 'off')])
    host.publish({ value: { quickSwitch: false, recentModels: [] }, revision: 4 })
    expect(policy.state.getSnapshot().recent).toEqual([])
  })

  it('adopts an accepted section standing at construction', () => {
    const host = stubSettingsScope<ModelSelectionSettings>()
    host.publish({ status: 'ready', value: { quickSwitch: false, recentModels: [] }, revision: 1, writable: true })
    expect(new QuickSwitchPolicy(host.scope).state.getSnapshot().enabled).toBe(false)
  })
})

const reasoning = {
  efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
  defaultEffort: 'high',
}

function directory(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'flash', reasoningEffort: 'high' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'pro', name: 'DeepSeek-V4-Pro', reasoning },
        { id: 'plain', name: 'Plain' },
      ],
    }],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

describe('quickModelChips', () => {
  it('resolves remembered routes to catalog names and marks the current route active', () => {
    const chips = quickModelChips(directory(), [route('pro', 'max'), route('flash', 'high')])
    expect(chips).toEqual([
      {
        key: 'deepseek-official/pro',
        selection: { provider: 'deepseek-official', model: 'pro', reasoningEffort: 'max' },
        name: 'DeepSeek-V4-Pro',
        effort: 'Max',
        active: false,
      },
      {
        key: 'deepseek-official/flash',
        selection: { provider: 'deepseek-official', model: 'flash', reasoningEffort: 'high' },
        name: 'DeepSeek-V4-Flash',
        effort: 'High',
        active: true,
      },
    ])
  })

  it('drops routes the catalog no longer advertises and efforts the model no longer offers', () => {
    const chips = quickModelChips(directory(), [
      route('retired', 'max'),
      { provider: 'other', model: 'pro' },
      route('pro', 'ultra'),
      route('plain', 'high'),
      route('flash'),
    ])
    expect(chips.map(chip => [chip.key, chip.selection, chip.effort])).toEqual([
      ['deepseek-official/pro', { provider: 'deepseek-official', model: 'pro' }, undefined],
      ['deepseek-official/plain', { provider: 'deepseek-official', model: 'plain' }, undefined],
      ['deepseek-official/flash', { provider: 'deepseek-official', model: 'flash' }, undefined],
    ])
  })

  it('yields nothing before the catalog loads', () => {
    expect(quickModelChips(directory({ groups: [], current: null }), [route('pro')])).toEqual([])
  })
})
