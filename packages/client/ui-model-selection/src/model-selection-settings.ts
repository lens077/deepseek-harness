/** Model selection preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the model selection surfaces. */
export const MODEL_SELECTION_SETTINGS_NAMESPACE = 'ui-model-selection'

/** Field carrying whether the quick-switch strip renders above the composer. */
export const QUICK_SWITCH_FIELD = 'quickSwitch'

/** Default shows the strip: it renders nothing until a second model has been used. */
export const DEFAULT_QUICK_SWITCH = true

/** Field carrying the most recently selected models, newest first. */
export const RECENT_MODELS_FIELD = 'recentModels'

/**
 * How many recent models the strip keeps. Five pills fit beside the composer's
 * right edge at the narrowest desktop width without wrapping; older entries
 * are evicted rather than wrapped onto a second line.
 */
export const RECENT_MODELS_LIMIT = 5

/** One remembered selection: provider, provider-owned model id, and the effort it was last used with. */
export interface RecentModel {
  provider: string
  model: string
  reasoningEffort?: string
}

/** Durable model selection section shared by the Host schema and browser scope. */
export interface ModelSelectionSettings {
  /** Whether the quick-switch strip renders above the composer. */
  quickSwitch: boolean
  /** Most recently selected models, newest first, at most {@link RECENT_MODELS_LIMIT}. */
  recentModels: RecentModel[]
}

/** Durable model selection schema; also the wire envelope the browser scope validates against. */
export const ModelSelectionSettingsSchema: z<ModelSelectionSettings> = z.object({
  [QUICK_SWITCH_FIELD]: z.boolean().default(DEFAULT_QUICK_SWITCH),
  [RECENT_MODELS_FIELD]: z.array(z.object({
    provider: z.string().required(),
    model: z.string().required(),
    reasoningEffort: z.string(),
  })).default([]),
})

/** Whether two entries name the same provider/model route, whatever effort each carries. */
function sameRoute(left: RecentModel, right: RecentModel): boolean {
  return left.provider === right.provider && left.model === right.model
}

/**
 * Fold one accepted selection into the recent list. The selection moves to
 * the front; the route it replaced follows so a first switch already offers
 * the way back; one entry per route keeps the effort it was last used with;
 * the list is cut at {@link RECENT_MODELS_LIMIT}.
 * @param recent - the list before the selection.
 * @param selection - the selection the Host accepted.
 * @param previous - the route current before the selection, when known.
 * @returns the new list, or the same reference when nothing changed.
 */
export function rememberRecentModel(
  recent: readonly RecentModel[],
  selection: RecentModel,
  previous: RecentModel | null,
): readonly RecentModel[] {
  const head: RecentModel[] = [selection]
  if (previous !== null && !sameRoute(previous, selection)) head.push(previous)
  const next = [
    ...head,
    ...recent.filter(entry => !head.some(kept => sameRoute(kept, entry))),
  ].slice(0, RECENT_MODELS_LIMIT)
  const unchanged = next.length === recent.length && next.every((entry, index) => {
    const before = recent[index]
    return before !== undefined && sameRoute(entry, before) && entry.reasoningEffort === before.reasoningEffort
  })
  return unchanged ? recent : next
}
