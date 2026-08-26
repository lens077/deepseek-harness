import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_DIFF_EXPANSION, SESSION_FILES_SETTINGS_NAMESPACE, apply,
} from '@deepseek-ai/dsh-client-ui-session-files'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-session-files host', () => {
  it('registers, validates, and disposes the durable diff-expansion preference', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(SESSION_FILES_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({ diffExpansion: DEFAULT_DIFF_EXPANSION })
    await ctx.settings.update(ns, { diffExpansion: 'none' })
    expect(ctx.settings.get(ns)).toEqual({ diffExpansion: 'none' })
    await expect(ctx.settings.update(ns, { diffExpansion: 'sometimes' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
