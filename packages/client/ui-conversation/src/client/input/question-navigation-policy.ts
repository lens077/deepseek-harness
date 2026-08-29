import { createSnapshotStore, type SettingsScope, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_QUESTION_NAVIGATION_SETTINGS, type ConversationSettings, type QuestionNavigationSettings,
} from '../../submission-settings.ts'

export class QuestionNavigationPolicy {
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

  set(settings: QuestionNavigationSettings): void {
    this.settings.set(settings)
    void this.host?.set('questionNavigation', settings)
  }

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
