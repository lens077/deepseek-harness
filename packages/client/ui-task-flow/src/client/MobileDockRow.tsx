/** Phone-only opt-in for the resident task-flow strip. */
import { useId } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MobileDockRow.module.css'

/** Framework-bound visibility source and task-flow-owned write callback. */
export interface MobileDockRowInjected {
  hooks: { mobileDock: ObservableSnapshot<boolean> }
  setMobileDock: (enabled: boolean) => void
}

type MobileDockRowProps = PropsRuntime<'settings.general.item'>
  & PropsLocale<'taskFlow'> & InjectFace<MobileDockRowInjected>

/**
 * Render the opt-in phone task-flow setting without affecting desktop settings.
 * @param props - composed settings row props.
 * @returns the phone-only labeled checkbox.
 */
export function MobileDockRow({ useMobileDock, setMobileDock, t }: MobileDockRowProps) {
  const enabled = useMobileDock(value => value)
  const id = useId()
  return (
    <label className={css.row} data-mobile-task-flow-setting>
      <span className={css.text}>
        <span className={css.title} id={`${id}-title`}>{t('settings.mobileDock.title')}</span>
        <span className={css.description} id={`${id}-description`}>{t('settings.mobileDock.description')}</span>
      </span>
      <span className={css.control}>
        <input type="checkbox" checked={enabled} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
          onChange={(event) => { setMobileDock(event.currentTarget.checked) }} />
      </span>
    </label>
  )
}
