/** Independent task-flow font controls for Settings and the resident header. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconChevronDownOutline14, IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '../settings.ts'
import type { TaskFlowTranslate } from './format.ts'
import type { FlowStyle } from './style-policy.ts'
import css from './FlowStyleRow.module.css'

/** Registration-side font preference face. */
export interface FlowFontSizeRowInjected {
  hooks: { flowStyle: SnapshotStore<FlowStyle> }
  /** Change task-flow text size in CSS pixels. */
  setFontSize: (fontSize: number) => void
}

/** Settings row inputs from the renderer. */
export type FlowFontSizeRowProps = PropsRuntime<'settings.general.item'> & PropsLocale<'taskFlow'> & InjectFace<FlowFontSizeRowInjected>

/**
 * Render bounded font controls with keyboard-accessible buttons.
 * @param props - current pixel size, writer, and localized labels.
 * @returns the font-size control group.
 */
export function FlowFontControls({ fontSize, setFontSize, t }: {
  fontSize: number
  setFontSize: (fontSize: number) => void
  t: TaskFlowTranslate
}) {
  return (
    <div className={css.fontControl} role="group" aria-label={t('settings.fontSize.title')}>
      <button type="button" className={css.fontButton} aria-label={t('fontSize.decrease')} disabled={fontSize <= FONT_SIZE_MIN} onClick={() => { setFontSize(fontSize - 1) }}>
        <IconChevronDownOutline14 />
      </button>
      <span className={css.fontValue}>{t('fontSize.value', { size: fontSize })}</span>
      <button type="button" className={css.fontButton} aria-label={t('fontSize.increase')} disabled={fontSize >= FONT_SIZE_MAX} onClick={() => { setFontSize(fontSize + 1) }}>
        <IconChevronUpOutline14 />
      </button>
    </div>
  )
}

/**
 * Render the independent font-size preference in General Settings.
 * @param props - settings slot inputs and preference writer.
 * @returns the font-size row.
 */
export function FlowFontSizeRow({ useFlowStyle, setFontSize, t }: FlowFontSizeRowProps) {
  const fontSize = useFlowStyle(style => style.fontSize)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.fontSize.title')}</div>
        <div className={css.desc}>{t('settings.fontSize.description')}</div>
      </div>
      <FlowFontControls fontSize={fontSize} setFontSize={setFontSize} t={t} />
    </div>
  )
}
