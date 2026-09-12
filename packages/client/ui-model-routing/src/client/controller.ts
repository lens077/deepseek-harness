/** The model-routing switch over the `model-routing` settings namespace, written on toggle and shared by both surfaces. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/**
 * Namespace of the mounted model router's user-owned settings. Spelled here
 * rather than imported: a client package must not depend on a Host package.
 */
export const MODEL_ROUTING_NS = 'model-routing'

/** The model-routing field this switch edits. */
export interface ModelRoutingSettings {
  /** Whether prompts consult the router; off keeps every Session on the route its person selected. */
  enabled?: boolean
}

/** What both model-routing surfaces render. */
export interface ModelRoutingState {
  /** False while the namespace is not served to this client, which means no router is mounted; the card renders nothing. */
  available: boolean
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Effective switch position; an absent value inherits the composition default, which is on. */
  enabled: boolean
  /** Whether a write is crossing the wire. */
  saving: boolean
  /** Whether the last write did not land; cleared by the next toggle. */
  failed: boolean
}

/** The registration-side face both model-routing entries inject. */
export interface ModelRoutingFace {
  hooks: {
    /** Switch snapshot bound by the renderer as useModelRouting. */
    modelRouting: SnapshotStore<ModelRoutingState>
  }
  /** Write the switch position; one toggle is one settings write, with no staging. */
  toggle: (next: boolean) => void
}

/**
 * Bridges the `model-routing` scope onto one switch. A single boolean needs no
 * draft: the Host answers by republishing the scope, and a write that did not
 * land reports `failed` while the switch keeps showing the Host's value.
 */
export class ModelRoutingController {
  private readonly store: SnapshotStore<ModelRoutingState>
  private saving = false
  private failed = false

  /** @param scope - the bound settings scope for the `model-routing` namespace. */
  constructor(private readonly scope: SettingsScope<ModelRoutingSettings>) {
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { this.publish() })
  }

  private projection(): ModelRoutingState {
    const snapshot = this.scope.getSnapshot()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      enabled: snapshot.value?.enabled !== false,
      saving: this.saving,
      failed: this.failed,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  /**
   * Build the face each slot registration injects.
   * @returns the switch snapshot and its toggle action.
   */
  inject(): ModelRoutingFace {
    return {
      hooks: { modelRouting: this.store },
      toggle: (next) => { void this.write(next) },
    }
  }

  private async write(next: boolean): Promise<void> {
    if (this.saving) return
    this.saving = true
    this.failed = false
    this.publish()
    try {
      await this.scope.set('enabled', next)
      this.failed = this.scope.getSnapshot().value?.enabled !== next
    } catch {
      // The scope owns the transport diagnostic; the switch only reports that the write did not land.
      this.failed = true
    }
    this.saving = false
    this.publish()
  }
}
