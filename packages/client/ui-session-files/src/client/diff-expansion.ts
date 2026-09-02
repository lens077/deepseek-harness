/**
 * Section-field policies: one live preference of the durable session-files
 * section, the value a Settings row writes and other surfaces read.
 * Durability is optional — a composition without a settings provider keeps
 * the preference process-local, the same arrangement the composer's
 * busy-Enter policy uses.
 */

import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_DIFF_EXPANSION, DIFF_EXPANSION_FIELD,
  type DiffExpansion, type SessionFilesSettings,
} from '../diff-settings.ts'

export { DEFAULT_DIFF_EXPANSION, DIFF_EXPANSIONS, type DiffExpansion } from '../diff-settings.ts'

/** Owns one live scalar preference of the session-files section and its durable adoption. */
export class SectionFieldPolicy<T> {
  /** Reactive preference source read by the Settings row and its consumers. */
  readonly value: SnapshotStore<T>
  private readonly host: SettingsScope<SessionFilesSettings> | undefined

  /**
   * @param field - section field the durable write targets.
   * @param initial - shipped default until a durable value is adopted; also
   * the reading of an accepted section missing this field (a Host still
   * serving the section from before the field existed vouches for no choice).
   * @param read - selects this preference from the accepted section.
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime, so the policy needs no release hook.
   */
  constructor(
    private readonly field: keyof SessionFilesSettings,
    private readonly initial: T,
    private readonly read: (section: SessionFilesSettings) => T | undefined,
    host?: SettingsScope<SessionFilesSettings>,
  ) {
    this.value = createSnapshotStore<T>(initial)
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Change the preference; the live value moves at once and the durable
   * write follows.
   * @param next - the value the reader picked.
   */
  set(next: T): void {
    if (this.value.getSnapshot() === next) return
    this.value.set(next)
    void this.host?.set(this.field, next)
  }

  /**
   * Adopt the scope's accepted durable value without writing it back.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: SettingsScope<SessionFilesSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined) return
    const next = this.read(section) ?? this.initial
    if (this.value.getSnapshot() === next) return
    this.value.set(next)
  }
}

/** Owns the live inline-diff expansion preference read by the transcript's chips. */
export class DiffExpansionPolicy extends SectionFieldPolicy<DiffExpansion> {
  /** @param host - durable preference scope; omitted stays process-local. */
  constructor(host?: SettingsScope<SessionFilesSettings>) {
    super(DIFF_EXPANSION_FIELD, DEFAULT_DIFF_EXPANSION, section => section.diffExpansion, host)
  }

  /** Reactive preference source read by the Settings row and the chips. */
  get expansion(): SnapshotStore<DiffExpansion> {
    return this.value
  }
}
