import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  ACTION_CONTROL_SIZE_MAX, CHAT_SETTINGS_NAMESPACE, DEFAULT_ACTION_CONTROL_SIZE,
  DEFAULT_TRANSCRIPT_VIEW_MODE, DEFAULT_TURN_RAIL_ALIGNMENT, DEFAULT_TURN_RAIL_PLACEMENT, apply,
} from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-chat Host settings', () => {
  it('registers, validates, and disposes the Chat preferences namespace', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = CHAT_SETTINGS_NAMESPACE

    const defaults = {
      transcriptView: DEFAULT_TRANSCRIPT_VIEW_MODE,
      actionControlSize: DEFAULT_ACTION_CONTROL_SIZE,
      turnRailPlacement: DEFAULT_TURN_RAIL_PLACEMENT,
      turnRailAlignment: DEFAULT_TURN_RAIL_ALIGNMENT,
    }
    expect(ctx.settings.get(ns)).toEqual(defaults)
    await ctx.settings.update(ns, { transcriptView: 'normal' })
    expect(ctx.settings.get(ns)).toEqual({ ...defaults, transcriptView: 'normal' })
    await expect(ctx.settings.update(ns, { transcriptView: 'dense' })).rejects.toThrow()

    await ctx.settings.update(ns, { actionControlSize: ACTION_CONTROL_SIZE_MAX })
    expect(ctx.settings.get(ns)).toEqual({
      ...defaults, transcriptView: 'normal', actionControlSize: ACTION_CONTROL_SIZE_MAX,
    })
    await expect(ctx.settings.update(ns, { actionControlSize: ACTION_CONTROL_SIZE_MAX + 1 })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { actionControlSize: 0 })).rejects.toThrow()

    await ctx.settings.update(ns, { turnRailPlacement: 'column', turnRailAlignment: 'bottom' })
    expect(ctx.settings.get(ns)).toEqual({
      ...defaults,
      transcriptView: 'normal',
      actionControlSize: ACTION_CONTROL_SIZE_MAX,
      turnRailPlacement: 'column',
      turnRailAlignment: 'bottom',
    })
    await expect(ctx.settings.update(ns, { turnRailPlacement: 'floating' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { turnRailAlignment: 'middle' })).rejects.toThrow()

    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('loads without a settings provider', async () => {
    const ctx = new Context()
    await expect(ctx.plugin({ apply }).await()).resolves.toBeDefined()
  })
})
