// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  ACTION_CONTROL_SIZE_MAX, ACTION_CONTROL_SIZE_MIN, DEFAULT_ACTION_CONTROL_SIZE,
  clampActionControlSize, type ChatSettings,
} from '../src/chat-settings.ts'
import { ActionControlSizePolicy } from '../src/client/action-control-size.ts'

/** A ready Host section carrying one control size. */
function section(actionControlSize: number): ChatSettings {
  return { transcriptView: 'compact', actionControlSize, turnRailPlacement: 'stacked', turnRailAlignment: 'top' }
}

describe('clampActionControlSize', () => {
  it('snaps to the zoom step and holds the accepted range at both ends', () => {
    expect(clampActionControlSize(DEFAULT_ACTION_CONTROL_SIZE)).toBe(DEFAULT_ACTION_CONTROL_SIZE)
    expect(clampActionControlSize(35)).toBe(34)
    expect(clampActionControlSize(37)).toBe(38)
    expect(clampActionControlSize(0)).toBe(ACTION_CONTROL_SIZE_MIN)
    expect(clampActionControlSize(999)).toBe(ACTION_CONTROL_SIZE_MAX)
  })
})

describe('ActionControlSizePolicy', () => {
  it('starts at the shipped size and persists an explicit choice', () => {
    const host = stubSettingsScope<ChatSettings>()
    const policy = new ActionControlSizePolicy(host.scope)

    expect(policy.size.getSnapshot()).toBe(DEFAULT_ACTION_CONTROL_SIZE)
    policy.setSize(42)
    expect(policy.size.getSnapshot()).toBe(42)
    expect(host.set).toHaveBeenCalledWith('actionControlSize', 42)
  })

  it('zooms by whole steps and absorbs the remainder at each range end', () => {
    const host = stubSettingsScope<ChatSettings>()
    const policy = new ActionControlSizePolicy(host.scope)

    policy.zoom(1)
    expect(policy.size.getSnapshot()).toBe(DEFAULT_ACTION_CONTROL_SIZE + 4)
    policy.zoom(-2)
    expect(policy.size.getSnapshot()).toBe(DEFAULT_ACTION_CONTROL_SIZE - 4)

    policy.zoom(99)
    expect(policy.size.getSnapshot()).toBe(ACTION_CONTROL_SIZE_MAX)
    // Already at the ceiling: no further write leaves the browser.
    const writes = host.set.mock.calls.length
    policy.zoom(1)
    expect(host.set.mock.calls.length).toBe(writes)

    policy.zoom(-99)
    expect(policy.size.getSnapshot()).toBe(ACTION_CONTROL_SIZE_MIN)
  })

  it('adopts Host state, ignores identical writes, and snaps an unstepped stored value', () => {
    const host = stubSettingsScope<ChatSettings>()
    const policy = new ActionControlSizePolicy(host.scope)

    host.publish({ status: 'ready', value: section(42), revision: 1, writable: true })
    expect(policy.size.getSnapshot()).toBe(42)
    policy.setSize(42)
    expect(host.set).not.toHaveBeenCalled()

    host.publish({ value: section(45), revision: 2 })
    expect(policy.size.getSnapshot()).toBe(46)
    // A section that resolves to the standing size leaves the store alone.
    host.publish({ value: section(47), revision: 3 })
    expect(policy.size.getSnapshot()).toBe(46)
  })

  it('keeps the shipped size when an older Host publishes a section without the field', () => {
    const host = stubSettingsScope<ChatSettings>()
    const policy = new ActionControlSizePolicy(host.scope)
    policy.setSize(50)

    // A Host predating this field answers with the section it knows; a size
    // derived from the absent value would be NaN.
    host.publish({
      status: 'ready',
      value: { transcriptView: 'compact' } as unknown as ChatSettings,
      revision: 1,
      writable: true,
    })
    expect(policy.size.getSnapshot()).toBe(DEFAULT_ACTION_CONTROL_SIZE)
  })

  it('adopts an accepted section standing at construction and tolerates none', () => {
    const host = stubSettingsScope<ChatSettings>()
    host.publish({ status: 'ready', value: section(50), revision: 1, writable: true })
    expect(new ActionControlSizePolicy(host.scope).size.getSnapshot()).toBe(50)

    const empty = stubSettingsScope<ChatSettings>()
    expect(new ActionControlSizePolicy(empty.scope).size.getSnapshot()).toBe(DEFAULT_ACTION_CONTROL_SIZE)
  })
})
