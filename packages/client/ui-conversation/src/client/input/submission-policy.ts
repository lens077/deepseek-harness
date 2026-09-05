/** Composer keyboard preferences and queue/steer delivery policy. */
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {
  BusyEnterBehavior, ComposerSubmitGesture, InputSubmitMode,
} from '../contract/composer-submission.ts'
import { BUSY_ENTER_FIELD, DEFAULT_BUSY_ENTER_BEHAVIOR } from '../../submission-settings.ts'
import type { ConversationSettings, SendShortcut } from '../../submission-settings.ts'
import { matchesSendShortcut, type ShortcutKeyEvent } from '../../send-shortcut.ts'

export { DEFAULT_BUSY_ENTER_BEHAVIOR } from '../../submission-settings.ts'

/**
 * Keyboard policy shared by the composer and General Settings.
 * AgentLoop turns a closed-window steer submission into the next waking Queue item.
 */
export class ComposerSubmissionPolicy {
  /** Reactive busy-state delivery preference. */
  readonly busyEnter: SnapshotStore<BusyEnterBehavior> = createSnapshotStore(DEFAULT_BUSY_ENTER_BEHAVIOR)
  /** Reactive send shortcut preference. */
  readonly sendShortcut: SnapshotStore<SendShortcut> = createSnapshotStore('enter')
  private readonly host: SettingsScope<ConversationSettings> | undefined

  /**
   * @param host - durable preference scope; absent compositions stay process-local.
   * The adoption subscription shares the scope's plugin lifetime.
   */
  constructor(host?: SettingsScope<ConversationSettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Classify a keydown against the current shortcut without changing state.
   * @param event - keyboard facts after editor composition guarding.
   * @returns the matched delivery gesture, or null for ordinary editor behavior.
   */
  resolveGesture(event: ShortcutKeyEvent): ComposerSubmitGesture | null {
    const shortcut = this.sendShortcut.getSnapshot()
    if (!matchesSendShortcut(shortcut, event)) return null
    if (shortcut !== 'enter' && shortcut !== 'mod-enter') return 'custom'
    return event.ctrlKey === true || event.metaKey === true ? 'accelerated' : 'enter'
  }

  /**
   * Resolve delivery for a send gesture without changing state.
   * @param running - whether the addressed agent currently reports busy.
   * @param gesture - preset Enter gesture or an explicitly matched custom chord.
   * @param steeringAvailable - whether this session transport supports steering.
   * @returns Queue when idle or steering is unavailable; otherwise the preferred mode,
   * except that Ctrl/Cmd+Enter selects its opposite in Enter-to-send mode.
   */
  resolve(running: boolean, gesture: ComposerSubmitGesture, steeringAvailable: boolean): InputSubmitMode {
    if (!running || !steeringAvailable) return 'queue'
    const preferred = this.busyEnter.getSnapshot()
    if (gesture !== 'accelerated' || this.sendShortcut.getSnapshot() !== 'enter') return preferred
    return preferred === 'queue' ? 'steer' : 'queue'
  }

  /**
   * Publish and persist the busy-state delivery preference.
   * @param behavior - Queue or Steer.
   */
  setBusyEnter(behavior: BusyEnterBehavior): void {
    if (this.busyEnter.getSnapshot() === behavior) return
    this.busyEnter.set(behavior)
    void this.host?.set(BUSY_ENTER_FIELD, behavior)
  }

  /**
   * Publish and persist the send shortcut preference.
   * @param shortcut - validated legacy preset or canonical custom chord.
   */
  setSendShortcut(shortcut: SendShortcut): void {
    if (this.sendShortcut.getSnapshot() === shortcut) return
    this.sendShortcut.set(shortcut)
    void this.host?.set('sendShortcut', shortcut)
  }

  /**
   * Adopt accepted durable preferences without writing them back.
   * @param host - the scope driving adoption.
   */
  private adopt(host: SettingsScope<ConversationSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined) return
    this.busyEnter.set(section.busyEnter)
    this.sendShortcut.set(section.sendShortcut)
  }
}
