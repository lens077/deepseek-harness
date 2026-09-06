/**
 * The shell shared by this package's Host-snapshot controllers: one frozen
 * view, its subscribers, and the disposed flag. A subclass decides what the
 * view holds and which Remote calls replace it.
 * @module @deepseek-ai/dsh-client-ui-digest/client/snapshot-controller
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Frozen-view observable over one Host-served snapshot. */
export abstract class SnapshotController<V extends object> implements HostObservable<V> {
  private view: V
  private readonly listeners = new Set<() => void>()
  private stopped = false

  /**
   * @param initial - the view published before the first read.
   */
  protected constructor(initial: V) {
    this.view = initial
  }

  /** Return the cached immutable view. */
  getSnapshot = (): V => this.view

  /** Subscribe to view replacement. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Stop publishing; every later action reports `disposed`. */
  dispose(): void {
    this.stopped = true
    this.listeners.clear()
  }

  /** Whether {@link dispose} ran. */
  protected get disposed(): boolean {
    return this.stopped
  }

  /** Replace the view and notify every subscriber. */
  protected publish(view: V): void {
    this.view = Object.freeze(view)
    for (const listener of this.listeners) listener()
  }
}
