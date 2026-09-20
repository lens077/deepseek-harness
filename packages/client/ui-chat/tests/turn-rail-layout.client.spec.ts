// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  DEFAULT_ACTION_CONTROL_SIZE, DEFAULT_TURN_RAIL_ALIGNMENT, DEFAULT_TURN_RAIL_PLACEMENT,
  type ChatSettings, type TurnRailAlignment, type TurnRailPlacement,
} from '../src/chat-settings.ts'
import { DEFAULT_TURN_RAIL_LAYOUT, TurnRailLayoutPolicy } from '../src/client/turn-rail-layout.ts'

/** A ready Host section carrying one rail layout. */
function section(turnRailPlacement: TurnRailPlacement, turnRailAlignment: TurnRailAlignment): ChatSettings {
  return {
    transcriptView: 'compact',
    actionControlSize: DEFAULT_ACTION_CONTROL_SIZE,
    turnRailPlacement,
    turnRailAlignment,
  }
}

describe('TurnRailLayoutPolicy', () => {
  it('starts stacked at the column default and persists only the fields that move', () => {
    const host = stubSettingsScope<ChatSettings>()
    const policy = new TurnRailLayoutPolicy(host.scope)

    expect(policy.layout.getSnapshot()).toEqual(DEFAULT_TURN_RAIL_LAYOUT)
    expect(DEFAULT_TURN_RAIL_LAYOUT).toEqual({
      placement: DEFAULT_TURN_RAIL_PLACEMENT,
      alignment: DEFAULT_TURN_RAIL_ALIGNMENT,
    })

    // Only the placement moves: the alignment it carries already stands.
    policy.setLayout({ placement: 'column', alignment: 'top' })
    expect(policy.layout.getSnapshot()).toEqual({ placement: 'column', alignment: 'top' })
    expect(host.set).toHaveBeenCalledExactlyOnceWith('turnRailPlacement', 'column')

    // Only the alignment moves this time.
    policy.setLayout({ placement: 'column', alignment: 'bottom' })
    expect(host.set).toHaveBeenLastCalledWith('turnRailAlignment', 'bottom')
    expect(host.set).toHaveBeenCalledTimes(2)

    // An identical request writes nothing.
    policy.setLayout({ placement: 'column', alignment: 'bottom' })
    expect(host.set).toHaveBeenCalledTimes(2)
  })

  it('adopts Host state and holds its snapshot identity while the layout stands', () => {
    const host = stubSettingsScope<ChatSettings>()
    const policy = new TurnRailLayoutPolicy(host.scope)

    host.publish({ status: 'ready', value: section('column', 'center'), revision: 1, writable: true })
    const adopted = policy.layout.getSnapshot()
    expect(adopted).toEqual({ placement: 'column', alignment: 'center' })

    host.publish({ value: section('column', 'center'), revision: 2 })
    expect(policy.layout.getSnapshot()).toBe(adopted)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('falls back to the defaults for values an older or forged Host publishes', () => {
    const host = stubSettingsScope<ChatSettings>()
    const policy = new TurnRailLayoutPolicy(host.scope)
    policy.setLayout({ placement: 'column', alignment: 'bottom' })

    host.publish({
      status: 'ready',
      value: { transcriptView: 'compact', actionControlSize: DEFAULT_ACTION_CONTROL_SIZE } as unknown as ChatSettings,
      revision: 1,
      writable: true,
    })
    expect(policy.layout.getSnapshot()).toEqual(DEFAULT_TURN_RAIL_LAYOUT)

    host.publish({
      value: { ...section('column', 'center'), turnRailAlignment: 'middle' } as unknown as ChatSettings,
      revision: 2,
    })
    expect(policy.layout.getSnapshot()).toEqual({ placement: 'column', alignment: DEFAULT_TURN_RAIL_ALIGNMENT })
  })

  it('adopts an accepted section standing at construction', () => {
    const host = stubSettingsScope<ChatSettings>()
    host.publish({ status: 'ready', value: section('column', 'bottom'), revision: 1, writable: true })
    expect(new TurnRailLayoutPolicy(host.scope).layout.getSnapshot())
      .toEqual({ placement: 'column', alignment: 'bottom' })
  })
})
