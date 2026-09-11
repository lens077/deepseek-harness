/**
 * ui-digest node half: the durable `ui-digest` section is registered against
 * a settings provider, defaults absent fields, rejects values outside the
 * schema, and leaves with the plugin fiber; the order repair keeps every
 * badge state exactly once.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { DigestSettingsSchema, normalizeBadgeOrder, type DigestSettings } from '../src/nav-settings.ts'
import { DEFAULT_DIGEST_SETTINGS, DIGEST_SETTINGS_NAMESPACE, NAV_BADGE_STATES, apply } from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-digest host', () => {
  it('defaults absent fields when reading an existing section', () => {
    // These parser inputs deliberately omit fields the schema must default.
    expect(DigestSettingsSchema({} as DigestSettings)).toEqual(DEFAULT_DIGEST_SETTINGS)
    expect(DigestSettingsSchema({ navBadges: false } as DigestSettings)).toEqual({ ...DEFAULT_DIGEST_SETTINGS, navBadges: false })
  })

  it('repairs a stored order into a permutation of every state', () => {
    expect(normalizeBadgeOrder([])).toEqual([...NAV_BADGE_STATES])
    expect(normalizeBadgeOrder(['failed', 'failed', 'waiting'])).toEqual(['failed', 'waiting', 'unread', 'running'])
    expect(normalizeBadgeOrder(['running', 'unread', 'failed', 'waiting'])).toEqual(['running', 'unread', 'failed', 'waiting'])
  })

  it('registers, validates, and disposes the durable preferences', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = DIGEST_SETTINGS_NAMESPACE
    expect(ctx.settings.get(ns)).toEqual(DEFAULT_DIGEST_SETTINGS)
    await ctx.settings.update(ns, { navFinishedBadge: true, navBadgeOrder: ['failed', 'running', 'unread', 'waiting'], toggleShortcut: 'Ctrl+Shift+I' })
    expect(ctx.settings.get(ns)).toEqual({ navBadges: true, navFinishedBadge: true, navBadgeOrder: ['failed', 'running', 'unread', 'waiting'], toggleShortcut: 'Ctrl+Shift+I' })
    await expect(ctx.settings.update(ns, { navBadgeOrder: ['nope'] })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { navBadges: 'yes' })).rejects.toThrow()
    // Noncanonical modifier order and unsupported keys never reach the document.
    await expect(ctx.settings.update(ns, { toggleShortcut: 'Shift+Ctrl+I' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { toggleShortcut: 'Ctrl+Escape' })).rejects.toThrow()
    await ctx.settings.update(ns, { toggleShortcut: 'F2' })
    expect(ctx.settings.get(ns)).toMatchObject({ toggleShortcut: 'F2' })
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('stays inert without a settings provider', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({ apply })
    await expect(fiber.await()).resolves.toBeDefined()
    await fiber.dispose()
  })
})
