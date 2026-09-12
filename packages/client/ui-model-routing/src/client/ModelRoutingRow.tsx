/** The Models page row: whether prompts are routed to another model or effort at all. */

import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the Models page's SlotMap merge (the 'settings.models.footer' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { ModelRoutingFace } from './controller.ts'
import css from './ModelRoutingRow.module.css'

/** Props the renderer binds for the Models-page row. */
export type ModelRoutingRowProps =
  PropsRuntime<'settings.models.footer'>
  & PropsLocale<'modelRouting'>
  & InjectFace<ModelRoutingFace>

/**
 * Render the model-routing switch as one row after the provider rows, or
 * nothing while no router is mounted.
 * @param props - locale copy, the switch snapshot, and its toggle action.
 * @returns the row, or null.
 */
export function ModelRoutingRow(props: ModelRoutingRowProps) {
  const { t } = props
  const state = props.useModelRouting(snapshot => snapshot)
  if (!state.available) return null
  return (
    <section className={css.card} aria-label={t('title')}>
      <div className={css.head}>
        <div className={css.identity}>
          <span className={css.name}>{t('title')}</span>
          <span className={css.description}>{t('description')}</span>
        </div>
        <Switch
          checked={state.enabled}
          label={t('toggle')}
          disabled={!state.writable || state.saving}
          onChange={props.toggle}
        />
      </div>
      <p className={css.hint}>{t(state.enabled ? 'onHint' : 'offHint')}</p>
      {state.failed ? <p className={css.failed} role="alert">{t('writeFailed')}</p> : null}
    </section>
  )
}
