// @vitest-environment jsdom
/**
 * The digest panel settings: the policy standing on defaults until a scope
 * binds it, mirroring the scope while bound, and routing repaired writes; and
 * the settings page over direct props — the two toggles, the order list
 * reordered by drag and by buttons, the reset, and the disabled and failure
 * states.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { DigestSettings, NavBadgeState } from '../src/nav-settings.ts'
import { NavSettingsPolicy, type NavSettingsView } from '../src/client/nav-settings-policy.ts'
import { DigestSettingsSection } from '../src/client/DigestSettingsSection.tsx'
import type { DigestSettingsSectionProps } from '../src/client/contract/slots.ts'
import { zh } from '../src/client/locales.ts'
import { t } from './fixtures.client.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const DEFAULT_ORDER: NavBadgeState[] = ['waiting', 'unread', 'running', 'failed']

describe('NavSettingsPolicy', () => {
  it('stands on defaults unbound, mirrors a bound scope, and returns to defaults when detached', () => {
    const policy = new NavSettingsPolicy()
    expect(policy.view.getSnapshot()).toEqual({
      status: 'unavailable', navBadges: true, navFinishedBadge: false, navBadgeOrder: DEFAULT_ORDER, writable: false,
    })
    const stub = stubSettingsScope<DigestSettings>()
    const detach = policy.bind(stub.scope)
    expect(policy.view.getSnapshot()).toMatchObject({ status: 'loading', navBadges: true })
    stub.publish({ status: 'ready', writable: true, value: { navBadges: false, navFinishedBadge: true, navBadgeOrder: ['failed', 'failed'] } })
    // A repeated or missing state in the document is repaired for display.
    expect(policy.view.getSnapshot()).toEqual({
      status: 'ready', writable: true, navBadges: false, navFinishedBadge: true, navBadgeOrder: ['failed', 'waiting', 'unread', 'running'],
    })
    stub.publish({ status: 'unavailable', value: undefined, writable: false })
    expect(policy.view.getSnapshot()).toMatchObject({ status: 'unavailable', navBadges: false, navBadgeOrder: ['failed', 'waiting', 'unread', 'running'] })
    detach()
    expect(stub.listenerCount()).toBe(0)
    expect(policy.view.getSnapshot()).toMatchObject({ status: 'unavailable', navBadges: true, navBadgeOrder: DEFAULT_ORDER })
  })

  it('routes repaired writes to the scope and rejects writes while unbound', async () => {
    const policy = new NavSettingsPolicy()
    await expect(policy.setNavBadges(false)).rejects.toThrow('unavailable')
    const stub = stubSettingsScope<DigestSettings>()
    policy.bind(stub.scope)
    await policy.setNavBadges(false)
    await policy.setNavFinishedBadge(true)
    await policy.setNavBadgeOrder(['running', 'waiting'])
    expect(stub.set.mock.calls).toEqual([
      ['navBadges', false], ['navFinishedBadge', true], ['navBadgeOrder', ['running', 'waiting', 'unread', 'failed']],
    ])
  })
})

type SectionCalls = {
  setNavBadges: ReturnType<typeof vi.fn<(show: boolean) => Promise<void>>>
  setNavFinishedBadge: ReturnType<typeof vi.fn<(show: boolean) => Promise<void>>>
  setNavBadgeOrder: ReturnType<typeof vi.fn<(order: readonly NavBadgeState[]) => Promise<void>>>
}

function mount(view: Partial<NavSettingsView> = {}, over: Partial<SectionCalls> = {}) {
  const state: NavSettingsView = { status: 'ready', writable: true, navBadges: true, navFinishedBadge: false, navBadgeOrder: DEFAULT_ORDER, ...view }
  const calls: SectionCalls = {
    setNavBadges: vi.fn<(show: boolean) => Promise<void>>(async () => undefined),
    setNavFinishedBadge: vi.fn<(show: boolean) => Promise<void>>(async () => undefined),
    setNavBadgeOrder: vi.fn<(order: readonly NavBadgeState[]) => Promise<void>>(async () => undefined),
    ...over,
  }
  const props = {
    close: vi.fn(),
    useNavSettings: ((selector: (s: NavSettingsView) => unknown) => selector(state)),
    ...calls,
    t,
  } as unknown as DigestSettingsSectionProps
  render(<DigestSettingsSection {...props} />)
  return calls
}

/** The order list's rows, by state key. */
function rows(): string[] {
  return [...document.querySelectorAll<HTMLElement>('li[data-state]')].map(row => row.dataset['state'] ?? '')
}

