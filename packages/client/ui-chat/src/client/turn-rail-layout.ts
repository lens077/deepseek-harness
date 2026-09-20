/** Host-backed placement policy for the transcript's turn rail. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_TURN_RAIL_ALIGNMENT, DEFAULT_TURN_RAIL_PLACEMENT,
  TURN_RAIL_ALIGNMENTS, TURN_RAIL_ALIGNMENT_FIELD, TURN_RAIL_PLACEMENTS, TURN_RAIL_PLACEMENT_FIELD,
  type ChatSettings, type TurnRailAlignment, type TurnRailPlacement,
} from '../chat-settings.ts'

/** Where the rail stands and, in its own column, how it aligns. */
export interface TurnRailLayout {
  readonly placement: TurnRailPlacement
  readonly alignment: TurnRailAlignment
}

/** The layout every Chat view starts from before Host settings arrive. */
export const DEFAULT_TURN_RAIL_LAYOUT: TurnRailLayout = {
  placement: DEFAULT_TURN_RAIL_PLACEMENT,
  alignment: DEFAULT_TURN_RAIL_ALIGNMENT,
}

/** Live rail-layout preference consumed by the Chat view and its Settings row. */
export class TurnRailLayoutPolicy {
  /** Reactive current layout; the snapshot identity moves only when a field changes. */
  readonly layout: SnapshotStore<TurnRailLayout> = createSnapshotStore(DEFAULT_TURN_RAIL_LAYOUT)

  /**
   * @param host - durable Chat settings scope.
   */
  constructor(private readonly host: SettingsScope<ChatSettings>) {
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish and persist one explicit layout choice. Both fields are written
   * because the Settings row offers the placements and the column alignments
   * as one list of destinations.
   * @param next - requested placement and column alignment.
   */
  setLayout(next: TurnRailLayout): void {
    const current = this.layout.getSnapshot()
    if (current.placement === next.placement && current.alignment === next.alignment) return
    this.layout.set(next)
    if (current.placement !== next.placement) void this.host.set(TURN_RAIL_PLACEMENT_FIELD, next.placement)
    if (current.alignment !== next.alignment) void this.host.set(TURN_RAIL_ALIGNMENT_FIELD, next.alignment)
  }

  /**
   * Adopt the latest accepted Host section without writing it back. A Host
   * older than these fields publishes a section without them, so each value is
   * checked against its accepted set rather than trusted from the section type.
   */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    const next: TurnRailLayout = {
      placement: accepted(TURN_RAIL_PLACEMENTS, section.turnRailPlacement, DEFAULT_TURN_RAIL_PLACEMENT),
      alignment: accepted(TURN_RAIL_ALIGNMENTS, section.turnRailAlignment, DEFAULT_TURN_RAIL_ALIGNMENT),
    }
    const current = this.layout.getSnapshot()
    if (current.placement === next.placement && current.alignment === next.alignment) return
    this.layout.set(next)
  }
}

/**
 * One stored value, or the default when the Host published something outside
 * the accepted set.
 * @param values - the accepted set.
 * @param stored - the value the Host published.
 * @param fallback - the value to use when `stored` is not accepted.
 * @returns the accepted value.
 */
function accepted<T extends string>(values: readonly T[], stored: unknown, fallback: T): T {
  return values.includes(stored as T) ? stored as T : fallback
}
