import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { ModelRoutingController, type ModelRoutingSettings } from '../src/client/controller.ts'

describe('ModelRoutingController', () => {
  it('reads an absent value as on, writes on toggle, and reports a write that did not land', async () => {
    const host = stubSettingsScope<ModelRoutingSettings>()
    const face = new ModelRoutingController(host.scope).inject()
    expect(face.hooks.modelRouting.getSnapshot()).toMatchObject({ available: false, enabled: true })

    host.publish({ status: 'ready', writable: true, value: {}, base: {}, user: {} })
    expect(face.hooks.modelRouting.getSnapshot()).toMatchObject({ available: true, writable: true, enabled: true })

    host.set.mockImplementation((field: string, value: unknown) => {
      host.publish({ value: { [field]: value } })
    })
    face.toggle(false)
    expect(face.hooks.modelRouting.getSnapshot().saving).toBe(true)
    await vi.waitFor(() => { expect(host.set).toHaveBeenCalledWith('enabled', false) })
    await vi.waitFor(() => {
      expect(face.hooks.modelRouting.getSnapshot()).toMatchObject({ enabled: false, saving: false, failed: false })
    })

    // A write the Host accepted without republishing the value did not land.
    host.set.mockResolvedValueOnce(undefined)
    face.toggle(true)
    await vi.waitFor(() => { expect(face.hooks.modelRouting.getSnapshot()).toMatchObject({ enabled: false, failed: true }) })

    host.set.mockRejectedValueOnce(new Error('offline'))
    face.toggle(true)
    await vi.waitFor(() => { expect(face.hooks.modelRouting.getSnapshot()).toMatchObject({ failed: true, saving: false }) })
  })

  it('ignores a toggle while a write is in flight', async () => {
    const host = stubSettingsScope<ModelRoutingSettings>()
    host.publish({ status: 'ready', writable: true, value: { enabled: true }, base: {}, user: {} })
    const pending = Promise.withResolvers<undefined>()
    host.set.mockReturnValueOnce(pending.promise)
    const face = new ModelRoutingController(host.scope).inject()
    face.toggle(false)
    face.toggle(true)
    expect(host.set).toHaveBeenCalledTimes(1)
    pending.resolve(undefined)
    await vi.waitFor(() => { expect(face.hooks.modelRouting.getSnapshot().saving).toBe(false) })
  })
})
