import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/invariant.ts'
import { apply as hostApply } from '../src/index.ts'

describe('@deepseek-ai/dsh-client-ui-session-files/invariant', () => {
  it('registers the package-owned empty companion', async () => {
    const register = vi.fn((_package: string, install: () => void) => {
      // The companion asserts nothing; running it proves that is deliberate.
      install()
      return vi.fn()
    })
    const ctx = new Context()
    ctx.provide('invariants', { register })
    const dispose = await apply(ctx)
    expect(name).toBe('client-ui-session-files-invariant')
    expect(inject).toEqual(['invariants'])
    expect(register).toHaveBeenCalledWith('@deepseek-ai/dsh-client-ui-session-files', expect.any(Function))
    dispose()
  })

  it('contributes nothing to a Host without a settings provider', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({ apply: hostApply })
    await fiber.await()
    // The section is the node half's only contribution; without a provider to
    // hold it the plugin mounts and registers nothing.
    expect(ctx.get('settings')).toBeUndefined()
    await fiber.dispose()
  })
})
