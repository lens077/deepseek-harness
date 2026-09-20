// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  ACTION_CONTROL_SIZE_FIELD, ACTION_CONTROL_SIZE_MAX, ACTION_CONTROL_SIZE_MIN,
  ACTION_CONTROL_SIZE_RANGE, DEFAULT_ACTION_CONTROL_SIZE, DEFAULT_TRANSCRIPT_LEADING_PAD,
  TRANSCRIPT_LEADING_PAD_FIELD, TRANSCRIPT_LEADING_PAD_RANGE,
  clampActionControlSize, type ChatSettings,
} from '../src/chat-settings.ts'
import { PixelPreferencePolicy } from '../src/client/pixel-preference.ts'

/** The action-control size preference, the policy's first consumer. */
function sizePolicy(host: SettingsScope<ChatSettings>): PixelPreferencePolicy {
  return new PixelPreferencePolicy(host, ACTION_CONTROL_SIZE_FIELD, ACTION_CONTROL_SIZE_RANGE)
}

/** A ready Host section carrying one control size. */
function section(actionControlSize: number): ChatSettings {
  return {
    transcriptView: 'compact',
    actionControlSize,
    turnRailPlacement: 'stacked',
    turnRailAlignment: 'top',
    transcriptLeadingPad: DEFAULT_TRANSCRIPT_LEADING_PAD,
  }
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

describe('PixelPreferencePolicy', () => {
  it('starts at the shipped size and persists an explicit choice', () => {
    const host = stubSettingsScope<ChatSettings>()
    const policy = sizePolicy(host.scope)

    expect(policy.value.getSnapshot()).toBe(DEFAULT_ACTION_CONTROL_SIZE)
    policy.set(42)
    expect(policy.value.getSnapshot()).toBe(42)
    expect(host.set).toHaveBeenCalledWith('actionControlSize', 42)
  })

  it('zooms by whole steps and absorbs the remainder at each range end', () => {
    const host = stubSettingsScope<ChatSettings>()
    const policy = sizePolicy(host.scope)

    policy.zoom(1)
    expect(policy.value.getSnapshot()).toBe(DEFAULT_ACTION_CONTROL_SIZE + 4)
    policy.zoom(-2)
    expect(policy.value.getSnapshot()).toBe(DEFAULT_ACTION_CONTROL_SIZE - 4)

    policy.zoom(99)
    expect(policy.value.getSnapshot()).toBe(ACTION_CONTROL_SIZE_MAX)
    // Already at the ceiling: no further write leaves the browser.
    const writes = host.set.mock.calls.length
    policy.zoom(1)
    expect(host.set.mock.calls.length).toBe(writes)

    policy.zoom(-99)
    expect(policy.value.getSnapshot()).toBe(ACTION_CONTROL_SIZE_MIN)
  })

  it('adopts Host state, ignores identical writes, and snaps an unstepped stored value', () => {
    const host = stubSettingsScope<ChatSettings>()
    const policy = sizePolicy(host.scope)

    host.publish({ status: 'ready', value: section(42), revision: 1, writable: true })
    expect(policy.value.getSnapshot()).toBe(42)
    policy.set(42)
    expect(host.set).not.toHaveBeenCalled()

    host.publish({ value: section(45), revision: 2 })
    expect(policy.value.getSnapshot()).toBe(46)
    // A section that resolves to the standing size leaves the store alone.
    host.publish({ value: section(47), revision: 3 })
    expect(policy.value.getSnapshot()).toBe(46)
  })

  it('keeps the shipped size when an older Host publishes a section without the field', () => {
    const host = stubSettingsScope<ChatSettings>()
    const policy = sizePolicy(host.scope)
    policy.set(50)

    // A Host predating this field answers with the section it knows; a size
    // derived from the absent value would be NaN.
    host.publish({
      status: 'ready',
      value: { transcriptView: 'compact' } as unknown as ChatSettings,
      revision: 1,
      writable: true,
    })
    expect(policy.value.getSnapshot()).toBe(DEFAULT_ACTION_CONTROL_SIZE)
  })

  it('carries the leading-gutter preference on its own field and range', () => {
    const host = stubSettingsScope<ChatSettings>()
    const pad = new PixelPreferencePolicy(host.scope, TRANSCRIPT_LEADING_PAD_FIELD, TRANSCRIPT_LEADING_PAD_RANGE)

    expect(pad.value.getSnapshot()).toBe(DEFAULT_TRANSCRIPT_LEADING_PAD)
    pad.zoom(1)
    expect(pad.value.getSnapshot()).toBe(DEFAULT_TRANSCRIPT_LEADING_PAD + TRANSCRIPT_LEADING_PAD_RANGE.step)
    expect(host.set).toHaveBeenCalledWith(TRANSCRIPT_LEADING_PAD_FIELD, 10)

    // Nothing floats on that side, so the range reaches zero.
    pad.zoom(-99)
    expect(pad.value.getSnapshot()).toBe(TRANSCRIPT_LEADING_PAD_RANGE.min)
    expect(TRANSCRIPT_LEADING_PAD_RANGE.min).toBe(0)

    host.publish({ status: 'ready', value: { ...section(34), transcriptLeadingPad: 25 }, revision: 1, writable: true })
    expect(pad.value.getSnapshot()).toBe(25)
  })

  it('adopts an accepted section standing at construction and tolerates none', () => {
    const host = stubSettingsScope<ChatSettings>()
    host.publish({ status: 'ready', value: section(50), revision: 1, writable: true })
    expect(sizePolicy(host.scope).value.getSnapshot()).toBe(50)

    const empty = stubSettingsScope<ChatSettings>()
    expect(sizePolicy(empty.scope).value.getSnapshot()).toBe(DEFAULT_ACTION_CONTROL_SIZE)
  })
})
