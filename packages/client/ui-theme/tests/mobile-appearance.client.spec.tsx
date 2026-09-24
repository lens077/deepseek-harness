// @vitest-environment jsdom
/** Phone appearance persistence, desktop isolation, and accessible live controls. */
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { useSyncExternalStore, type ComponentProps } from 'react'
import { Context } from '@deepseek-ai/cordis'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeSettingsSchema, type ThemeSettings } from '../src/theme-settings.ts'
import { MobileAppearancePolicy } from '../src/client/mobile-appearance.ts'
import { MobileAppearanceRows } from '../src/client/MobileAppearanceRows.tsx'
import { PureUiRow } from '../src/client/PureUiRow.tsx'
import { ThemeRuntime } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); localStorage.clear() })

const defaults = {
  preference: 'system', fontSize: 14, mobileFontSize: 16,
  mobileLayout: 'medium', desktopLayout: 'medium', pureUi: false,
}

const defaultAppearance = {
  mobileFontSize: 16, mobileLayout: 'medium', desktopLayout: 'medium', pureUi: false,
}

describe('phone appearance preferences', () => {
  it('defaults phone settings independently of the existing desktop preference', () => {
    expect(ThemeSettingsSchema({})).toEqual(defaults)
    expect(ThemeSettingsSchema({ preference: 'dark', fontSize: 17 })).toEqual({ ...defaults, preference: 'dark', fontSize: 17 })
    for (const mobileFontSize of [12, 16, 22]) expect(ThemeSettingsSchema({ mobileFontSize }).mobileFontSize).toBe(mobileFontSize)
    // @ts-expect-error -- Serialized settings can contain nonnumeric font values.
    for (const mobileFontSize of [11, 23, 16.5, '18']) expect(() => ThemeSettingsSchema({ mobileFontSize })).toThrow()
    for (const mobileLayout of ['large', 'medium', 'small'] as const) expect(ThemeSettingsSchema({ mobileLayout }).mobileLayout).toBe(mobileLayout)
    for (const desktopLayout of ['large', 'medium', 'small'] as const) expect(ThemeSettingsSchema({ desktopLayout }).desktopLayout).toBe(desktopLayout)
    // @ts-expect-error -- Serialized settings can contain an unsupported layout id.
    expect(() => ThemeSettingsSchema({ mobileLayout: 'compact' })).toThrow()
    expect(ThemeSettingsSchema({ pureUi: true }).pureUi).toBe(true)
    // @ts-expect-error -- Serialized settings can carry a non-boolean switch value.
    expect(() => ThemeSettingsSchema({ pureUi: 'yes' })).toThrow()
  })

  it('persists font and layout separately without publishing a desktop theme change', () => {
    const host = stubSettingsScope<ThemeSettings>()
    const ctx = new Context()
    const theme = new ThemeRuntime(ctx, host.scope)
    const desktop = theme.getTheme()
    const mobile = theme.mobile
    mobile.setFontSize(20)
    mobile.setLayout('large')
    mobile.setLayout('small')
    mobile.setDesktopLayout('large')
    mobile.setPureUi(true)
    expect(mobile.appearance.getSnapshot()).toEqual({
      mobileFontSize: 20, mobileLayout: 'small', desktopLayout: 'large', pureUi: true,
    })
    expect(theme.getTheme()).toBe(desktop)
    expect(host.set.mock.calls).toEqual([
      ['mobileFontSize', 20], ['mobileLayout', 'large'], ['mobileLayout', 'small'],
      ['desktopLayout', 'large'], ['pureUi', true],
    ])
    mobile.setFontSize(20)
    mobile.setLayout('small')
    mobile.setDesktopLayout('large')
    mobile.setPureUi(true)
    expect(host.set).toHaveBeenCalledTimes(5)
    host.publish({ value: ThemeSettingsSchema({ mobileFontSize: 18, mobileLayout: 'medium', fontSize: 17 }) })
    expect(mobile.appearance.getSnapshot()).toEqual({ ...defaultAppearance, mobileFontSize: 18 })
    expect(theme.getTheme().fontSize).toBe(17)
    expect(host.set).toHaveBeenCalledTimes(5)
    const accepted = mobile.appearance.getSnapshot()
    host.publish({ revision: 2 })
    expect(mobile.appearance.getSnapshot()).toBe(accepted)
  })

  it('retains only phone settings across remote browser instances without a Host write', () => {
    const host = stubSettingsScope<ThemeSettings>()
    host.publish({ mode: 'memory', status: 'unavailable' })
    const first = new MobileAppearancePolicy(host.scope)
    first.setFontSize(19)
    first.setLayout('small')
    first.setPureUi(true)
    expect(JSON.parse(localStorage.getItem('dsh.mobile.appearance')!)).toEqual({
      mobileFontSize: 19, mobileLayout: 'small', desktopLayout: 'medium', pureUi: true,
    })
    expect(new MobileAppearancePolicy(host.scope).appearance.getSnapshot()).toEqual({
      mobileFontSize: 19, mobileLayout: 'small', desktopLayout: 'medium', pureUi: true,
    })
    expect(host.set).not.toHaveBeenCalled()
    const localHost = stubSettingsScope<ThemeSettings>()
    expect(new MobileAppearancePolicy(localHost.scope).appearance.getSnapshot()).toEqual(defaultAppearance)
  })

  it('validates browser-stored phone fields before using them', () => {
    const host = stubSettingsScope<ThemeSettings>()
    host.publish({ mode: 'memory', status: 'unavailable' })
    localStorage.setItem('dsh.mobile.appearance', JSON.stringify({ mobileFontSize: 100, mobileLayout: 'unknown' }))
    expect(new MobileAppearancePolicy(host.scope).appearance.getSnapshot()).toEqual(defaultAppearance)
  })

  it('shows three labeled layouts and preserves a chosen font while switching density', () => {
    const host = stubSettingsScope<ThemeSettings>()
    const policy = new MobileAppearancePolicy(host.scope)
    const useMobileAppearance: ComponentProps<typeof MobileAppearanceRows>['useMobileAppearance'] = selector =>
      selector(useSyncExternalStore(policy.appearance.subscribe, policy.appearance.getSnapshot))
    const props = {
      useMobileAppearance,
      setMobileFontSize: (value: number) => { policy.setFontSize(value) },
      setMobileLayout: (value: ThemeSettings['mobileLayout']) => { policy.setLayout(value) },
      setDesktopLayout: (value: ThemeSettings['desktopLayout']) => { policy.setDesktopLayout(value) },
      t: makeTranslate(en),
    } as ComponentProps<typeof MobileAppearanceRows>
    const view = render(<MobileAppearanceRows {...props} />)
    const phone = view.getByRole('group', { name: 'Phone layout' })
    const desktop = view.getByRole('group', { name: 'Desktop layout' })
    expect(within(phone).getByRole('radio', { name: /^Medium/ }).getAttribute('checked')).not.toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Increase mobile font size' }))
    fireEvent.click(within(phone).getByRole('radio', { name: /^Large/ }))
    fireEvent.click(within(phone).getByRole('radio', { name: /^Small/ }))
    fireEvent.click(within(desktop).getByRole('radio', { name: /^Spacious/ }))
    expect(policy.appearance.getSnapshot().desktopLayout).toBe('large')
    expect(view.getByText('17 px')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Decrease mobile font size' }))
    expect(view.getByText('16 px')).toBeTruthy()
    act(() => { policy.setFontSize(22) })
    expect((view.getByRole('button', { name: 'Increase mobile font size' }) as HTMLButtonElement).disabled).toBe(true)
    act(() => { policy.setFontSize(12) })
    expect((view.getByRole('button', { name: 'Decrease mobile font size' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('the pure-UI row echoes the persisted switch and writes through the policy', () => {
    const host = stubSettingsScope<ThemeSettings>()
    const policy = new MobileAppearancePolicy(host.scope)
    const useMobileAppearance: ComponentProps<typeof PureUiRow>['useMobileAppearance'] = selector =>
      selector(useSyncExternalStore(fn => policy.appearance.subscribe(fn), () => policy.appearance.getSnapshot()))
    const props = {
      useMobileAppearance,
      setPureUi: (enabled: boolean) => { policy.setPureUi(enabled) },
      t: makeTranslate(en),
    } as ComponentProps<typeof PureUiRow>
    const view = render(<PureUiRow {...props} />)
    const toggle = view.getByRole('switch', { name: 'Pure UI' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(policy.appearance.getSnapshot().pureUi).toBe(true)
    expect(host.set).toHaveBeenCalledWith('pureUi', true)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    act(() => { policy.setPureUi(false) })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })
})
