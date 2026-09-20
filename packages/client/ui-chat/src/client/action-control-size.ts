/** Host-backed size policy for the transcript's right-hand action controls. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  ACTION_CONTROL_SIZE_FIELD, ACTION_CONTROL_SIZE_STEP, DEFAULT_ACTION_CONTROL_SIZE,
  clampActionControlSize, type ChatSettings,
} from '../chat-settings.ts'

/** Live control-size preference consumed by the Chat view and its Settings row. */
export class ActionControlSizePolicy {
  /** Reactive current edge length in CSS pixels; the shipped size until Host settings arrive. */
  readonly size: SnapshotStore<number> = createSnapshotStore(DEFAULT_ACTION_CONTROL_SIZE)

  /**
   * @param host - durable Chat settings scope.
   */
  constructor(private readonly host: SettingsScope<ChatSettings>) {
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish and persist one explicit edge length.
   * @param size - requested edge length in CSS pixels, snapped onto the accepted range.
   */
  setSize(size: number): void {
    const next = clampActionControlSize(size)
    if (this.size.getSnapshot() === next) return
    this.size.set(next)
    void this.host.set(ACTION_CONTROL_SIZE_FIELD, next)
  }

  /**
   * Zoom the controls by whole steps.
   * @param steps - positive enlarges, negative shrinks; the range ends absorb the remainder.
   */
  zoom(steps: number): void {
    this.setSize(this.size.getSnapshot() + steps * ACTION_CONTROL_SIZE_STEP)
  }

  /**
   * Adopt the latest accepted Host section without writing it back. A Host
   * older than this field publishes a section without it, so the value is
   * checked here instead of trusted from the section type: the alternative is
   * a `NaN` edge length, which collapses the whole control column to zero.
   */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    const stored: unknown = section.actionControlSize
    const next = typeof stored === 'number' && Number.isFinite(stored)
      ? clampActionControlSize(stored)
      : DEFAULT_ACTION_CONTROL_SIZE
    if (this.size.getSnapshot() === next) return
    this.size.set(next)
  }
}
