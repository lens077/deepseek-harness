/**
 * Inline-diff expansion policy: the live preference the Settings row writes and
 * the transcript's produced-file chips read. Durability is optional — a
 * composition without a settings provider keeps the preference process-local,
 * the same arrangement the composer's busy-Enter policy uses.
 */

import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_DIFF_EXPANSION, DIFF_EXPANSION_FIELD,
  type DiffExpansion, type SessionFilesSettings,
} from '../diff-settings.ts'

export { DEFAULT_DIFF_EXPANSION, DIFF_EXPANSIONS, type DiffExpansion } from '../diff-settings.ts'

/** Owns the live expansion preference and its durable adoption. */
export class DiffExpansionPolicy {
  /** Reactive preference source read by the Settings row and the chips. */
  readonly expansion: SnapshotStore<DiffExpansion> = createSnapshotStore<DiffExpansion>(DEFAULT_DIFF_EXPANSION)
  private readonly host: SettingsScope<SessionFilesSettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime, so the policy needs no release hook.
   */
  constructor(host?: SettingsScope<SessionFilesSettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Change how much of a turn's diffs opens by default; the live value moves
   * at once and the durable write follows.
   * @param expansion - the mode the reader picked.
   */
  set(expansion: DiffExpansion): void {
    if (this.expansion.getSnapshot() === expansion) return
    this.expansion.set(expansion)
    void this.host?.set(DIFF_EXPANSION_FIELD, expansion)
  }

  /**
   * Adopt the scope's accepted durable value without writing it back.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: SettingsScope<SessionFilesSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined || this.expansion.getSnapshot() === section.diffExpansion) return
    this.expansion.set(section.diffExpansion)
  }
}
