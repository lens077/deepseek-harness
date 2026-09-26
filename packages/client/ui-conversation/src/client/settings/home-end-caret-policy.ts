/**
 * Preference behind the document-level Home/End listener: whether those keys
 * move the caret in the GUI's text fields outside the composer, or keep the
 * browser's default.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_HOME_END_CARET, HOME_END_CARET_FIELD } from '../../submission-settings.ts'
import type { ConversationSettings } from '../../submission-settings.ts'

/** Live text-field caret preference for the shell inject face and its Settings row. */
export class HomeEndCaretPolicy {
  /** Reactive preference source, seeded with the default. */
  readonly enabled: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_HOME_END_CARET)
  private readonly host: SettingsScope<ConversationSettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime, so the policy needs no release hook.
   */
  constructor(host?: SettingsScope<ConversationSettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Change the preference; the live value publishes before the durable write.
   * @param enabled - whether Home/End move the caret in other text fields.
   */
  set(enabled: boolean): void {
    if (this.enabled.getSnapshot() === enabled) return
    this.enabled.set(enabled)
    void this.host?.set(HOME_END_CARET_FIELD, enabled)
  }

  /**
   * Adopt the scope's accepted durable value without writing it back.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: SettingsScope<ConversationSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined || this.enabled.getSnapshot() === section.homeEndInTextFields) return
    this.enabled.set(section.homeEndInTextFields)
  }
}
