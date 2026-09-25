// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import * as plugin from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import type { CompanionInjected } from '../src/client/Companion.tsx'

let ctx: Context | undefined
afterEach(async () => { await ctx?.fiber.dispose(); ctx = undefined; vi.restoreAllMocks() })

describe('companion plugin lifetime', () => {
  it('waits for its slot, releases dictionaries/listeners, and supports redeclaration', async () => {
    ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin({ apply: applyLocale, inject: localeInject }).await()
    const removeListener = vi.spyOn(document, 'removeEventListener')
    const fiber = ctx.plugin(plugin)
    await fiber.await()
    const declare = () => ctx!.slots.register({
      name: 'root', children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } },
    }, ({ renderSlot }: PropsRenderSlots<'sidebar.footer.action'>) => renderSlot('sidebar.footer.action', { wide: true }))
    let remove = declare()
    const entries = () => ctx!.slots.entries('sidebar.footer.action')
    expect(entries().map(entry => entry.options.id)).toEqual(['rest-companion'])
    const t = ctx.locale.bind('companion')
    ctx.locale.setLocale('zh')
    expect(t('name')).toBe('休息小助手')
    ctx.locale.setLocale('en')
    expect(t('name')).toBe('Rest companion')
    const injected = (entries()[0]!.inject as unknown as () => CompanionInjected)()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(injected.hooks.pageVisible.getSnapshot()).toBe(false)
    remove()
    remove = declare()
    expect(entries()).toHaveLength(1)
    await fiber.dispose()
    expect(entries()).toHaveLength(0)
    expect(t('name')).not.toBe('Rest companion')
    expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    remove()
  })

  it('has a host entry without model behavior', () => {
    expect(applyNode).not.toThrow()
  })
})
