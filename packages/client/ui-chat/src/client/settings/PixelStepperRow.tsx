/** General Settings row for one adjustable pixel preference of the Chat view. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatKey } from '../locale.ts'
import css from './PixelStepperRow.module.css'

/** The copy and bounds one preference gives its row. */
export interface PixelPreferenceDescriptor {
  /** Row heading. */
  readonly title: ChatKey
  /** Row explanation. */
  readonly description: ChatKey
  /** Accessible label of the shrink step. */
  readonly shrink: ChatKey
  /** Accessible label of the enlarge step. */
  readonly enlarge: ChatKey
  /** Smallest accepted value; the shrink step disables here. */
  readonly min: number
  /** Largest accepted value; the enlarge step disables here. */
  readonly max: number
}

/** Registration-side pixel-preference face. */
export interface PixelStepperRowInjected {
  hooks: {
    /** Persisted value in CSS pixels, bound as usePixelValue. */
    pixelValue: SnapshotStore<number>
  }
  /** Zoom the preference by whole steps; positive enlarges, negative shrinks. */
  zoomPixels: (steps: number) => void
  /** Which preference this row edits. */
  preference: PixelPreferenceDescriptor
}

/** Full Settings-row props. */
export type PixelStepperRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<PixelStepperRowInjected>

/**
 * Render one pixel preference as a zoom stepper reading its current value in
 * CSS pixels.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function PixelStepperRow({ usePixelValue, zoomPixels, preference, t }: PixelStepperRowProps) {
  const value = usePixelValue(current => current)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t(preference.title)}</div>
        <div className={css.desc}>{t(preference.description)}</div>
      </div>
      <div className={css.stepper}>
        <button
          type="button"
          className={css.step}
          disabled={value <= preference.min}
          aria-label={t(preference.shrink)}
          onClick={() => { zoomPixels(-1) }}
        />
        <span className={css.value} aria-live="polite">{t('settings.pixels', { px: value })}</span>
        <button
          type="button"
          className={`${css.step} ${css.stepIn}`}
          disabled={value >= preference.max}
          aria-label={t(preference.enlarge)}
          onClick={() => { zoomPixels(1) }}
        />
      </div>
    </div>
  )
}
