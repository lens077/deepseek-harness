/**
 * The project todo scan settings as the browser sees them: the durable
 * `project-todos` section (roots, file patterns, workspace inclusion) mirrored
 * into one reactive view the settings section renders and writes through.
 * @module @deepseek-ai/dsh-client-ui-digest/client/project-settings
 */

import { createSnapshotStore, type SettingsScope, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ProjectTodosSettings } from '@deepseek-ai/dsh-project-todos/types'

/** Settings namespace the Host scanner registers. */
export const PROJECT_TODOS_SETTINGS_NAMESPACE = 'project-todos'

/** What the settings section renders. */
export interface ProjectSettingsView {
  /** `loading` before the first accepted section, `unavailable` when the Host does not serve it. */
  status: 'loading' | 'ready' | 'unavailable'
  roots: readonly string[]
  files: readonly string[]
  includeWorkspaces: boolean
  /** Whether writes reach the Host document. */
  writable: boolean
}

const INITIAL: ProjectSettingsView = Object.freeze({
  status: 'loading',
  roots: Object.freeze([]),
  files: Object.freeze([]),
  includeWorkspaces: true,
  writable: false,
})

/**
 * Trim and de-duplicate a list the user typed; blank lines vanish.
 * @param lines - raw entries.
 * @returns the cleaned list in first-seen order.
 */
export function cleanList(lines: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const line of lines) {
    const value = line.trim()
    if (value.length > 0) seen.add(value)
  }
  return [...seen]
}

/** Owns the live scan settings view and routes edits to the durable scope. */
export class ProjectSettingsPolicy {
  /** Reactive view read by the settings section. */
  readonly view: SnapshotStore<ProjectSettingsView>

  /**
   * @param host - the `project-todos` settings scope. The adoption
   * subscription shares the scope's plugin lifetime.
   */
  constructor(private readonly host: SettingsScope<ProjectTodosSettings>) {
    this.view = createSnapshotStore<ProjectSettingsView>(INITIAL)
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Replace the scanned roots.
   * @param roots - directory paths; blanks and duplicates are dropped.
   * @returns settlement of the durable write.
   */
  setRoots(roots: readonly string[]): Promise<void> {
    return this.host.set('roots', cleanList(roots))
  }

  /**
   * Replace the document patterns.
   * @param files - project-relative glob patterns; blanks and duplicates are dropped.
   * @returns settlement of the durable write.
   */
  setFiles(files: readonly string[]): Promise<void> {
    return this.host.set('files', cleanList(files))
  }

  /**
   * Include or exclude registered workspaces from the scan.
   * @param include - the desired state.
   * @returns settlement of the durable write.
   */
  setIncludeWorkspaces(include: boolean): Promise<void> {
    return this.host.set('includeWorkspaces', include)
  }

  private adopt(): void {
    const snapshot = this.host.getSnapshot()
    const section = snapshot.value
    const next: ProjectSettingsView = section === undefined
      ? { ...this.view.getSnapshot(), status: snapshot.status === 'unavailable' ? 'unavailable' : 'loading', writable: snapshot.writable }
      : {
        status: snapshot.status === 'unavailable' ? 'unavailable' : 'ready',
        roots: Object.freeze([...section.roots]),
        files: Object.freeze([...section.files]),
        includeWorkspaces: section.includeWorkspaces,
        writable: snapshot.writable,
      }
    this.view.set(Object.freeze(next))
  }
}
