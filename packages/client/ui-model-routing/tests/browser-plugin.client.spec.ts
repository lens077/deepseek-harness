/**
 * ui-model-routing browser half on a real SlotRegistry: one controller feeds
 * both the Models-page footer row and the composer chip; each waits for its
 * slot declaration and leaves with the fiber (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { ModelRoutingChip } from '../src/client/ModelRoutingChip.tsx'
import { ModelRoutingRow } from '../src/client/ModelRoutingRow.tsx'
import type { ModelRoutingFace, ModelRoutingSettings } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  ctx.provide('locale', new LocaleRuntime(ctx))
  const host = stubSettingsScope<ModelRoutingSettings>()
  const bound: string[] = []
  ctx.provide('settingsScope', {
    bind: ({ namespace }: { namespace: string }) => {
      bound.push(namespace)
      return host.scope
    },
  })
  return { ctx, slots, host, bound }
}

function declareSeats(slots: SlotRegistry): void {
  slots.register({
    name: 'root',
    children: {
      'settings.models.footer': { kind: 'list', scope: 'root' },
      'conversation.input.right': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
}

describe('ui-model-routing browser apply', () => {
  it('declares every service it binds and keeps the node half inert', () => {
    expect(inject).toEqual(['slots', 'locale', 'settingsScope'])
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('binds the model-routing namespace once and fills each seat as it is declared', async () => {
    const { ctx, slots, host, bound } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(bound).toEqual(['model-routing'])
    expect(slots.entries('settings.models.footer')).toHaveLength(0)
    expect(slots.entries('conversation.input.right')).toHaveLength(0)

    declareSeats(slots)
    await Promise.resolve()
    const row = slots.entries('settings.models.footer')[0]!
    const chip = slots.entries('conversation.input.right')[0]!
    expect(row.component).toBe(ModelRoutingRow)
    expect(chip.component).toBe(ModelRoutingChip)
    expect(chip.options).toMatchObject({ id: 'model-routing', order: -10 })

    // Both seats read one snapshot: a Host publication reaches the chip through the row's face.
    const rowFace = (row.inject as unknown as () => ModelRoutingFace)()
    const chipFace = (chip.inject as unknown as () => ModelRoutingFace)()
    expect(chipFace.hooks.modelRouting).toBe(rowFace.hooks.modelRouting)
    host.publish({ status: 'ready', writable: true, value: { enabled: false }, base: {}, user: {} })
    expect(chipFace.hooks.modelRouting.getSnapshot()).toMatchObject({ available: true, enabled: false })

    await fiber.dispose()
    expect(slots.entries('settings.models.footer')).toHaveLength(0)
    expect(slots.entries('conversation.input.right')).toHaveLength(0)
  })
})
