// @vitest-environment jsdom
/**
 * The pinned-sessions settings: the policy standing on defaults until a scope
 * binds it, mirroring the scope while bound, and routing writes; and the
 * settings page over direct props — the master switch, the two surface
 * switches following it, the row count clamped into the schema range, and the
 * disabled and failure states.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionPinsSettings } from '../src/pins-settings.ts'
import { PinsSettingsPolicy, type PinsSettingsView } from '../src/client/pins-settings-policy.ts'
import { PinsSettingsSection } from '../src/client/PinsSettingsSection.tsx'
import type { PinsSettingsSectionProps } from '../src/client/contract/slots.ts'
import { zh } from '../src/client/locales.ts'
import { t } from './fixtures.client.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const DEFAULTS: PinsSettingsView = {
  status: 'unavailable', writable: false, enabled: true, sidebarArea: true, sidebarRows: 5, digestSection: true,
}

describe('PinsSettingsPolicy', () => {
  it('stands on defaults unbound, mirrors a bound scope, and returns to defaults when detached', () => {
    const policy = new PinsSettingsPolicy()
    expect(policy.view.getSnapshot()).toEqual(DEFAULTS)
    const stub = stubSettingsScope<SessionPinsSettings>()
    const detach = policy.bind(stub.scope)
    expect(policy.view.getSnapshot()).toMatchObject({ status: 'loading', enabled: true })
    stub.publish({ status: 'ready', writable: true, value: { enabled: false, sidebarArea: false, sidebarRows: 8, digestSection: false } })
    expect(policy.view.getSnapshot()).toEqual({
      status: 'ready', writable: true, enabled: false, sidebarArea: false, sidebarRows: 8, digestSection: false,
    })
    // A scope that turns unavailable keeps the last document in view.
    stub.publish({ status: 'unavailable', value: undefined, writable: false })
    expect(policy.view.getSnapshot()).toMatchObject({ status: 'unavailable', enabled: false, sidebarRows: 8 })
    detach()
    expect(stub.listenerCount()).toBe(0)
    expect(policy.view.getSnapshot()).toEqual(DEFAULTS)
  })

  it('routes writes to the scope and rejects writes while unbound', async () => {
    const policy = new PinsSettingsPolicy()
    await expect(policy.setEnabled(false)).rejects.toThrow('unavailable')
    const stub = stubSettingsScope<SessionPinsSettings>()
    policy.bind(stub.scope)
    await policy.setEnabled(false)
    await policy.setSidebarArea(false)
    await policy.setSidebarRows(7)
    await policy.setDigestSection(false)
    expect(stub.set.mock.calls).toEqual([
      ['enabled', false], ['sidebarArea', false], ['sidebarRows', 7], ['digestSection', false],
    ])
  })
})

type SectionCalls = {
  setEnabled: ReturnType<typeof vi.fn<(enabled: boolean) => Promise<void>>>
  setSidebarArea: ReturnType<typeof vi.fn<(enabled: boolean) => Promise<void>>>
  setSidebarRows: ReturnType<typeof vi.fn<(rows: number) => Promise<void>>>
  setDigestSection: ReturnType<typeof vi.fn<(enabled: boolean) => Promise<void>>>
}

function mount(view: Partial<PinsSettingsView> = {}, over: Partial<SectionCalls> = {}) {
  const state: PinsSettingsView = { ...DEFAULTS, status: 'ready', writable: true, ...view }
  const calls: SectionCalls = {
    setEnabled: vi.fn<(enabled: boolean) => Promise<void>>(async () => undefined),
    setSidebarArea: vi.fn<(enabled: boolean) => Promise<void>>(async () => undefined),
    setSidebarRows: vi.fn<(rows: number) => Promise<void>>(async () => undefined),
    setDigestSection: vi.fn<(enabled: boolean) => Promise<void>>(async () => undefined),
    ...over,
  }
  const props = {
    close: vi.fn(),
    usePinsSettings: ((selector: (s: PinsSettingsView) => unknown) => selector(state)),
    ...calls,
    t,
  } as unknown as PinsSettingsSectionProps
  render(<PinsSettingsSection {...props} />)
  return calls
}

function checkboxes(): HTMLInputElement[] {
  return screen.getAllByRole('checkbox') as HTMLInputElement[]
}

describe('PinsSettingsSection', () => {
  it('writes the three switches, and the surface switches follow the master switch', () => {
    const c = mount()
    const [enabled, sidebar, digest] = checkboxes()
    fireEvent.click(enabled!)
    expect(c.setEnabled).toHaveBeenCalledWith(false)
    fireEvent.click(sidebar!)
    expect(c.setSidebarArea).toHaveBeenCalledWith(false)
    fireEvent.click(digest!)
    expect(c.setDigestSection).toHaveBeenCalledWith(false)
    cleanup()
    mount({ enabled: false })
    const [, sidebarOff, digestOff] = checkboxes()
    expect(sidebarOff!.disabled).toBe(true)
    expect(digestOff!.disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(zh['pinsSettings.sidebarRows']).disabled).toBe(true)
  })

  it('clamps the row count into the schema range and ignores an empty or unparsable field', () => {
    const c = mount()
    const rows = screen.getByLabelText<HTMLInputElement>(zh['pinsSettings.sidebarRows'])
    expect(rows.value).toBe('5')
    fireEvent.change(rows, { target: { value: '8' } })
    expect(c.setSidebarRows).toHaveBeenLastCalledWith(8)
    fireEvent.change(rows, { target: { value: '99' } })
    expect(c.setSidebarRows).toHaveBeenLastCalledWith(20)
    fireEvent.change(rows, { target: { value: '0' } })
    expect(c.setSidebarRows).toHaveBeenLastCalledWith(1)
    fireEvent.change(rows, { target: { value: '' } })
    expect(c.setSidebarRows).toHaveBeenCalledTimes(3)
    cleanup()
    mount({ sidebarArea: false })
    expect(screen.getByLabelText<HTMLInputElement>(zh['pinsSettings.sidebarRows']).disabled).toBe(true)
  })

  it('disables every control while loading or read-only, and surfaces a failed write briefly', async () => {
    vi.useFakeTimers()
    mount({ status: 'loading' })
    expect(screen.getByText(zh['settings.loading'])).toBeTruthy()
    expect(checkboxes().every(box => box.disabled)).toBe(true)
    cleanup()
    mount({ writable: false })
    expect(screen.getByText(zh['settings.unavailable'])).toBeTruthy()
    expect(checkboxes().every(box => box.disabled)).toBe(true)
    cleanup()
    mount({}, { setEnabled: vi.fn(async () => { throw new Error('disk full') }) })
    fireEvent.click(checkboxes()[0]!)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('alert').textContent).toBe('保存失败：disk full')
    await act(async () => { vi.advanceTimersByTime(4_000) })
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    // A non-Error rejection is shown as text.
    mount({}, { setSidebarRows: vi.fn(async () => { throw 'offline' }) })
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(zh['pinsSettings.sidebarRows']), { target: { value: '6' } })
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('alert').textContent).toBe('保存失败：offline')
  })
})
