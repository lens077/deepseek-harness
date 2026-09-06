/**
 * Conversation content-width policy. It owns the live width-mode preference:
 * `fill` keeps the transcript at 100% of the content area (the default);
 * `adaptive` enables the draggable side handles with the adaptive clamp.
 */
import {
  createSnapshotStore, type SnapshotStore,
} from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CONTENT_WIDTH_FIELD, DEFAULT_CONTENT_WIDTH_MODE,
} from '../../submission-settings.ts'
import type { ContentWidthMode, ConversationSettings } from '../../submission-settings.ts'

/** Width-mode policy used by both the shell inject face and its Settings row. */
export class ContentWidthPolicy {
  /** Reactive preference source for the shell and the Settings row. */
  readonly mode: SnapshotStore<ContentWidthMode> = createSnapshotStore(DEFAULT_CONTENT_WIDTH_MODE)
  private readonly host: SettingsScope<ConversationSettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime — a disposed scope never publishes again, so
   * the policy needs no release hook.
   */
  constructor(host?: SettingsScope<ConversationSettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Change the content-width mode; the live value publishes before the
   * durable write starts.
   * @param mode - fill (100% of the content area) or adaptive (draggable).
   */
  setMode(mode: ContentWidthMode): void {
    if (this.mode.getSnapshot() === mode) return
    this.mode.set(mode)
    void this.host?.set(CONTENT_WIDTH_FIELD, mode)
  }

  /**
   * Adopt the scope's accepted durable mode without writing it back.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: SettingsScope<ConversationSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined || this.mode.getSnapshot() === section.contentWidth) return
    this.mode.set(section.contentWidth)
  }
}
