/**
 * The composer tool row's agent-preset label.
 *
 * Read-only by construction: a session's composition is fixed once its
 * conversation starts, and the label only shows after that. Offering a
 * control here would promise a switch the host refuses; naming what the
 * session runs is the honest affordance, and the choice itself lives on the
 * new-session screen ({@link AgentPresetSeat}). It sits in the tool row beside
 * the model select, next to the other per-session run facts, so the session
 * title keeps the header width to itself.
 */

import { useEffect } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the composer tool row).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AgentPresetSettingsState } from './settings-store.ts'
import { presetDisplayText } from './locales.ts'
import css from './AgentPresetLabel.module.css'

/** Registration-side business face for the composer label. */
export interface AgentPresetLabelInjected {
  hooks: {
    /** Roster snapshot bound by the renderer as useAgentPresets. */
    agentPresets: SnapshotStore<AgentPresetSettingsState>
  }
  /** Read the roster, so the label can show a name rather than an id. */
  load: () => Promise<void>
}

/** Full component props. */
export type AgentPresetLabelProps =
  PropsRuntime<'conversation.input.right'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetLabelInjected>

/**
 * Render this session's agent-preset name in the composer tool row.
 * @param props - composed slot props.
 * @returns the label, or null while the session is blank (the new-session
 * chip still owns the choice) or records no preset.
 */
export function AgentPresetLabel({
  sessionId, useSessions, useAgentPresets, load, t,
}: AgentPresetLabelProps) {
  const summary = useSessions(state => state.byId[sessionId])
  const options = useAgentPresets(state => state.options)
  // A blank session still shows the hero chip, which already names the staged
  // preset and lets the user change it; a second copy in the composer would
  // read as a control that is not one.
  const preset = summary === undefined || summary.blank ? undefined : summary.agentPreset

  useEffect(() => {
    // Deployments that compose no presets never label anything, so the roster
    // is only worth a request once a session reports one.
    if (preset !== undefined) void load()
  }, [preset, load])

  if (preset === undefined) return null

  const option = options.find(entry => entry.id === preset)
  const text = option === undefined ? undefined : presetDisplayText(option, t)
  return (
    <span className={css.label} title={text?.description ?? t('headerHint')}>
      <IconAgentPresetOutline16 size={14} className={css.icon} />
      <span className={css.name}>{text?.name ?? preset}</span>
    </span>
  )
}
