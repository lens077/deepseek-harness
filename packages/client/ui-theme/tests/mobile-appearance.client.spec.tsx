// @vitest-environment jsdom
/** Phone appearance persistence, desktop isolation, and accessible live controls. */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { useSyncExternalStore, type ComponentProps } from 'react'
import { Context } from '@deepseek-ai/cordis'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeSettingsSchema, type ThemeSettings } from '../src/theme-settings.ts'
import { MobileAppearancePolicy } from '../src/client/mobile-appearance.ts'
import { MobileAppearanceRows } from '../src/client/MobileAppearanceRows.tsx'
import { ThemeRuntime } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); localStorage.clear() })

const defaults = { preference: 'system', fontSize: 14, mobileFontSize: 16, mobileLayout: 'medium' }

describe('phone appearance preferences', () => {
  it('defaults phone settings independently of the existing desktop preference', () => {
    expect(ThemeSettingsSchema({})).toEqual(defaults)
    expect(ThemeSettingsSchema({ preference: 'dark', fontSize: 17 })).toEqual({ ...defaults, preference: 'dark', fontSize: 17 })
    for (const mobileFontSize of [12, 16, 22]) expect(ThemeSettingsSchema({ mobileFontSize }).mobileFontSize).toBe(mobileFontSize)
    // @ts-expect-error -- Serialized settings can contain nonnumeric font values.
    for (const mobileFontSize of [11, 23, 16.5, '18']) expect(() => ThemeSettingsSchema({ mobileFontSize })).toThrow()
    for (const mobileLayout of ['large', 'medium', 'small'] as const) expect(ThemeSettingsSchema({ mobileLayout }).mobileLayout).toBe(mobileLayout)
    // @ts-expect-error -- Serialized settings can contain an unsupported layout id.
    expect(() => ThemeSettingsSchema({ mobileLayout: 'compact' })).toThrow()
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
    expect(mobile.appearance.getSnapshot()).toEqual({ mobileFontSize: 20, mobileLayout: 'small' })
    expect(theme.getTheme()).toBe(desktop)
    expect(host.set.mock.calls).toEqual([['mobileFontSize', 20], ['mobileLayout', 'large'], ['mobileLayout', 'small']])
    mobile.setFontSize(20)
    mobile.setLayout('small')
    expect(host.set).toHaveBeenCalledTimes(3)
    host.publish({ value: ThemeSettingsSchema({ mobileFontSize: 18, mobileLayout: 'medium', fontSize: 17 }) })
    expect(mobile.appearance.getSnapshot()).toEqual({ mobileFontSize: 18, mobileLayout: 'medium' })
    expect(theme.getTheme().fontSize).toBe(17)
    expect(host.set).toHaveBeenCalledTimes(3)
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
    expect(JSON.parse(localStorage.getItem('dsh.mobile.appearance')!)).toEqual({ mobileFontSize: 19, mobileLayout: 'small' })
    expect(new MobileAppearancePolicy(host.scope).appearance.getSnapshot()).toEqual({ mobileFontSize: 19, mobileLayout: 'small' })
    expect(host.set).not.toHaveBeenCalled()
    const localHost = stubSettingsScope<ThemeSettings>()
    expect(new MobileAppearancePolicy(localHost.scope).appearance.getSnapshot()).toEqual({ mobileFontSize: 16, mobileLayout: 'medium' })
  })

  it('validates browser-stored phone fields before using them', () => {
    const host = stubSettingsScope<ThemeSettings>()
    host.publish({ mode: 'memory', status: 'unavailable' })
    localStorage.setItem('dsh.mobile.appearance', JSON.stringify({ mobileFontSize: 100, mobileLayout: 'unknown' }))
    expect(new MobileAppearancePolicy(host.scope).appearance.getSnapshot()).toEqual({ mobileFontSize: 16, mobileLayout: 'medium' })
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
      t: makeTranslate(en),
    } as ComponentProps<typeof MobileAppearanceRows>
    const view = render(<MobileAppearanceRows {...props} />)
    expect(view.getByRole('radio', { name: /^Medium/ }).getAttribute('checked')).not.toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Increase mobile font size' }))
    fireEvent.click(view.getByRole('radio', { name: /^Large/ }))
    fireEvent.click(view.getByRole('radio', { name: /^Small/ }))
    expect(view.getByText('17 px')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Decrease mobile font size' }))
    expect(view.getByText('16 px')).toBeTruthy()
    act(() => { policy.setFontSize(22) })
    expect((view.getByRole('button', { name: 'Increase mobile font size' }) as HTMLButtonElement).disabled).toBe(true)
    act(() => { policy.setFontSize(12) })
    expect((view.getByRole('button', { name: 'Decrease mobile font size' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
