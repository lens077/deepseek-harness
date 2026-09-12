/** Phone-only appearance controls in the theme-owned General Settings rows. */
import { useId } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { IconChevronDownOutline14, IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { MOBILE_FONT_SIZE_MAX, MOBILE_FONT_SIZE_MIN, MOBILE_LAYOUTS, type MobileLayout } from '../theme-settings.ts'
import type { MobileAppearance } from './mobile-appearance.ts'
import css from './MobileAppearanceRows.module.css'

/** Theme-owned observable and independent phone preference writes. */
export interface MobileAppearanceRowsInjected {
  hooks: { mobileAppearance: ObservableSnapshot<MobileAppearance> }
  setMobileFontSize: (fontSize: number) => void
  setMobileLayout: (layout: MobileLayout) => void
}

type MobileAppearanceRowsProps = PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.theme'> & InjectFace<MobileAppearanceRowsInjected>

/**
 * Render accessible density choices and a phone-only font stepper.
 * @param props - framework-bound theme settings props.
 * @returns the phone settings group, hidden in the desktop layout.
 */
export function MobileAppearanceRows({ useMobileAppearance, setMobileFontSize, setMobileLayout, t }: MobileAppearanceRowsProps) {
  const { mobileLayout: layout, mobileFontSize: fontSize } = useMobileAppearance(value => value)
  const id = useId()
  return (
    <section className={css.group} aria-labelledby={`${id}-title`} data-mobile-appearance>
      <div>
        <h3 className={css.heading} id={`${id}-title`}>{t('mobile.title')}</h3>
        <p className={css.description}>{t('mobile.description')}</p>
      </div>
      <fieldset className={css.layouts}>
        <legend className={css.label}>{t('mobile.layout')}</legend>
        {MOBILE_LAYOUTS.map(value => (
          <label className={css.option} key={value}>
            <input type="radio" name={`${id}-layout`} value={value} checked={layout === value}
              onChange={() => { setMobileLayout(value) }} />
            <span className={css.optionText}>
              <span className={css.label}>{t(`mobile.layout.${value}`)}</span>
              <span className={css.description}>{t(`mobile.layout.${value}.description`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className={css.fontRow}>
        <div className={css.fontText}>
          <span className={css.label} id={`${id}-font`}>{t('mobile.fontSize')}</span>
          <p className={css.description}>{t('mobile.fontSize.description')}</p>
        </div>
        <div className={css.stepper} role="group" aria-labelledby={`${id}-font`}>
          <button type="button" className={css.step} aria-label={t('mobile.fontSize.decrease')}
            disabled={fontSize <= MOBILE_FONT_SIZE_MIN} onClick={() => { setMobileFontSize(fontSize - 1) }}>
            <IconChevronDownOutline14 size={18} />
          </button>
          <output className={css.value} aria-live="polite">{t('mobile.fontSize.value', { size: fontSize })}</output>
          <button type="button" className={css.step} aria-label={t('mobile.fontSize.increase')}
            disabled={fontSize >= MOBILE_FONT_SIZE_MAX} onClick={() => { setMobileFontSize(fontSize + 1) }}>
            <IconChevronUpOutline14 size={18} />
          </button>
        </div>
      </div>
    </section>
  )
}
