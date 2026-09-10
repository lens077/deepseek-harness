/** The model router's card: whether prompts are routed to another model or effort at all. */

import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PluginCard } from './PluginCard.tsx'
import type { ModelRoutingCardFace } from './model-routing-card-controller.ts'
import type {} from './slot-contract.ts'
import css from './ModelRoutingCard.module.css'

/** Props the renderer binds for the model-routing card. */
export type ModelRoutingCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<ModelRoutingCardFace>

/**
 * Render the model-routing card: one switch, staged until saved.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function ModelRoutingCard(props: ModelRoutingCardProps) {
  const { t } = props
  const state = props.useModelRoutingCard(snapshot => snapshot)
  // An absent value inherits the composition default, which is on.
  const enabled = state.enabled.text !== 'false'
  return (
    <PluginCard
      t={t}
      titleKey="modelRoutingTitle"
      descriptionKey="modelRoutingDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <div className={css.toggleRow}>
        <span className={css.toggleLabel}>{t('modelRoutingToggle')}</span>
        <Switch
          checked={enabled}
          label={t('modelRoutingToggle')}
          disabled={!state.writable || state.saving}
          onChange={(next) => { props.edit('enabled', next ? 'true' : 'false') }}
        />
      </div>
      <p className={css.hint}>{t(enabled ? 'modelRoutingOnHint' : 'modelRoutingOffHint')}</p>
    </PluginCard>
  )
}
