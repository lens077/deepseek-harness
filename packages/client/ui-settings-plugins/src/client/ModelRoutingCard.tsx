/** The model router's switch on the Models page: whether prompts are routed to another model or effort at all. */

import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the Models page's SlotMap merge (the 'settings.models.footer' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { ModelRoutingCardFace } from './model-routing-card-controller.ts'
import css from './ModelRoutingCard.module.css'

/** Props the renderer binds for the model-routing switch. */
export type ModelRoutingCardProps =
  PropsRuntime<'settings.models.footer'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<ModelRoutingCardFace>

/**
 * Render the model-routing switch as one row after the provider rows, or
 * nothing while no router is mounted.
 * @param props - locale copy, the switch snapshot, and its toggle action.
 * @returns the row, or null.
 */
export function ModelRoutingCard(props: ModelRoutingCardProps) {
  const { t } = props
  const state = props.useModelRoutingCard(snapshot => snapshot)
  if (!state.available) return null
  return (
    <section className={css.card} aria-label={t('modelRoutingTitle')}>
      <div className={css.head}>
        <div className={css.identity}>
          <span className={css.name}>{t('modelRoutingTitle')}</span>
          <span className={css.description}>{t('modelRoutingDescription')}</span>
        </div>
        <Switch
          checked={state.enabled}
          label={t('modelRoutingToggle')}
          disabled={!state.writable || state.saving}
          onChange={props.toggle}
        />
      </div>
      <p className={css.hint}>{t(state.enabled ? 'modelRoutingOnHint' : 'modelRoutingOffHint')}</p>
      {state.failed ? <p className={css.failed} role="alert">{t('modelRoutingWriteFailed')}</p> : null}
    </section>
  )
}
