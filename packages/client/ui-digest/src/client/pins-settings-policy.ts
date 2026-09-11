/**
 * Browser view and writers for the durable `session-pins` settings section.
 * The view carries defaults before a settings scope binds so pin consumers have
 * deterministic behavior in compositions without the settings UI.
 * @module @deepseek-ai/dsh-client-ui-digest/client/pins-settings-policy
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_SESSION_PINS_SETTINGS, type SessionPinsSettings,
} from '../pins-settings.ts'

/** Settings state consumed by pin surfaces and the settings page. */
export interface PinsSettingsView {
  /** `loading` before the first section, `unavailable` when no scope serves it. */
  status: 'loading' | 'ready' | 'unavailable'
  enabled: boolean
  sidebarArea: boolean
  sidebarRows: number
  digestSection: boolean
  /** Whether writes reach the Host settings document. */
  writable: boolean
}

const INITIAL: PinsSettingsView = Object.freeze({
  status: 'unavailable',
  enabled: DEFAULT_SESSION_PINS_SETTINGS.enabled,
  sidebarArea: DEFAULT_SESSION_PINS_SETTINGS.sidebarArea,
  sidebarRows: DEFAULT_SESSION_PINS_SETTINGS.sidebarRows,
  digestSection: DEFAULT_SESSION_PINS_SETTINGS.digestSection,
  writable: false,
})

/** Owns the live pin settings view and routes edits to the durable scope. */
export class PinsSettingsPolicy {
  /** Reactive view read by pin surfaces and the settings page. */
  readonly view: SnapshotStore<PinsSettingsView>
  private host: SettingsScope<SessionPinsSettings> | undefined

  constructor() {
    this.view = createSnapshotStore<PinsSettingsView>(INITIAL)
  }

  /**
   * Attach the `session-pins` scope until the returned disposer runs.
   * @param host - the bound settings scope.
   * @returns the disposer that detaches the scope.
   */
  bind(host: SettingsScope<SessionPinsSettings>): () => void {
    this.host = host
    const unsubscribe = host.subscribe(() => { this.adopt() })
    this.adopt()
    return () => {
      unsubscribe()
      this.host = undefined
      this.view.set(INITIAL)
    }
  }

  /**
   * Enable or disable Session pinning.
   * @param enabled - the desired state.
   * @returns settlement of the durable write.
   */
  setEnabled(enabled: boolean): Promise<void> {
    return this.write('enabled', enabled)
  }

  /**
   * Enable or disable the sidebar pinned area.
   * @param enabled - the desired state.
   * @returns settlement of the durable write.
   */
  setSidebarArea(enabled: boolean): Promise<void> {
    return this.write('sidebarArea', enabled)
  }

  /**
   * Set the number of rows reserved for the sidebar pinned area.
   * @param rows - an integer from the schema's accepted range.
   * @returns settlement of the durable write.
   */
  setSidebarRows(rows: number): Promise<void> {
    return this.write('sidebarRows', rows)
  }

  /**
   * Enable or disable the digest panel pinned section.
   * @param enabled - the desired state.
   * @returns settlement of the durable write.
   */
  setDigestSection(enabled: boolean): Promise<void> {
    return this.write('digestSection', enabled)
  }

  private write(field: keyof SessionPinsSettings, value: unknown): Promise<void> {
    if (this.host === undefined) return Promise.reject(new Error('session pin settings are unavailable'))
    return this.host.set(field, value)
  }

  private adopt(): void {
    // `bind` installs the host before the first adopt and the disposer removes the subscription with it.
    const snapshot = (this.host as SettingsScope<SessionPinsSettings>).getSnapshot()
    const section = snapshot.value
    const current = this.view.getSnapshot()
    this.view.set(Object.freeze({
      status: snapshot.status === 'unavailable' ? 'unavailable' : section === undefined ? 'loading' : 'ready',
      enabled: section?.enabled ?? current.enabled,
      sidebarArea: section?.sidebarArea ?? current.sidebarArea,
      sidebarRows: section?.sidebarRows ?? current.sidebarRows,
      digestSection: section?.digestSection ?? current.digestSection,
      writable: snapshot.writable,
    }))
  }
}
