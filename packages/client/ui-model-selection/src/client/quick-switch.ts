/**
 * Host-backed quick-switch preference: whether the strip renders and which
 * models it offers. One policy serves the composer strip, the Settings row,
 * and the two selection entries that record accepted selections.
 */

import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_QUICK_SWITCH, QUICK_SWITCH_FIELD, RECENT_MODELS_FIELD, rememberRecentModel,
  type ModelSelectionSettings, type RecentModel,
} from '../model-selection-settings.ts'
import type { ModelDirectoryState } from './directory.ts'

/** The strip's live inputs: the toggle and the recent list, newest first. */
export interface QuickSwitchState {
  readonly enabled: boolean
  readonly recent: readonly RecentModel[]
}

/** One pill of the strip: a remembered selection resolved against the loaded catalog. */
export interface QuickModelChip {
  /** Stable row key (`provider/model`). */
  readonly key: string
  /** The complete selection the pill submits. */
  readonly selection: ModelSelection
  /** Catalog display name of the model. */
  readonly name: string
  /** Display name of the remembered effort; absent when the model advertises no efforts. */
  readonly effort?: string
  /** Whether the pill names the session's current route. */
  readonly active: boolean
}

/**
 * Resolve the recent list against the session's directory. A remembered
 * route the loaded groups no longer advertise yields no pill; a remembered
 * effort the model no longer advertises is dropped so the pill submits the
 * model's default instead of a selection the Host would refuse. A pill whose
 * route the session already runs is marked active.
 * @param directory - the session's directory snapshot.
 * @param recent - remembered selections, newest first.
 * @returns pills in recent order.
 */
export function quickModelChips(
  directory: ModelDirectoryState,
  recent: readonly RecentModel[],
): readonly QuickModelChip[] {
  const chips: QuickModelChip[] = []
  for (const entry of recent) {
    const group = directory.groups.find(candidate => candidate.id === entry.provider)
    const model = group?.models.find(candidate => candidate.id === entry.model)
    if (group === undefined || model === undefined) continue
    const effort = entry.reasoningEffort === undefined
      ? undefined
      : model.reasoning?.efforts.find(level => level.id === entry.reasoningEffort)
    chips.push({
      key: `${group.id}/${model.id}`,
      selection: {
        provider: group.id,
        model: model.id,
        ...effort === undefined ? {} : { reasoningEffort: effort.id },
      },
      name: model.name,
      ...effort === undefined ? {} : { effort: effort.name },
      active: directory.current?.provider === group.id && directory.current.model === model.id,
    })
  }
  return chips
}

/** Live quick-switch preference consumed by the strip, its Settings row, and the selection entries. */
export class QuickSwitchPolicy {
  /** Reactive current state; shows an empty strip until Host settings arrive. */
  readonly state: SnapshotStore<QuickSwitchState> = createSnapshotStore<QuickSwitchState>({
    enabled: DEFAULT_QUICK_SWITCH,
    recent: [],
  })

  /**
   * @param host - durable model selection settings scope.
   */
  constructor(private readonly host: SettingsScope<ModelSelectionSettings>) {
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish and persist the toggle.
   * @param enabled - whether the strip renders above the composer.
   */
  setEnabled(enabled: boolean): void {
    const current = this.state.getSnapshot()
    if (current.enabled === enabled) return
    this.state.set({ ...current, enabled })
    void this.host.set(QUICK_SWITCH_FIELD, enabled)
  }

  /**
   * Fold one Host-accepted selection into the recent list and persist it.
   * @param selection - the accepted selection.
   * @param previous - the route current before the selection, when known.
   */
  record(selection: RecentModel, previous: RecentModel | null): void {
    const current = this.state.getSnapshot()
    const next = rememberRecentModel(current.recent, selection, previous)
    if (next === current.recent) return
    this.state.set({ ...current, recent: next })
    void this.host.set(RECENT_MODELS_FIELD, [...next])
  }

  /** Adopt the latest accepted Host section without writing it back. */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    const current = this.state.getSnapshot()
    if (current.enabled === section.quickSwitch && sameList(current.recent, section.recentModels)) return
    this.state.set({ enabled: section.quickSwitch, recent: section.recentModels })
  }
}

function sameList(left: readonly RecentModel[], right: readonly RecentModel[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index]
    return other !== undefined
      && entry.provider === other.provider
      && entry.model === other.model
      && entry.reasoningEffort === other.reasoningEffort
  })
}
