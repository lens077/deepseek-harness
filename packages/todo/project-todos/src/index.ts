/**
 * Project-level todo documents across many directories: the Host scans
 * configured roots and registered workspaces for files such as `TODO.md`,
 * parses their list items, serves the result behind the `projectTodos`
 * Remote, and publishes `project-todos/changed` when a document or the
 * scan settings move. The documents stay the user's: nothing here writes
 * them, and a read is limited to documents the last scan listed.
 * @module @deepseek-ai/dsh-project-todos
 */

import { readFile, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
// Type-only: the `domain/changed` Events merge the workspace registry writes through.
import type {} from '@deepseek-ai/dsh-storage-domain'
// Type-only: the `ctx.workspaceRegistry` Context merge read when workspaces are included.
import type {} from '@deepseek-ai/dsh-workspace'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { messageOf, sameScan, scanProjects, settingsProblems, type ScanLimits } from './scan.ts'
import type {
  ProjectTodoReadRequest,
  ProjectTodoReadResult,
  ProjectTodosSettings,
  ProjectTodosSnapshot,
} from './types.ts'

export type * from './types.ts'
export { parseTodoDocument, scanProjects, settingsProblems } from './scan.ts'
export type { ParsedDocument, ScanInput, ScanLimits } from './scan.ts'

/** Settings namespace the user-editable part of the configuration is stored under. */
export const PROJECT_TODOS_SETTINGS_NAMESPACE: SettingsNamespace = settingsNamespace('project-todos')

/** Loader validation of the user-editable section; also the settings schema. */
export const ProjectTodosSettingsSchema: s<ProjectTodosSettings> = s.object({
  roots: s.array(s.string()).default([]),
  files: s.array(s.string()).default([]),
  includeWorkspaces: s.boolean().default(true),
})

/** Complete plugin configuration: the user-editable section plus fixed scan bounds. */
export interface Config extends ProjectTodosSettings {
  /** Deepest directory level a file pattern may reach below a project. */
  readonly maxDepth: number
  /** Documents above this byte size are listed without items. */
  readonly maxFileBytes: number
  /** Items kept per document; later lines are counted but not listed. */
  readonly maxItemsPerFile: number
  /** Quiet time after a file event before the rescan runs. */
  readonly watchDebounceMs: number
}

/** Loader validation for the complete configuration. */
export const Config: s<Config> = s.object({
  roots: s.array(s.string()).default([]),
  files: s.array(s.string()).default([]),
  includeWorkspaces: s.boolean().default(true),
  maxDepth: s.number().step(1).min(0).required(),
  maxFileBytes: s.number().step(1).min(1).required(),
  maxItemsPerFile: s.number().step(1).min(1).required(),
  watchDebounceMs: s.number().step(1).min(0).required(),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    projectTodos: ProjectTodosService
  }
}

/**
 * Refuse a section the scan could not use; the settings layer rejects the
 * write instead of the next scan warning about it.
 * @param settings - the resolved section.
 */
function validateSettings(settings: ProjectTodosSettings): void {
  const problems = settingsProblems(settings)
  if (problems.length > 0) throw new Error(`project-todos: ${problems.join('; ')}`)
}

/** Path segments the watchers never descend into; the scan skips the same directories. */
const SKIPPED_DIRECTORY_SEGMENT = /(?:^|[\\/])(?:node_modules|\.git)(?:[\\/]|$)/u

/** The snapshot served before the first scan finishes. */
function emptySnapshot(settings: ProjectTodosSettings): ProjectTodosSnapshot {
  return Object.freeze({
    scannedAt: null,
    settings: Object.freeze({
      roots: [...settings.roots],
      files: [...settings.files],
      includeWorkspaces: settings.includeWorkspaces,
    }),
    candidates: 0,
    projects: Object.freeze([]),
    warnings: Object.freeze([]),
  })
}

/**
 * Scanner service. Scans are serialized; a request landing during a scan
 * queues exactly one more, so a burst of file events yields one rescan.
 */
export class ProjectTodosService extends TypertRemoteService {
  /** Loader validation for the required configuration. */
  static Config: s<Config> = Config

  private readonly limits: ScanLimits
  private readonly debounceMs: number
  private settingsSource: () => ProjectTodosSettings
  private snapshot: ProjectTodosSnapshot
  private running: Promise<ProjectTodosSnapshot> | null = null
  private queued = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly roots: WatchSet
  private readonly projects: WatchSet
  private closed = false

  /**
   * @param ctx - Host context; the settings service and workspace registry are optional peers.
   * @param config - Complete validated configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'projectTodos')
    validateSettings(config)
    this.limits = {
      maxDepth: config.maxDepth,
      maxFileBytes: config.maxFileBytes,
      maxItemsPerFile: config.maxItemsPerFile,
    }
    this.debounceMs = config.watchDebounceMs
    const entry: ProjectTodosSettings = {
      roots: [...config.roots],
      files: [...config.files],
      includeWorkspaces: config.includeWorkspaces,
    }
    this.settingsSource = () => entry
    this.snapshot = emptySnapshot(entry)
    const onEvent = (): void => { this.schedule(this.debounceMs) }
    /* v8 ignore start -- chokidar reports errors only for OS-level watch failures a temporary tree cannot provoke */
    const onError = (error: unknown): void => { this.ctx.logger.warn(`project-todos: watcher error: ${messageOf(error)}`) }
    /* v8 ignore stop */
    this.roots = new WatchSet(1, onEvent, onError)
    this.projects = new WatchSet(0, onEvent, onError)
    installSettingsSection(ctx, PROJECT_TODOS_SETTINGS_NAMESPACE, ProjectTodosSettingsSchema, entry, {
      validate: validateSettings,
      setSource: (current) => { this.settingsSource = current },
      onChange: () => { this.schedule(0) },
    })
  }

  /** Run the first scan and follow workspace registry writes. */
  protected async [Service.init](): Promise<void> {
    this.ctx.on('domain/changed', (change) => {
      if (change.domain === 'workspace' && this.settingsSource().includeWorkspaces) this.schedule(this.debounceMs)
    })
    this.ctx.effect(() => async () => {
      this.closed = true
      if (this.timer !== null) clearTimeout(this.timer)
      await Promise.all([this.roots.close(), this.projects.close()])
      if (this.running !== null) await Promise.allSettled([this.running])
    }, 'project-todos.close')
    await this.scan()
  }

  /**
   * Read the last scan result.
   * @returns the complete snapshot; empty before the first scan finishes.
   */
  @Remote('get')
  get(): ProjectTodosSnapshot {
    return this.snapshot
  }

  /**
   * Scan again now, ahead of any pending file-event rescan.
   * @returns the fresh snapshot.
   */
  @Remote('rescan')
  rescan(): Promise<ProjectTodosSnapshot> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    return this.scan()
  }

  /**
   * Read the text of one document the current snapshot lists. Any other
   * path is refused: the snapshot is the whole set of files a browser may
   * read through this service.
   * @param request - the listed document path.
   * @returns the document, or an explicit refusal or read failure.
   */
  @Remote('readDocument')
  async readDocument(request: ProjectTodoReadRequest): Promise<ProjectTodoReadResult> {
    const listed = isAbsolute(request.path)
      && this.snapshot.projects.some(project => project.files.some(file => file.path === request.path))
    if (!listed) return Object.freeze({ ok: false, error: Object.freeze({ code: 'not-listed', path: request.path }) })
    try {
      const [text, info] = await Promise.all([readFile(request.path, 'utf8'), stat(request.path)])
      return Object.freeze({ ok: true, value: Object.freeze({ path: request.path, text, mtime: Math.round(info.mtimeMs) }) })
    } catch (error) {
      return Object.freeze({ ok: false, error: Object.freeze({ code: 'read-failed', path: request.path, message: messageOf(error) }) })
    }
  }

  /**
   * Queue one rescan after `delayMs` of quiet; a later call restarts the
   * wait. A watcher event landing during disposal still queues, and the
   * scan it reaches returns the last snapshot without work.
   */
  private schedule(delayMs: number): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.scan()
    }, delayMs)
  }

  /** Run one scan, or join the running one and queue a follow-up. */
  private scan(): Promise<ProjectTodosSnapshot> {
    if (this.closed) return Promise.resolve(this.snapshot)
    if (this.running !== null) {
      this.queued = true
      return this.running.then(() => this.running ?? this.snapshot)
    }
    this.running = this.runScan().finally(() => {
      this.running = null
      if (this.queued && !this.closed) {
        this.queued = false
        void this.scan()
      }
    })
    return this.running
  }

  /** Scan, publish on change, and point the watcher at what the scan found. */
  private async runScan(): Promise<ProjectTodosSnapshot> {
    const settings = this.settingsSource()
    const registry = settings.includeWorkspaces ? this.ctx.get('workspaceRegistry') : undefined
    const next = await scanProjects({
      settings,
      limits: this.limits,
      workspacePaths: registry === undefined ? [] : registry.list().map(workspace => workspace.path),
    })
    if (this.closed) return this.snapshot
    const changed = this.snapshot.scannedAt === null || !sameScan(this.snapshot, next)
    this.snapshot = next
    await this.rewatch(next)
    if (changed) this.ctx.emit('project-todos/changed', next)
    return next
  }

  /**
   * Watch the roots two levels deep (a new or removed project directory, a
   * new top-level document in any project under a root), every project
   * directory one level deep (a workspace project outside every root), and
   * every listed document; a document appearing deeper than a pattern's
   * first level is found by the next explicit rescan. Watchers persist
   * across scans and only the changed paths are added or released, so no
   * event is lost while a watcher restarts.
   */
  private async rewatch(snapshot: ProjectTodosSnapshot): Promise<void> {
    const projectPaths = new Set<string>()
    for (const project of snapshot.projects) {
      projectPaths.add(project.path)
      for (const file of project.files) projectPaths.add(file.path)
    }
    await this.roots.sync(new Set(snapshot.settings.roots))
    await this.projects.sync(projectPaths)
  }
}

