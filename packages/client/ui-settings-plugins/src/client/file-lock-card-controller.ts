/** The file-lock card's staged form over the `file-lock` settings namespace. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CardForm, choiceField, scaledNumberField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the file-lock policy's user-owned settings. Spelled here rather
 * than imported: a client package must not depend on a Host package.
 */
export const FILE_LOCK_NS = 'file-lock'

/** Milliseconds per second; the unit the read wait is edited in. */
const SECOND_MS = 1000
/** Milliseconds per minute; the unit the write queue and the lease TTL are edited in. */
const MINUTE_MS = 60_000

/** Tokens the delegated-read field accepts, in display order. */
export const DELEGATED_READ_CHOICES = ['wait', 'read-now'] as const

/**
 * The file-lock fields this card edits. The Host section also carries the
 * per-tool access rules, which name deployment tools rather than a user
 * preference and are therefore not part of this form.
 */
export interface FileLockSettings {
  /** Milliseconds a foreign read waits silently before the user is asked. */
  readWaitMs?: number
  /** Milliseconds a foreign write queues for the lease before it is refused. */
  writeWaitMs?: number
  /** Milliseconds after which a lease is released even though its turn has not ended. */
  leaseTtlMs?: number
  /** What a read does when its wait expires and no human can be asked. */
  delegatedReadTimeout?: string
}

/** What the file-lock card renders. */
export interface FileLockCardState extends CardShell {
  /** Silent read wait, in seconds. */
  readWaitSeconds: CardFieldState
  /** Write queue bound, in minutes. */
  writeWaitMinutes: CardFieldState
  /** Lease time-to-live, in minutes. */
  leaseTtlMinutes: CardFieldState
  /** Behavior of a read that cannot ask a human. */
  delegatedReadTimeout: CardFieldState
}

/** The registration-side face the file-lock card's slot entry injects. */
export interface FileLockCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useFileLockCard. */
    fileLockCard: SnapshotStore<FileLockCardState>
  }
}

/**
 * Bridges the `file-lock` scope onto the card's staged form. The three waits
 * are stored in milliseconds and edited in the unit each one is chosen in, so
 * the control shows `30` rather than `30000`.
 */
export class FileLockCardController {
  private readonly form: CardForm<FileLockSettings>
  private readonly store: SnapshotStore<FileLockCardState>

  /** @param scope - the bound settings scope for the `file-lock` namespace. */
  constructor(scope: SettingsScope<FileLockSettings>) {
    this.form = new CardForm(scope, [
      scaledNumberField('readWaitMs', SECOND_MS),
      scaledNumberField('writeWaitMs', MINUTE_MS),
      scaledNumberField('leaseTtlMs', MINUTE_MS),
      choiceField('delegatedReadTimeout', DELEGATED_READ_CHOICES),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): FileLockCardState {
    return {
      ...this.form.shell(),
      readWaitSeconds: this.form.field('readWaitMs'),
      writeWaitMinutes: this.form.field('writeWaitMs'),
      leaseTtlMinutes: this.form.field('leaseTtlMs'),
      delegatedReadTimeout: this.form.field('delegatedReadTimeout'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): FileLockCardFace {
    return { hooks: { fileLockCard: this.store }, ...this.form.actions() }
  }
}