describe('DigestSettingsSection', () => {
  it('writes the two toggles, and the finished toggle follows the badges toggle', () => {
    const c = mount()
    const [badges, finished] = screen.getAllByRole('checkbox') as HTMLInputElement[]
    fireEvent.click(badges!)
    expect(c.setNavBadges).toHaveBeenCalledWith(false)
    fireEvent.click(finished!)
    expect(c.setNavFinishedBadge).toHaveBeenCalledWith(true)
    cleanup()
    mount({ navBadges: false })
    expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).disabled).toBe(true)
  })

  it('lists the order with localized names and moves rows with the buttons', () => {
    const c = mount()
    expect(rows()).toEqual(DEFAULT_ORDER)
    expect(screen.getByText(zh['digestSettings.state.waiting'])).toBeTruthy()
    const up = screen.getAllByRole('button', { name: /上移/ }) as HTMLButtonElement[]
    const down = screen.getAllByRole('button', { name: /下移/ }) as HTMLButtonElement[]
    expect(up[0]!.disabled).toBe(true)
    expect(down[3]!.disabled).toBe(true)
    fireEvent.click(down[0]!)
    expect(c.setNavBadgeOrder).toHaveBeenLastCalledWith(['unread', 'waiting', 'running', 'failed'])
    fireEvent.click(up[3]!)
    expect(c.setNavBadgeOrder).toHaveBeenLastCalledWith(['waiting', 'unread', 'failed', 'running'])
    const reset = screen.getByRole('button', { name: zh['digestSettings.order.reset'] }) as HTMLButtonElement
    expect(reset.disabled).toBe(true)
    cleanup()
    const custom = mount({ navBadgeOrder: ['failed', 'waiting', 'unread', 'running'] })
    fireEvent.click(screen.getByRole('button', { name: zh['digestSettings.order.reset'] }))
    expect(custom.setNavBadgeOrder).toHaveBeenLastCalledWith(DEFAULT_ORDER)
  })

  it('reorders by dragging a row onto another, and ignores drops without a drag or onto itself', () => {
    const c = mount()
    const [waiting, , running, failed] = document.querySelectorAll<HTMLElement>('li[data-state]')
    const transfer = { effectAllowed: '' }
    // A drop or hover with nothing in flight changes nothing.
    fireEvent.dragOver(running!, { dataTransfer: transfer })
    fireEvent.drop(running!)
    expect(c.setNavBadgeOrder).not.toHaveBeenCalled()
    expect(running!.className).not.toContain('sortOver')
    fireEvent.dragStart(waiting!, { dataTransfer: transfer })
    fireEvent.dragOver(running!, { dataTransfer: transfer })
    fireEvent.dragOver(running!, { dataTransfer: transfer })
    expect(running!.className).toContain('sortOver')
    // Leaving a row that is not the hovered one keeps the mark.
    fireEvent.dragLeave(failed!)
    expect(running!.className).toContain('sortOver')
    fireEvent.dragLeave(running!)
    expect(running!.className).not.toContain('sortOver')
    fireEvent.dragOver(failed!, { dataTransfer: transfer })
    fireEvent.drop(failed!)
    expect(c.setNavBadgeOrder).toHaveBeenLastCalledWith(['unread', 'running', 'failed', 'waiting'])
    // Dropping a row onto itself is a no-op; dragEnd clears the marks.
    fireEvent.dragStart(running!, { dataTransfer: transfer })
    fireEvent.dragOver(running!, { dataTransfer: transfer })
    fireEvent.drop(running!)
    expect(c.setNavBadgeOrder).toHaveBeenCalledTimes(1)
    fireEvent.dragStart(running!, { dataTransfer: transfer })
    fireEvent.dragEnd(running!)
    expect(running!.className).not.toContain('sortDragging')
  })

  it('disables every control while loading or read-only, and reports a failed write', async () => {
    vi.useFakeTimers()
    mount({ status: 'loading' })
    expect(screen.getByText(zh['settings.loading'])).toBeTruthy()
    for (const box of screen.getAllByRole('checkbox') as HTMLInputElement[]) expect(box.disabled).toBe(true)
    cleanup()
    mount({ writable: false })
    expect(screen.getByText(zh['settings.unavailable'])).toBeTruthy()
    const row = document.querySelector<HTMLElement>('li[data-state]')!
    expect(row.getAttribute('draggable')).toBe('false')
    fireEvent.dragStart(row, { dataTransfer: { effectAllowed: '' } })
    expect(row.className).not.toContain('sortDragging')
    cleanup()
    mount({}, { setNavBadges: vi.fn<(show: boolean) => Promise<void>>(async () => { throw new Error('denied') }) })
    fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('alert').textContent).toBe('保存失败：denied')
    act(() => { vi.advanceTimersByTime(4_000) })
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    // A non-Error rejection is reported by its text.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error rejection is the arm under test
    mount({}, { setNavFinishedBadge: vi.fn<(show: boolean) => Promise<void>>(() => Promise.reject('nope')) })
    fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('alert').textContent).toBe('保存失败：nope')
  })
})
