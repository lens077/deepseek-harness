import { createSnapshotStore, type SettingsScope, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_QUESTION_NAVIGATION_SETTINGS, type ConversationSettings, type QuestionNavigationSettings,
} from '../../submission-settings.ts'

/**
 * Live question-navigation shortcut preference for the conversation plugin.
 *
 * The durable value lives in the host settings scope; this holds the browser-side
 * snapshot so render code binds one source. Without a host scope the policy stays
 * in memory, which is the shape component tests use.
 */
export class QuestionNavigationPolicy {
  /** Current bindings and focus policy, seeded with the platform defaults. */
  readonly settings: SnapshotStore<QuestionNavigationSettings> = createSnapshotStore(DEFAULT_QUESTION_NAVIGATION_SETTINGS)

  constructor(private readonly host?: SettingsScope<ConversationSettings>) {
    if (typeof navigator !== 'undefined' && navigator.platform.toLocaleLowerCase().includes('mac')) {
      this.settings.set({ ...DEFAULT_QUESTION_NAVIGATION_SETTINGS, previousShortcut: 'Meta+ArrowUp', nextShortcut: 'Meta+ArrowDown' })
    }
    if (host !== undefined) {
      host.subscribe(() => { this.adopt() })
      this.adopt()
    }
  }

  /**
   * Publish a new preference locally and persist it to the host scope.
   *
   * @param settings Complete replacement value; partial updates are the caller's job.
   */
  set(settings: QuestionNavigationSettings): void {
    this.settings.set(settings)
    void this.host?.set('questionNavigation', settings)
  }

  /** Restore the platform default bindings and focus policy. */
  reset(): void {
    const mac = typeof navigator !== 'undefined' && navigator.platform.toLocaleLowerCase().includes('mac')
    this.set(mac
      ? { ...DEFAULT_QUESTION_NAVIGATION_SETTINGS, previousShortcut: 'Meta+ArrowUp', nextShortcut: 'Meta+ArrowDown' }
      : DEFAULT_QUESTION_NAVIGATION_SETTINGS)
  }

  private adopt(): void {
    const value = this.host?.getSnapshot().value?.questionNavigation
    if (value !== undefined) this.settings.set(value)
  }
}
