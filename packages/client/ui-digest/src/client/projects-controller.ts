/**
 * Browser-local object layer over the Host's project todo scan: the todo
 * documents found under the configured roots and registered workspaces.
 * The Host serves the complete snapshot after every read and rescan and
 * pushes it on `project-todos/changed`, so this controller only ever
 * replaces its copy.
 * @module @deepseek-ai/dsh-client-ui-digest/client/projects-controller
 */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ProjectTodoDocument,
  ProjectTodoReadRequest,
  ProjectTodoReadResult,
  ProjectTodosSnapshot,
} from '@deepseek-ai/dsh-project-todos/types'
import type { InboxActionResult } from './controller.ts'
import { SnapshotController } from './snapshot-controller.ts'

/** The Remote calls this controller needs, each wrapped in {@link RemoteResult}. */
export interface ProjectTodosRemote {
  get: () => Promise<RemoteResult<ProjectTodosSnapshot>>
  rescan: () => Promise<RemoteResult<ProjectTodosSnapshot>>
  readDocument: (request: ProjectTodoReadRequest) => Promise<RemoteResult<ProjectTodoReadResult>>
}

/** Load state of the one snapshot read. */
export type ProjectTodosStatus = 'cold' | 'loading' | 'ready' | 'error'

/** Immutable view published to the panel. */
export interface ProjectTodosView {
  status: ProjectTodosStatus
  /** The last snapshot received; empty until the first read lands. */
  snapshot: ProjectTodosSnapshot
  /** Reason the last load failed, cleared by the next successful load. */
  error: string | null
  /** Whether an explicit rescan is in flight. */
  scanning: boolean
}

/** Settled document read rendered by the panel. */
export type ProjectDocumentResult =
  | { ok: true; value: ProjectTodoDocument }
  | { ok: false; error: { code: string; message: string } }

const EMPTY_SNAPSHOT: ProjectTodosSnapshot = Object.freeze({
  scannedAt: null,
  settings: Object.freeze({ roots: [], files: [], includeWorkspaces: true }),
  candidates: 0,
  projects: Object.freeze([]),
  warnings: Object.freeze([]),
})

const INITIAL_VIEW: ProjectTodosView = Object.freeze({ status: 'cold', snapshot: EMPTY_SNAPSHOT, error: null, scanning: false })

const OK: InboxActionResult = Object.freeze({ ok: true })

const DISPOSED: InboxActionResult = Object.freeze({
  ok: false,
  error: Object.freeze({ code: 'disposed', message: 'project todos controller is disposed' }),
})

/**
 * Human-readable text for one business failure code.
 * @param code - the Host's business failure code.
 * @returns a short description for the UI.
 */
function describe(code: string): string {
  switch (code) {
    case 'not-listed': return 'this document is not in the last scan'
    case 'read-failed': return 'the document could not be read'
    default: return code
  }
}

/** Per-client project todos object layer; one instance backs the panel tab. */
export class ProjectTodosController extends SnapshotController<ProjectTodosView> {
  private loadPromise: Promise<InboxActionResult> | null = null

  /**
   * @param remote - the projectTodos Remote namespace.
   */
  constructor(private readonly remote: ProjectTodosRemote) {
    super(INITIAL_VIEW)
  }

  /**
   * Load once; a failed load stays retryable.
   * @returns the settled load result, shared by concurrent callers.
   */
  ensure(): Promise<InboxActionResult> {
    if (this.getSnapshot().status === 'ready') return Promise.resolve(OK)
    return this.refresh()
  }

  /**
   * Re-read the last scan result, collapsing concurrent callers onto one
   * in-flight read.
   * @returns the settled reload result.
   */
  refresh(): Promise<InboxActionResult> {
    return this.load(() => this.remote.get(), false)
  }

  /**
   * Ask the Host to scan again now.
   * @returns the settled rescan result.
   */
  rescan(): Promise<InboxActionResult> {
    return this.load(() => this.remote.rescan(), true)
  }

  /**
   * Replace the copy with a snapshot the Host published.
   * @param snapshot - the complete scan result.
   */
  receive(snapshot: ProjectTodosSnapshot): void {
    if (this.disposed) return
    this.publish({ status: 'ready', snapshot, error: null, scanning: this.getSnapshot().scanning })
  }

  /**
   * Read one listed document's text.
   * @param path - the absolute document path as the snapshot lists it.
   * @returns the document, or a described failure.
   */
  async readDocument(path: string): Promise<ProjectDocumentResult> {
    if (this.disposed) return { ok: false, error: { code: 'disposed', message: 'project todos controller is disposed' } }
    const carried = await this.remote.readDocument({ path })
    if (!carried.ok) return { ok: false, error: { code: carried.error.code, message: carried.error.message } }
    const result = carried.value
    if (!result.ok) return { ok: false, error: { code: result.error.code, message: describe(result.error.code) } }
    return { ok: true, value: result.value }
  }

  /** Run one snapshot-returning call, sharing an in-flight one. */
  private load(call: () => Promise<RemoteResult<ProjectTodosSnapshot>>, scanning: boolean): Promise<InboxActionResult> {
    if (this.disposed) return Promise.resolve(DISPOSED)
    if (this.loadPromise !== null) return this.loadPromise
    this.publish({ status: 'loading', snapshot: this.getSnapshot().snapshot, error: null, scanning })
    const pending = call().then((carried) => {
      if (this.disposed) return DISPOSED
      if (!carried.ok) {
        this.publish({ status: 'error', snapshot: this.getSnapshot().snapshot, error: carried.error.message, scanning: false })
        return { ok: false, error: { code: carried.error.code, message: carried.error.message } }
      }
      this.publish({ status: 'ready', snapshot: carried.value, error: null, scanning: false })
      return OK
    })
    this.loadPromise = pending
    return pending.finally(() => { this.loadPromise = null })
  }
}
