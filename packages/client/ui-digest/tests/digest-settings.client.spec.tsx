// @vitest-environment jsdom
/**
 * The digest panel settings: the policy standing on defaults until a scope
 * binds it, mirroring the scope while bound, and routing repaired writes; and
 * the settings page over direct props — the chord recorder, the two toggles,
 * the order list reordered by drag and by buttons, the resets, and the
 * disabled and failure states.
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
      status: 'unavailable', navBadges: true, navFinishedBadge: false, navBadgeOrder: DEFAULT_ORDER, toggleShortcut: 'Ctrl+1', writable: false,
      readAcknowledgement: 'automatic', readGraceSeconds: 5,
    })
    const stub = stubSettingsScope<DigestSettings>()
    const detach = policy.bind(stub.scope)
    expect(policy.view.getSnapshot()).toMatchObject({ status: 'loading', navBadges: true })
    stub.publish({ status: 'ready', writable: true, value: { navBadges: false, navFinishedBadge: true, navBadgeOrder: ['failed', 'failed'], toggleShortcut: 'Alt+D', readAcknowledgement: 'manual', readGraceSeconds: 12 } })
    // A repeated or missing state in the document is repaired for display.
    expect(policy.view.getSnapshot()).toEqual({
      status: 'ready', writable: true, navBadges: false, navFinishedBadge: true, navBadgeOrder: ['failed', 'waiting', 'unread', 'running'], toggleShortcut: 'Alt+D',
      readAcknowledgement: 'manual', readGraceSeconds: 12,
    })
    // A hand-written chord the schema pattern admits but editing owns reads as the default.
    stub.publish({ status: 'ready', writable: true, value: { navBadges: false, navFinishedBadge: true, navBadgeOrder: DEFAULT_ORDER, toggleShortcut: 'Ctrl+C', readAcknowledgement: 'automatic', readGraceSeconds: 20 } })
    expect(policy.view.getSnapshot()).toMatchObject({ toggleShortcut: 'Ctrl+1' })
    stub.publish({ status: 'unavailable', value: undefined, writable: false })
    expect(policy.view.getSnapshot()).toMatchObject({ status: 'unavailable', navBadges: false, navBadgeOrder: DEFAULT_ORDER, toggleShortcut: 'Ctrl+1', readAcknowledgement: 'automatic', readGraceSeconds: 20 })
    detach()
    expect(stub.listenerCount()).toBe(0)
    expect(policy.view.getSnapshot()).toMatchObject({ status: 'unavailable', navBadges: true, navBadgeOrder: DEFAULT_ORDER, readAcknowledgement: 'automatic', readGraceSeconds: 5 })
  })

  it('routes repaired writes to the scope and rejects writes while unbound', async () => {
    const policy = new NavSettingsPolicy()
    await expect(policy.setNavBadges(false)).rejects.toThrow('unavailable')
    await expect(policy.setReadAcknowledgement('manual')).rejects.toThrow('unavailable')
    await expect(policy.setReadGraceSeconds(12)).rejects.toThrow('unavailable')
    const stub = stubSettingsScope<DigestSettings>()
    policy.bind(stub.scope)
    await policy.setNavBadges(false)
    await policy.setNavFinishedBadge(true)
    await policy.setNavBadgeOrder(['running', 'waiting'])
    await policy.setToggleShortcut('F2')
    await policy.setReadAcknowledgement('manual')
    await policy.setReadGraceSeconds(12)
    expect(stub.set.mock.calls).toEqual([
      ['navBadges', false], ['navFinishedBadge', true], ['navBadgeOrder', ['running', 'waiting', 'unread', 'failed']], ['toggleShortcut', 'F2'],
      ['readAcknowledgement', 'manual'], ['readGraceSeconds', 12],
    ])
  })
})

type SectionCalls = {
  setNavBadges: ReturnType<typeof vi.fn<(show: boolean) => Promise<void>>>
  setNavFinishedBadge: ReturnType<typeof vi.fn<(show: boolean) => Promise<void>>>
  setNavBadgeOrder: ReturnType<typeof vi.fn<(order: readonly NavBadgeState[]) => Promise<void>>>
  setToggleShortcut: ReturnType<typeof vi.fn<(shortcut: string) => Promise<void>>>
  setReadAcknowledgement: ReturnType<typeof vi.fn<(mode: DigestSettings['readAcknowledgement']) => Promise<void>>>
  setReadGraceSeconds: ReturnType<typeof vi.fn<(seconds: number) => Promise<void>>>
}

function mount(view: Partial<NavSettingsView> = {}, over: Partial<SectionCalls> = {}) {
  const state: NavSettingsView = { status: 'ready', writable: true, navBadges: true, navFinishedBadge: false, navBadgeOrder: DEFAULT_ORDER, toggleShortcut: 'Ctrl+1', readAcknowledgement: 'automatic', readGraceSeconds: 5, ...view }
  const calls: SectionCalls = {
    setNavBadges: vi.fn<(show: boolean) => Promise<void>>(async () => undefined),
    setNavFinishedBadge: vi.fn<(show: boolean) => Promise<void>>(async () => undefined),
    setNavBadgeOrder: vi.fn<(order: readonly NavBadgeState[]) => Promise<void>>(async () => undefined),
    setToggleShortcut: vi.fn<(shortcut: string) => Promise<void>>(async () => undefined),
    setReadAcknowledgement: vi.fn<(mode: DigestSettings['readAcknowledgement']) => Promise<void>>(async () => undefined),
    setReadGraceSeconds: vi.fn<(seconds: number) => Promise<void>>(async () => undefined),
    ...over,
  }
  const props = {
    close: vi.fn(),
    useNavSettings: ((selector: (s: NavSettingsView) => unknown) => selector(state)),
    ...calls,
    t,
  } as unknown as DigestSettingsSectionProps
  const rendered = render(<DigestSettingsSection {...props} />)
  return {
    ...calls,
    update(next: Partial<NavSettingsView>): void {
      Object.assign(state, next)
      rendered.rerender(<DigestSettingsSection {...props} />)
    },
  }
}

/** The order list's rows, by state key. */
function rows(): string[] {
  return [...document.querySelectorAll<HTMLElement>('li[data-state]')].map(row => row.dataset['state'] ?? '')
}

