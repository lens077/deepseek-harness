/** The model-routing card's staged form over the `model-routing` settings namespace. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { CardForm, booleanField, type CardActions, type CardFieldState, type CardShell } from './card-form.ts'

/**
 * Namespace of the mounted model router's user-owned settings. Spelled here
 * rather than imported: a client package must not depend on a Host package.
 */
export const MODEL_ROUTING_NS = 'model-routing'

/** The model-routing field this card edits. */
export interface ModelRoutingSettings {
  /** Whether prompts consult the router; off keeps every Session on the route its person selected. */
  enabled?: boolean
}

/** What the model-routing card renders. */
export interface ModelRoutingCardState extends CardShell {
  /** The routing switch, staged as `true` or `false`. */
  enabled: CardFieldState
}

/** The registration-side face the model-routing card's slot entry injects. */
export interface ModelRoutingCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useModelRoutingCard. */
    modelRoutingCard: SnapshotStore<ModelRoutingCardState>
  }
}

/** Bridges the `model-routing` scope onto the card's staged form. */
export class ModelRoutingCardController {
  private readonly form: CardForm<ModelRoutingSettings>
  private readonly store: SnapshotStore<ModelRoutingCardState>

  /** @param scope - the bound settings scope for the `model-routing` namespace. */
  constructor(scope: SettingsScope<ModelRoutingSettings>) {
    this.form = new CardForm(scope, [booleanField('enabled')])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): ModelRoutingCardState {
    return { ...this.form.shell(), enabled: this.form.field('enabled') }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): ModelRoutingCardFace {
    return { hooks: { modelRoutingCard: this.store }, ...this.form.actions() }
  }
}
