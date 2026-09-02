/**
 * Files-surface visibility policy: the live preference deciding whether the
 * Files control and rail hold their seats at all. The apply body gates both
 * seat registrations on it, so `hide` returns the tab row and view area to
 * their unoccupied shapes — the same shapes composing this plugin out leaves.
 */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_RAIL_VISIBILITY, RAIL_VISIBILITY_FIELD,
  type RailVisibility, type SessionFilesSettings,
} from '../diff-settings.ts'
import { SectionFieldPolicy } from './diff-expansion.ts'

export { DEFAULT_RAIL_VISIBILITY, RAIL_VISIBILITIES, type RailVisibility } from '../diff-settings.ts'

/** Owns the live Files-surface visibility preference and its durable adoption. */
export class RailVisibilityPolicy extends SectionFieldPolicy<RailVisibility> {
  /** @param host - durable preference scope; omitted stays process-local. */
  constructor(host?: SettingsScope<SessionFilesSettings>) {
    super(RAIL_VISIBILITY_FIELD, DEFAULT_RAIL_VISIBILITY, section => section.railVisibility, host)
  }

  /** Reactive visibility read by the seat gate and the Settings row. */
  get visibility(): SnapshotStore<RailVisibility> {
    return this.value
  }
}
