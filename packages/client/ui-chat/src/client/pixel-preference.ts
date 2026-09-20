/** Host-backed policy shared by the Chat view's adjustable pixel preferences. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { clampPixelPreference, type ChatSettings, type PixelRange } from '../chat-settings.ts'

/** The `ChatSettings` fields this policy can carry: the numeric ones. */
type PixelField = {
  [Field in keyof ChatSettings]: ChatSettings[Field] extends number ? Field : never
}[keyof ChatSettings]

/** Live pixel preference consumed by the Chat view and its Settings row. */
export class PixelPreferencePolicy {
  /** Reactive current value in CSS pixels; the range's default until Host settings arrive. */
  readonly value: SnapshotStore<number>

  /**
   * @param host - durable Chat settings scope.
   * @param field - the settings field this preference persists to.
   * @param range - accepted range, zoom step, and default.
   */
  constructor(
    private readonly host: SettingsScope<ChatSettings>,
    private readonly field: PixelField,
    private readonly range: PixelRange,
  ) {
    this.value = createSnapshotStore(range.fallback)
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish and persist one explicit value.
   * @param next - requested value in CSS pixels, snapped onto the accepted range.
   */
  set(next: number): void {
    const snapped = clampPixelPreference(this.range, next)
    if (this.value.getSnapshot() === snapped) return
    this.value.set(snapped)
    void this.host.set(this.field, snapped)
  }

  /**
   * Zoom the preference by whole steps.
   * @param steps - positive enlarges, negative shrinks; the range ends absorb the remainder.
   */
  zoom(steps: number): void {
    this.set(this.value.getSnapshot() + steps * this.range.step)
  }

  /**
   * Adopt the latest accepted Host section without writing it back. A Host
   * older than this field publishes a section without it, so the value is
   * checked here instead of trusted from the section type: the alternative is
   * a `NaN` that collapses whatever the preference sizes.
   */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    const stored: unknown = section[this.field]
    const next = typeof stored === 'number' && Number.isFinite(stored)
      ? clampPixelPreference(this.range, stored)
      : this.range.fallback
    if (this.value.getSnapshot() === next) return
    this.value.set(next)
  }
}