describe('DigestSettingsSection', () => {
  it('records the toggle chord from a press, refuses owned and unsupported keys, and resets to the default', () => {
    const c = mount({ toggleShortcut: 'F2' })
    const field = screen.getByLabelText(zh['digestSettings.shortcut']) as HTMLInputElement
    expect(field.value).toBe('F2')
    // A bare F-key is off inside text fields; the page says so.
    expect(screen.getByText(zh['digestSettings.shortcut.plain'])).toBeTruthy()
    // A modifier alone is a transient press; nothing is written or refused.
    fireEvent.keyDown(field, { key: 'Control', ctrlKey: true })
    expect(c.setToggleShortcut).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'c', code: 'KeyC', ctrlKey: true })
    expect(screen.getByRole('alert').textContent).toBe(zh['digestSettings.shortcut.reserved'])
    fireEvent.keyDown(field, { key: ';', code: 'Semicolon', ctrlKey: true })
    expect(screen.getByRole('alert').textContent).toBe(zh['digestSettings.shortcut.unsupported'])
    fireEvent.keyDown(field, { key: 'I', code: 'KeyI', ctrlKey: true, shiftKey: true })
    expect(c.setToggleShortcut).toHaveBeenLastCalledWith('Ctrl+Shift+I')
    expect(screen.queryByRole('alert')).toBeNull()
    // Pressing the chord already stored writes nothing.
    fireEvent.keyDown(field, { key: 'F2', code: 'F2' })
    expect(c.setToggleShortcut).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(field, { key: 'Tab', code: 'Tab' })
    fireEvent.blur(field)
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '恢复默认 Ctrl+1' }))
    expect(c.setToggleShortcut).toHaveBeenLastCalledWith('Ctrl+1')
    cleanup()
    mount()
    expect((screen.getByRole('button', { name: '恢复默认 Ctrl+1' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(zh['digestSettings.shortcut.plain'])).toBeNull()
  })

  it('offers automatic and manual acknowledgement and explains foreground-visible time without implying handled', () => {
    const c = mount()
    const mode = screen.getByRole('combobox', { name: '查看确认方式' }) as HTMLSelectElement
    expect(mode.value).toBe('automatic')
    expect([...mode.options].map(option => [option.value, option.textContent])).toEqual([
      ['automatic', '自动标记已查看'], ['manual', '手动标记已查看'],
    ])
    const hint = screen.getByText('自动模式仅计算答案在前台页面中可见的时间；切到后台或答案不可见时不计时。手动模式需点击「标记已查看」。已查看不代表已处理。')
    expect(mode.getAttribute('aria-describedby')).toBe(hint.id)
    fireEvent.change(mode, { target: { value: 'manual' } })
    expect(c.setReadAcknowledgement).toHaveBeenCalledWith('manual')
    cleanup()
    const manual = mount({ readAcknowledgement: 'manual', readGraceSeconds: 12 })
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '查看确认方式' }).value).toBe('manual')
    const seconds = screen.getByRole('spinbutton', { name: '自动标记前的等待时间（秒）' }) as HTMLInputElement
    expect(seconds.disabled).toBe(true)
    expect(seconds.value).toBe('12')
    fireEvent.change(screen.getByRole('combobox', { name: '查看确认方式' }), { target: { value: 'automatic' } })
    expect(manual.setReadAcknowledgement).toHaveBeenCalledWith('automatic')
  })

  it('commits changed whole seconds on blur, not while typing, including both bounds', () => {
    const c = mount()
    const seconds = screen.getByRole('spinbutton', { name: '自动标记前的等待时间（秒）' }) as HTMLInputElement
    expect(seconds.value).toBe('5')
    expect([seconds.min, seconds.max, seconds.step]).toEqual(['1', '60', '1'])
    fireEvent.blur(seconds)
    expect(c.setReadGraceSeconds).not.toHaveBeenCalled()
    fireEvent.change(seconds, { target: { value: '12' } })
    fireEvent.change(seconds, { target: { value: '5' } })
    fireEvent.blur(seconds)
    expect(c.setReadGraceSeconds).not.toHaveBeenCalled()
    for (const value of ['12', '1', '60']) {
      c.setReadGraceSeconds.mockClear()
      fireEvent.change(seconds, { target: { value } })
      expect(seconds.value).toBe(value)
      expect(c.setReadGraceSeconds).not.toHaveBeenCalled()
      fireEvent.blur(seconds)
      expect(c.setReadGraceSeconds).toHaveBeenCalledWith(Number(value))
    }
  })

  it.each(['', '0', '61', '2.5'])('refuses an invalid grace period %j without writing it', (value) => {
    const c = mount({ readGraceSeconds: 12 })
    const seconds = screen.getByRole('spinbutton', { name: '自动标记前的等待时间（秒）' }) as HTMLInputElement
    fireEvent.change(seconds, { target: { value } })
    fireEvent.blur(seconds)
    expect(c.setReadGraceSeconds).not.toHaveBeenCalled()
    expect(seconds.value).toBe('12')
    expect(screen.getByRole('alert').textContent).toBe('请输入 1–60 之间的整数秒数。')
  })

  it.each([
    { status: 'loading' as const }, { status: 'unavailable' as const }, { writable: false },
  ])('disables reading controls when settings cannot be written: %j', (view) => {
    mount(view)
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '查看确认方式' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: '自动标记前的等待时间（秒）' }).disabled).toBe(true)
  })

  it.each([
    { writable: false }, { readAcknowledgement: 'manual' as const },
  ])('discards a grace draft when settings become disabled before blur: %j', (view) => {
    const c = mount()
    const seconds = screen.getByRole<HTMLInputElement>('spinbutton', { name: '自动标记前的等待时间（秒）' })
    fireEvent.change(seconds, { target: { value: '12' } })
    c.update(view)
    fireEvent.blur(seconds)
    expect(seconds.disabled).toBe(true)
    expect(seconds.value).toBe('5')
    expect(c.setReadGraceSeconds).not.toHaveBeenCalled()
  })

  it('shows updated persisted seconds after the draft is committed', () => {
    const c = mount()
    const seconds = screen.getByRole<HTMLInputElement>('spinbutton', { name: '自动标记前的等待时间（秒）' })
    c.update({ readGraceSeconds: 20 })
    expect(seconds.value).toBe('20')
    fireEvent.change(seconds, { target: { value: '12' } })
    fireEvent.blur(seconds)
    c.update({ readGraceSeconds: 12 })
    expect(seconds.value).toBe('12')
  })

  it('reports failed acknowledgement and grace-period writes', async () => {
    mount({}, { setReadAcknowledgement: vi.fn(async () => { throw new Error('denied') }) })
    fireEvent.change(screen.getByRole('combobox', { name: '查看确认方式' }), { target: { value: 'manual' } })
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('alert').textContent).toBe('保存失败：denied')
    cleanup()
    mount({}, { setReadGraceSeconds: vi.fn(async () => { throw new Error('refused') }) })
    const seconds = screen.getByRole('spinbutton', { name: '自动标记前的等待时间（秒）' }) as HTMLInputElement
    fireEvent.change(seconds, { target: { value: '12' } })
    fireEvent.blur(seconds)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('alert').textContent).toBe('保存失败：refused')
    expect(seconds.value).toBe('5')
  })

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
    expect((screen.getByLabelText(zh['digestSettings.shortcut']) as HTMLInputElement).disabled).toBe(true)
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
    cleanup()
    mount({}, { setToggleShortcut: vi.fn<(shortcut: string) => Promise<void>>(async () => { throw new Error('denied') }) })
    fireEvent.keyDown(screen.getByLabelText(zh['digestSettings.shortcut']), { key: 'F2', code: 'F2' })
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('alert').textContent).toBe('保存失败：denied')
  })
})
