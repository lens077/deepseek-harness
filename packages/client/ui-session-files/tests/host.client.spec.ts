import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_DIFF_EXPANSION, DEFAULT_RAIL_VISIBILITY, SESSION_FILES_SETTINGS_NAMESPACE, apply,
} from '@deepseek-ai/dsh-client-ui-session-files'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-session-files host', () => {
  it('registers, validates, and disposes the durable file-surface preferences', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(SESSION_FILES_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({
      diffExpansion: DEFAULT_DIFF_EXPANSION,
      railVisibility: DEFAULT_RAIL_VISIBILITY,
    })
    await ctx.settings.update(ns, { diffExpansion: 'none' })
    expect(ctx.settings.get(ns)).toEqual({ diffExpansion: 'none', railVisibility: 'show' })
    await ctx.settings.update(ns, { railVisibility: 'hide' })
    expect(ctx.settings.get(ns)).toEqual({ diffExpansion: 'none', railVisibility: 'hide' })
    await expect(ctx.settings.update(ns, { diffExpansion: 'sometimes' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { railVisibility: 'invisible' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
