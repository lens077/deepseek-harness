/** Live task-flow drawing and phone strip preferences over the durable settings scope. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CANVAS_VARIANT_FIELD, DEFAULT_CANVAS_VARIANT, DEFAULT_DOCK_VARIANT, DOCK_VARIANT_FIELD,
  DEFAULT_FONT_SIZE, FONT_SIZE_FIELD, MOBILE_DOCK_FIELD, TaskFlowSettingsSchema, type FlowVariant, type TaskFlowSettings,
} from '../settings.ts'

/** Drawing preferences shared by the resident strip and the explicit Flow view. */
export interface FlowStyle {
  readonly dock: FlowVariant
  readonly canvas: FlowVariant
  readonly fontSize: number
}

/** Preference policy shared by the strip, the canvas, and the Settings rows. */
export class FlowStylePolicy {
  /** Reactive drawing preferences. */
  readonly style: SnapshotStore<FlowStyle> = createSnapshotStore<FlowStyle>({
    dock: DEFAULT_DOCK_VARIANT,
    canvas: DEFAULT_CANVAS_VARIANT,
    fontSize: DEFAULT_FONT_SIZE,
  })
  /** Phone strip visibility; remote browsers persist only this preference locally. */
  readonly mobileDock: SnapshotStore<boolean>
  private readonly host: SettingsScope<TaskFlowSettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime, so the policy needs no release hook.
   */
  constructor(host?: SettingsScope<TaskFlowSettings>) {
    this.host = host
    this.mobileDock = createSnapshotStore(false, host?.getSnapshot().mode === 'memory'
      ? { persist: { name: 'dsh.task-flow.mobile-dock' } }
      : undefined)
    if (host?.getSnapshot().mode === 'memory') {
      let enabled: boolean
      try { enabled = TaskFlowSettingsSchema({ mobileDock: this.mobileDock.getSnapshot() }).mobileDock }
      catch { enabled = false } // Invalid browser-stored visibility resets to the opt-out default.
      this.mobileDock.set(enabled)
    }
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Change the strip variant; the live value publishes before the durable write starts.
   * @param variant - drawing variant for the strip above the composer.
   */
  setDock(variant: FlowVariant): void {
    const current = this.style.getSnapshot()
    if (current.dock === variant) return
    this.style.set({ ...current, dock: variant })
    void this.host?.set(DOCK_VARIANT_FIELD, variant)
  }

  /**
   * Change the canvas variant; the live value publishes before the durable write starts.
   * @param variant - drawing variant for the canvas view.
   */
  setCanvas(variant: FlowVariant): void {
    const current = this.style.getSnapshot()
    if (current.canvas === variant) return
    this.style.set({ ...current, canvas: variant })
    void this.host?.set(CANVAS_VARIANT_FIELD, variant)
  }

  /**
   * Change text size without changing either drawing variant.
   * @param fontSize - task-flow text size in CSS pixels, within the settings range.
   */
  setFontSize(fontSize: number): void {
    const current = this.style.getSnapshot()
    if (current.fontSize === fontSize) return
    this.style.set({ ...current, fontSize })
    void this.host?.set(FONT_SIZE_FIELD, fontSize)
  }

  /**
   * Toggle the resident strip on phones without changing the desktop strip or explicit Flow view.
   * @param mobileDock - whether phone conversations display the resident strip.
   */
  setMobileDock(mobileDock: boolean): void {
    if (this.mobileDock.getSnapshot() === mobileDock) return
    this.mobileDock.set(mobileDock)
    if (this.host?.getSnapshot().mode === 'host') void this.host.set(MOBILE_DOCK_FIELD, mobileDock)
  }

  private adopt(host: SettingsScope<TaskFlowSettings>): void {
    const value = host.getSnapshot().value
    if (value === undefined) return
    const section = TaskFlowSettingsSchema(value)
    this.mobileDock.set(section.mobileDock)
    const current = this.style.getSnapshot()
    if (current.dock === section.dockVariant && current.canvas === section.canvasVariant && current.fontSize === section.fontSize) return
    this.style.set({ dock: section.dockVariant, canvas: section.canvasVariant, fontSize: section.fontSize })
  }
}
