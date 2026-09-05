import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { ConversationSettingsSchema, type ConversationSettings } from '../src/submission-settings.ts'
import {
  CONVERSATION_SETTINGS_NAMESPACE, DEFAULT_BUSY_ENTER_BEHAVIOR, apply,
} from '@deepseek-ai/dsh-client-ui-conversation'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-conversation host', () => {
  it('defaults the send shortcut when reading existing conversation settings', () => {
    // This parser input deliberately omits the send shortcut that the schema must default.
    expect(ConversationSettingsSchema({ busyEnter: 'steer' } as ConversationSettings)).toEqual({
      busyEnter: 'steer',
      sendShortcut: 'enter',
    })
  })

  it('registers, validates, and disposes the durable composer preferences', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = CONVERSATION_SETTINGS_NAMESPACE
    const defaults = {
      busyEnter: DEFAULT_BUSY_ENTER_BEHAVIOR,
      sendShortcut: 'enter',
    }
    expect(ctx.settings.get(ns)).toEqual(defaults)
    await ctx.settings.update(ns, { busyEnter: 'steer' })
    expect(ctx.settings.get(ns)).toEqual({ ...defaults, busyEnter: 'steer' })
    await ctx.settings.update(ns, { sendShortcut: 'mod-enter' })
    expect(ctx.settings.get(ns)).toEqual({ ...defaults, busyEnter: 'steer', sendShortcut: 'mod-enter' })
    await ctx.settings.update(ns, { sendShortcut: 'Ctrl+Alt+S' })
    const accepted = { ...defaults, busyEnter: 'steer', sendShortcut: 'Ctrl+Alt+S' }
    expect(ctx.settings.get(ns)).toEqual(accepted)
    await expect(ctx.settings.update(ns, { busyEnter: 'invalid' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { sendShortcut: 'invalid' })).rejects.toThrow()
    expect(ctx.settings.get(ns)).toEqual(accepted)
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