/** One chokidar watcher kept in step with a desired path set at a fixed depth. */
class WatchSet {
  private watcher: FSWatcher | null = null
  private readonly watched = new Set<string>()

  /**
   * @param depth - directory levels below each watched path that report events.
   * @param onEvent - called for every file event.
   * @param onError - called for every watcher error.
   */
  constructor(
    private readonly depth: number,
    private readonly onEvent: () => void,
    private readonly onError: (error: unknown) => void,
  ) {}

  /**
   * Add the paths not yet watched and release the ones no longer wanted;
   * an empty set closes the watcher.
   * @param desired - the complete wanted path set.
   */
  async sync(desired: Set<string>): Promise<void> {
    const removed = [...this.watched].filter(path => !desired.has(path))
    const added = [...desired].filter(path => !this.watched.has(path))
    for (const path of removed) this.watched.delete(path)
    for (const path of added) this.watched.add(path)
    if (this.watched.size === 0) {
      await this.close()
      return
    }
    if (this.watcher === null) {
      this.watcher = chokidarWatch([...this.watched], {
        ignoreInitial: true,
        depth: this.depth,
        ignored: (path: string) => SKIPPED_DIRECTORY_SEGMENT.test(path),
      })
      this.watcher.on('all', () => { this.onEvent() })
      /* v8 ignore start -- see the owning service's watcher-error note */
      this.watcher.on('error', (error) => { this.onError(error) })
      /* v8 ignore stop */
      return
    }
    if (removed.length > 0) this.watcher.unwatch(removed)
    if (added.length > 0) this.watcher.add(added)
  }

  /** Release the watcher; a later `sync` reopens one. */
  async close(): Promise<void> {
    const watcher = this.watcher
    this.watcher = null
    this.watched.clear()
    await watcher?.close()
  }
}

export default ProjectTodosService
