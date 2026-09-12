/** The composer tool row's model-routing chip: the same switch, where the model seat sits. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the composer tool row).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ModelRoutingFace } from './controller.ts'
import css from './ModelRoutingChip.module.css'

/** Props the renderer binds for the composer chip. */
export type ModelRoutingChipProps =
  PropsRuntime<'conversation.input.right'>
  & PropsLocale<'modelRouting'>
  & InjectFace<ModelRoutingFace>

/**
 * Render the routing state as a pressable chip beside the model seat, or
 * nothing while no router is mounted. One click is one settings write.
 * @param props - locale copy, the switch snapshot, and its toggle action.
 * @returns the chip, or null.
 */
export function ModelRoutingChip(props: ModelRoutingChipProps) {
  const { t } = props
  const state = props.useModelRouting(snapshot => snapshot)
  if (!state.available) return null
  return (
    <button
      type="button"
      className={css.chip}
      role="switch"
      aria-checked={state.enabled}
      aria-label={t('toggle')}
      title={t(state.enabled ? 'chipOnTitle' : 'chipOffTitle')}
      data-state={state.enabled ? 'on' : 'off'}
      disabled={!state.writable || state.saving}
      onClick={() => { props.toggle(!state.enabled) }}
    >
      <IconBranchOutline16 size={14} className={css.icon} />
      <span className={css.label}>{t(state.enabled ? 'chipOn' : 'chipOff')}</span>
    </button>
  )
}
