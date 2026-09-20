/** General Settings row for the transcript's right-hand action control size. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ACTION_CONTROL_SIZE_MAX, ACTION_CONTROL_SIZE_MIN } from '../../chat-settings.ts'
import css from './ActionControlSizeRow.module.css'

/** Registration-side control-size face. */
export interface ActionControlSizeRowInjected {
  hooks: {
    /** Persisted control edge length bound as useActionControlSize. */
    actionControlSize: SnapshotStore<number>
  }
  /** Zoom the controls by whole steps; positive enlarges, negative shrinks. */
  zoomActionControls: (steps: number) => void
}

/** Full Settings-row props. */
export type ActionControlSizeRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<ActionControlSizeRowInjected>

/**
 * Render the right-hand action control zoom stepper, reading its current edge
 * length in CSS pixels.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function ActionControlSizeRow({ useActionControlSize, zoomActionControls, t }: ActionControlSizeRowProps) {
  const size = useActionControlSize(value => value)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.actionSize.title')}</div>
        <div className={css.desc}>{t('settings.actionSize.description')}</div>
      </div>
      <div className={css.stepper}>
        <button
          type="button"
          className={css.step}
          disabled={size <= ACTION_CONTROL_SIZE_MIN}
          aria-label={t('settings.actionSize.shrink')}
          onClick={() => { zoomActionControls(-1) }}
        />
        <span className={css.value} aria-live="polite">{t('settings.actionSize.value', { px: size })}</span>
        <button
          type="button"
          className={`${css.step} ${css.stepIn}`}
          disabled={size >= ACTION_CONTROL_SIZE_MAX}
          aria-label={t('settings.actionSize.enlarge')}
          onClick={() => { zoomActionControls(1) }}
        />
      </div>
    </div>
  )
}
