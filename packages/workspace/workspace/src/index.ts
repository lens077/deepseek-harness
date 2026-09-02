/**
 * Workspace entity registry (`ctx.workspaceRegistry`): durable workspace records,
 * stable registry order, and header-validated session membership over the
 * domain data form.
 * @module @deepseek-ai/dsh-workspace
 */

import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceEntity } from './entity.ts'
import type { WorkspaceEntityHost } from './entity.ts'

export { WorkspaceMembershipInvalidError, WorkspaceMoveInvalidError } from './entity.ts'
import { realpathNormalize } from './paths.ts'
import { workspaceDomainSpec } from './spec.ts'
import type { WorkspaceDomainState, WorkspaceRecord } from './spec.ts'
import type { Workspace, WorkspaceId as WorkspaceIdBrand } from './types.ts'

export type { Workspace } from './types.ts'
export { workspaceDomainState, workspaceRecord, workspaceDomainSpec } from './spec.ts'
export type { WorkspaceDomainState, WorkspaceRecord } from './spec.ts'
export { realpathNormalize } from './paths.ts'

/** Identifies one workspace record (see `src/types.ts` for the brand rationale). */
export type WorkspaceId = WorkspaceIdBrand

/**
 * Brand a string as a {@link WorkspaceId}.
 * @param id - Raw workspace id string.
 * @returns the same string, branded at compile time.
 */
export function WorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId
}

/**
 * An archiveSession request named a session neither live nor in session
 * persistence — a definite miss only; storage faults propagate as themselves.
 */
export class WorkspaceUnknownSessionError extends Error {
  /**
   * @param sessionId - The unknown session id.
   * @param operation - Destructive or archival operation that required it.
   */
  constructor(
    readonly sessionId: SessionId,
    readonly operation: 'archive' | 'delete' = 'archive',
  ) {
    super(`cannot ${operation} session '${sessionId}': live sessions and session persistence hold no such session`)
    this.name = 'WorkspaceUnknownSessionError'
  }
}

/** Permanent deletion named one or more identities that still have live Session owners. */
export class WorkspaceSessionLiveError extends Error {
  /**
   * @param sessionId - Requested cascade root.
   * @param liveSessionIds - Complete live subset of the planned cascade.
   */
  constructor(
    readonly sessionId: SessionId,
    readonly liveSessionIds: readonly SessionId[],
  ) {
    super(`cannot delete session '${sessionId}' while cascade sessions are live: ${liveSessionIds.join(', ')}`)
    this.name = 'WorkspaceSessionLiveError'
  }
}

/** A new Session attempted to reuse or descend from an in-process deletion tombstone. */
export class WorkspaceSessionDeletingError extends Error {
  /**
   * @param sessionId - New session identity rejected by the deletion reservation.
   * @param parentSessionId - Deleted or deleting parent identity, when applicable.
   */
  constructor(
    readonly sessionId: SessionId,
    readonly parentSessionId?: SessionId,
  ) {
    super(parentSessionId === undefined
      ? `cannot create session '${sessionId}' while that identity is being permanently deleted`
      : `cannot create session '${sessionId}' from permanently deleted parent '${parentSessionId}'`)
    this.name = 'WorkspaceSessionDeletingError'
  }
}

/** A workspace reorder named a source or anchor absent from the durable registry order. */
export class WorkspaceOrderInvalidError extends Error {
  /**
   * @param workspaceId - Missing source or anchor id.
   */
  constructor(readonly workspaceId: WorkspaceId) {
    super(`cannot reorder unknown workspace '${workspaceId}'`)
    this.name = 'WorkspaceOrderInvalidError'
  }
}


declare module '@deepseek-ai/cordis' {
  interface Context {
    workspaceRegistry: WorkspaceRegistry
  }
}

interface BootstrapGroup {
  readonly path: string
  readonly headers: SessionHeader[]
  readonly newestAt: number
}

/** Caller-owned capability for quiescently retiring an admissible live subset. */
type RetireSessionsForDelete = (sessionIds: readonly SessionId[]) => Promise<void>

const sameIds = (left: readonly WorkspaceId[], right: readonly WorkspaceId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

const compareHeaders = (left: SessionHeader, right: SessionHeader): number =>
  right.createdAt - left.createdAt || String(left.id).localeCompare(String(right.id))

/** Immutable identity fields that must agree between live and durable observations. */
const sameSessionIdentity = (left: SessionHeader, right: SessionHeader): boolean =>
  left.id === right.id
  && left.createdAt === right.createdAt
  && left.cwd === right.cwd
  && left.parentSession === right.parentSession

/**
 * Durable workspace registry. Startup waits for `sessionPersistence`, builds
 * one canonical-cwd header index, and completes the one-time history
 * bootstrap before the service becomes active. The persistence dependency is
 * mandatory so an unavailable peer can never be mistaken for an empty
 * history and commit the initialized marker.
 */
export class WorkspaceRegistry extends Service {
  static inject = ['storageDomain', 'sessionPersistence']

  private table?: KvTable<WorkspaceId, WorkspaceRecord>
  private global?: DomainGlobal<WorkspaceDomainState>
  private state?: WorkspaceDomainState
  private readonly entities = new Map<WorkspaceId, WorkspaceEntity>()
  private readonly headers = new Map<SessionId, SessionHeader>()
  private readonly sessionPaths = new Map<SessionId, string>()
  private readonly invalidSessionPaths = new Map<SessionId, string>()
  /** Identities reserved by a durable deletion marker that has not committed cleanup. */
  private readonly deletingSessionIds = new Set<SessionId>()
  /** Connection-process tombstones that reject delayed creates after deletion commits. */
  private readonly deletedSessionIds = new Set<SessionId>()
  private operationTail: Promise<void> = Promise.resolve()

  private readonly host: WorkspaceEntityHost = {
    table: () => this.requireTable(),
    sessionPath: id => this.sessionPaths.get(id),
    readSessionHeader: id => this.readSessionHeader(id),
    assertSessionAttachable: id => this.assertSessionAttachable(id),
    rememberSessionPath: (id, path) => {
      this.sessionPaths.set(id, path)
      this.invalidSessionPaths.delete(id)
    },
  }

  constructor(ctx: Context) {
    super(ctx, 'workspaceRegistry')
    ctx.on('session/created', (session) => {
      const parent = session.header.parentSession
      if (this.deletingSessionIds.has(session.id) || this.deletedSessionIds.has(session.id)) {
        throw new WorkspaceSessionDeletingError(session.id)
      }
      if (parent !== undefined
        && (this.deletingSessionIds.has(parent) || this.deletedSessionIds.has(parent))) {
        throw new WorkspaceSessionDeletingError(session.id, parent)
      }
    })
  }

  /** Open the domain, finish bootstrap when required, and rebuild the ordered cache. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workspaceDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'workspace.domainClose')
    this.table = domain.table('workspaces')
    this.global = domain.global
    this.state = domain.global.get()
    this.rememberPendingSessionDeletion(this.state)

    await this.recoverPendingMutation()
    this.validateStoredState(this.state)
    if (!this.state.initialized) {
      const headers = await this.ctx.sessionPersistence.list()
      await this.replaceHeaderIndex(headers)
      await this.bootstrap(headers)
    } else if (this.table.size > 0) {
      await this.replaceHeaderIndex(await this.ctx.sessionPersistence.list())
    }

    await this.indexLiveSessions()
    this.validateStoredState(this.requireState())
    this.rebuildEntities()
    this.reportFilteredCandidates()
  }

  /**
   * Create or reuse a workspace for an existing directory. The path is
   * canonicalized through `fs.realpath`; a nonexistent path rejects with the
   * original error and a non-directory rejects. Repeated calls for the same
   * canonical path return the existing entity without changing its title.
   * A newly created workspace is prepended to the durable registry order.
   * Different canonical paths may share a display title.
   * @param path - Existing directory to own, in any path spelling.
   * @param title - Display title used only when a new record is created.
   * @returns the existing or newly durable workspace.
   */
  // TODO: `title` lost its last production caller when the gateway's
  // create-by-name branch was deleted
  // (.agents/notes/implemented/simplification/2026-07-31-one-route-to-add-a-workspace.md);
  // drop the parameter with its @param clause and the `create(path, title?)`
  // lines in this package's README pair.
  async create(path: string, title?: string): Promise<Workspace> {
    const canonical = await realpathNormalize(path)
    if (!(await stat(canonical)).isDirectory()) {
      throw new Error(`cannot create a workspace at '${canonical}': path is not a directory`)
    }
    return await this.enqueueOperation(() => this.createCanonical(canonical, title))
  }

  /**
   * Look up a workspace by id.
   * @param id - Workspace id.
   * @returns the workspace, or `undefined` when unknown.
   */
  get(id: WorkspaceId): Workspace | undefined {
    return this.entities.get(id)
  }

  /**
   * Synchronous workspace projection in durable registry order. Every
   * entity's `sessionIds` getter is already filtered by the startup/live
   * canonical-cwd header index; this method performs no persistence reads.
   * @returns a fresh ordered array of workspace entities.
   */
  list(): Workspace[] {
    return this.requireState().workspaceIds.map((id) => {
      const entity = this.entities.get(id)
      if (entity === undefined) {
        throw new Error(`workspace registry order references missing workspace '${id}'`)
      }
      return entity
    })
  }

  /**
   * Delete one workspace registration while retaining its directory and every
   * session log. The durable order is updated before the table deletion; a
   * failed table write restores the prior order and keeps the entity
   * published. Unknown ids are an idempotent no-op for domain callers.
   * @param id - Workspace registration to remove.
   * @returns `true` when a record was deleted, `false` when it was unknown.
   */
  delete(id: WorkspaceId): Promise<boolean> {
    return this.enqueueOperation(() => this.deleteKnown(id))
  }

  /**
   * Move one workspace within the durable display order, DOM-insertBefore-like.
   * With an anchor it lands before that workspace; without one it appends.
   * @param id - Workspace to move.
   * @param beforeId - Workspace anchor; omitted appends.
   * @returns the complete committed workspace order.
   */
  insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      if (!state.workspaceIds.includes(id)) throw new WorkspaceOrderInvalidError(id)
      if (beforeId !== undefined && !state.workspaceIds.includes(beforeId)) {
        throw new WorkspaceOrderInvalidError(beforeId)
      }
      if (beforeId === id) return state.workspaceIds
      const without = state.workspaceIds.filter(workspaceId => workspaceId !== id)
      const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
      const workspaceIds = [...without.slice(0, at), id, ...without.slice(at)]
      if (sameIds(workspaceIds, state.workspaceIds)) return state.workspaceIds
      await this.setState({ ...state, workspaceIds })
      return workspaceIds
    })
  }

  /**
   * The registry-global archive set: sessions hidden from every grouping
   * surface. Archiving never touches workspace accounting — an archived
   * session keeps its `sessionIds` slot so unarchiving restores its position.
   * @returns the archived session ids in archive order.
   */
  get archivedSessionIds(): readonly SessionId[] {
    return this.requireState().archivedSessionIds
  }

  /**
   * Exact child-first ids held by an in-progress durable Session deletion.
   * Host streams use this only to derive a committed deletion frame when the
   * marker clears; an absent marker needs no replay frame because list is the
   * connection baseline.
   * @returns the pending cascade, or `undefined` when none exists.
   */
  get pendingSessionDeletionIds(): readonly SessionId[] | undefined {
    const pending = this.requireState().pendingMutation
    return pending?.operation === 'delete-sessions' ? pending.sessionIds : undefined
  }

  /**
   * Permanently delete a stored Session and every transitive fork/subagent
   * descendant, child first. Live targets reject unless the caller supplies an
   * exact disposer capability; the registry reserves the full subtree before
   * invoking it, then requires every target to leave the live store. The durable
   * marker makes physical deletion, Workspace account pruning, archive cleanup,
   * and index cleanup restartable.
   * @param sessionId - Root identity whose complete lineage subtree is removed.
   * @param retire - Optional exact capability that may retire the reported live subset.
   * @returns the deterministic child-first deleted ids.
   */
  deleteSession(
    sessionId: SessionId,
    retire?: RetireSessionsForDelete,
  ): Promise<readonly SessionId[]> {
    return this.enqueueOperation(() => this.deleteSessionCascade(sessionId, retire))
  }

  /**
   * Archive one session durably. The session must exist (live or in session
   * persistence); its workspace accounting — or lack of one — is irrelevant.
   * An already archived id resolves without writing.
   * @param sessionId - The session to archive.
   * @returns resolution after durability.
   */
  archiveSession(sessionId: SessionId): Promise<void> {
    return this.archiveSessions([sessionId])
  }

  /**
   * Archive several sessions in one registry-state write. Every id is validated
   * before mutation, so an unknown Session rejects the complete selection.
   * @param sessionIds - Sessions to add to the archive set.
   * @returns resolution after durability.
   */
  archiveSessions(sessionIds: readonly SessionId[]): Promise<void> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      const archived = new Set(state.archivedSessionIds)
      const additions = [...new Set(sessionIds)].filter(sessionId => !archived.has(sessionId))
      for (const sessionId of additions) {
        if (!(await this.sessionKnown(sessionId))) throw new WorkspaceUnknownSessionError(sessionId)
      }
      if (additions.length === 0) return
      await this.setState({ ...state, archivedSessionIds: [...state.archivedSessionIds, ...additions] })
    })
  }

  /**
   * Remove one session from the archive set durably. An id outside the set
   * resolves without writing, including an unknown id: archive membership is
   * the operation's authority, so stale entries always remain clearable.
   * @param sessionId - The session to unarchive.
   * @returns resolution after durability, or immediately for an absent id.
   */
  unarchiveSession(sessionId: SessionId): Promise<void> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      if (!state.archivedSessionIds.includes(sessionId)) return
      await this.setState({
        ...state,
        archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId),
      })
    })
  }

  private async deleteSessionCascade(
    sessionId: SessionId,
    retire: RetireSessionsForDelete | undefined,
  ): Promise<readonly SessionId[]> {
    const sessionIds = await this.sessionDeletionOrder(sessionId)
    for (const id of sessionIds) this.deletingSessionIds.add(id)
    const sessions = this.ctx.get('sessions')
    try {
      const liveSessionIds = sessions === undefined
        ? []
        : sessionIds.filter(id => sessions.get(id) !== undefined)
      if (liveSessionIds.length > 0) {
        if (retire === undefined) throw new WorkspaceSessionLiveError(sessionId, liveSessionIds)
        await retire(liveSessionIds)
        const remaining = liveSessionIds.filter(id => sessions?.get(id) !== undefined)
        if (remaining.length > 0) throw new WorkspaceSessionLiveError(sessionId, remaining)
      }

      const state = this.requireState()
      await this.setState({
        ...state,
        pendingMutation: { operation: 'delete-sessions', sessionIds: [...sessionIds] },
      })
    } catch (error) {
      for (const id of sessionIds) this.deletingSessionIds.delete(id)
      throw error
    }
    await this.completeSessionDeletion(sessionIds)
    return sessionIds
  }

  /** Build one live-preferred lineage corpus and return deterministic post-order. */
  private async sessionDeletionOrder(rootId: SessionId): Promise<SessionId[]> {
    const persisted = await this.ctx.sessionPersistence.list()
    const corpus = new Map<SessionId, SessionHeader>()
    for (const header of persisted) corpus.set(header.id, header)
    const sessions = this.ctx.get('sessions')
    if (sessions !== undefined) {
      for (const session of sessions.list()) {
        const stored = corpus.get(session.id)
        if (stored !== undefined && !sameSessionIdentity(stored, session.header)) {
          throw new Error(`session deletion found conflicting live and persisted headers for '${session.id}'`)
        }
        corpus.set(session.id, session.header)
      }
    }
    for (const [id, header] of this.headers) {
      if (!corpus.has(id)) corpus.set(id, header)
    }
    const root = corpus.get(rootId)
    if (root === undefined) throw new WorkspaceUnknownSessionError(rootId, 'delete')
    for (const header of corpus.values()) this.headers.set(header.id, header)

    const children = new Map<SessionId, SessionHeader[]>()
    for (const header of corpus.values()) {
      if (header.parentSession === undefined) continue
      const siblings = children.get(header.parentSession)
      if (siblings === undefined) children.set(header.parentSession, [header])
      else siblings.push(header)
    }
    for (const siblings of children.values()) {
      siblings.sort((left, right) => left.createdAt - right.createdAt
        || String(left.id).localeCompare(String(right.id)))
    }

    const visiting = new Set<SessionId>()
    const visited = new Set<SessionId>()
    const ordered: SessionId[] = []
    const visit = (id: SessionId): void => {
      if (visiting.has(id)) {
        throw new Error(`session deletion found a parentSession cycle at '${id}'`)
      }
      if (visited.has(id)) return
      visiting.add(id)
      for (const child of children.get(id) ?? []) visit(child.id)
      visiting.delete(id)
      visited.add(id)
      ordered.push(id)
    }
    visit(root.id)
    return ordered
  }

  /** Finish one marker-owned cascade idempotently, including every registry-owned index. */
  private async completeSessionDeletion(sessionIds: readonly SessionId[]): Promise<void> {
    for (const id of sessionIds) this.deletingSessionIds.add(id)
    const sessions = this.ctx.get('sessions')
    const liveSessionIds = sessions === undefined
      ? []
      : sessionIds.filter(id => sessions.get(id) !== undefined)
    if (liveSessionIds.length > 0) {
      const root = sessionIds.at(-1)
      if (root === undefined) throw new Error('session deletion marker contains no session ids')
      throw new WorkspaceSessionLiveError(root, liveSessionIds)
    }
    for (const id of sessionIds) await this.ctx.sessionPersistence.delete(id)
    await this.removeSessionAccounting(new Set(sessionIds))

    const state = this.requireState()
    await this.setState({
      initialized: state.initialized,
      workspaceIds: state.workspaceIds,
      archivedSessionIds: state.archivedSessionIds.filter(id => !this.deletingSessionIds.has(id)),
    })
    for (const id of sessionIds) {
      this.headers.delete(id)
      this.sessionPaths.delete(id)
      this.invalidSessionPaths.delete(id)
      this.deletingSessionIds.delete(id)
      this.deletedSessionIds.add(id)
    }
  }

  /** Remove target ids from every durable Workspace account in one write per affected record. */
  private async removeSessionAccounting(sessionIds: ReadonlySet<SessionId>): Promise<void> {
    const table = this.requireTable()
    for (const [workspaceId, snapshot] of table.entries()) {
      const remaining = snapshot.sessionIds.filter(id => !sessionIds.has(id))
      if (remaining.length === snapshot.sessionIds.length) continue
      const record = await table.update(workspaceId, current => ({
        ...current,
        sessionIds: current.sessionIds.filter(id => !sessionIds.has(id)),
        nestedUnder: Object.fromEntries(Object.entries(current.nestedUnder)
          .filter(([child, parent]) => !sessionIds.has(child as SessionId) && !sessionIds.has(parent))),
        updatedAt: new Date().toISOString(),
      }))
      this.entities.get(workspaceId)?.replaceRecord(record)
    }
  }

  private assertSessionAttachable(id: SessionId): void {
    if (this.deletingSessionIds.has(id) || this.deletedSessionIds.has(id)) {
      throw new WorkspaceSessionDeletingError(id)
    }
  }

  private rememberPendingSessionDeletion(state: WorkspaceDomainState): void {
    if (state.pendingMutation?.operation !== 'delete-sessions') return
    for (const id of state.pendingMutation.sessionIds) this.deletingSessionIds.add(id)
  }

  /**
   * Whether a session is live, header-indexed, or present in a fresh
   * persistence listing. Only a definite miss returns false — a failing
   * `sessionPersistence.list()` propagates so storage faults never
   * masquerade as an unknown session.
   */
  private async sessionKnown(id: SessionId): Promise<boolean> {
    if (this.ctx.get('sessions')?.get(id) !== undefined) return true
    if (this.headers.has(id)) return true
    await this.indexHeaders(await this.ctx.sessionPersistence.list())
    return this.headers.has(id)
  }

  /**
   * Resolve by canonical directory path without creating or mutating a
   * workspace. A missing path rejects during `realpath`; an existing unowned
   * directory returns `undefined`.
   * @param path - Existing directory path in any spelling.
   * @returns the workspace owning the canonical path, when one exists.
   */
  async resolveByPath(path: string): Promise<Workspace | undefined> {
    const canonical = await realpathNormalize(path)
    for (const entity of this.entities.values()) {
      if (entity.path === canonical) return entity
    }
    return undefined
  }

  private async createCanonical(canonical: string, title?: string): Promise<WorkspaceEntity> {
    for (const entity of this.entities.values()) {
      if (entity.path === canonical) return entity
    }

    const workspaceName = title ?? basename(canonical)
    const table = this.requireTable()
    const state = this.requireState()
    const id = WorkspaceId(randomUUID())
    const now = new Date().toISOString()
    const record: WorkspaceRecord = {
      path: canonical,
      title: workspaceName,
      sessionIds: [],
      nestedUnder: {},
      createdAt: now,
      updatedAt: now,
    }
    const entity = new WorkspaceEntity(this.host, id, record)
    this.entities.set(id, entity)
    const pendingState: WorkspaceDomainState = {
      ...state,
      pendingMutation: { operation: 'create', workspaceId: id },
    }
    try {
      await this.setState(pendingState)
    } catch (error) {
      this.entities.delete(id)
      throw error
    }
    try {
      await table.put(id, record)
    } catch (error) {
      this.entities.delete(id)
      try {
        await this.setState(state)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' record write and pending-marker rollback both failed`,
        )
      }
      throw error
    }

    try {
      await this.setState({
        initialized: true,
        workspaceIds: [id, ...state.workspaceIds],
        archivedSessionIds: state.archivedSessionIds,
      })
    } catch (error) {
      this.entities.delete(id)
      try {
        await table.delete(id)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' order write and record rollback both failed; the pending marker remains recoverable`,
        )
      }
      try {
        await this.setState(state)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' order write and pending-marker rollback both failed`,
        )
      }
      throw error
    }
    return entity
  }

  private async deleteKnown(id: WorkspaceId): Promise<boolean> {
    const entity = this.entities.get(id)
    if (entity === undefined) return false
    const state = this.requireState()
    const nextState = {
      initialized: true,
      workspaceIds: state.workspaceIds.filter(workspaceId => workspaceId !== id),
      archivedSessionIds: state.archivedSessionIds,
    }
    await this.setState({
      ...nextState,
      pendingMutation: { operation: 'delete', workspaceId: id },
    })
    this.entities.delete(id)
    try {
      await this.requireTable().delete(id)
    } catch (error) {
      this.entities.set(id, entity)
      try {
        await this.setState(state)
      } catch (rollbackError) {
        // The durable marker still says to finish deletion, so the cache must
        // agree with that recoverable direction rather than republish a row
        // absent from the persisted order.
        this.entities.delete(id)
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' record deletion and registry-order rollback both failed`,
        )
      }
      throw error
    }
    try {
      await this.setState(nextState)
    } catch (error) {
      // The deletion committed at the table write and was already published
      // to Host streams. Keep the durable marker for startup recovery rather
      // than reporting failure after the requested state became true.
      this.ctx.logger.warn(
        `workspace '${id}' was deleted but its pending marker could not be cleared: ${String(error)}`,
      )
    }
    return true
  }

  /**
   * Complete the one mutation explicitly named by durable state. Unexplained
   * order/table divergence still reaches {@link validateStoredState} and
   * fails loud; this path never guesses which operation created a row from its shape alone.
   */
  private async recoverPendingMutation(): Promise<void> {
    const state = this.requireState()
    const pending = state.pendingMutation
    if (pending === undefined) return
    if (pending.operation === 'delete-sessions') {
      await this.completeSessionDeletion(pending.sessionIds)
      return
    }
    if (state.workspaceIds.includes(pending.workspaceId)) {
      throw new Error(
        `workspace domain is inconsistent: pending ${pending.operation} workspace `
        + `'${pending.workspaceId}' is still present in registry order`,
      )
    }
    await this.requireTable().delete(pending.workspaceId)
    await this.setState({
      initialized: state.initialized,
      workspaceIds: state.workspaceIds,
      archivedSessionIds: state.archivedSessionIds,
    })
  }

  private async bootstrap(headers: readonly SessionHeader[]): Promise<void> {
    const table = this.requireTable()
    const state = this.requireState()
    const groupsByPath = new Map<string, SessionHeader[]>()
    for (const header of headers) {
      const path = this.sessionPaths.get(header.id)
      if (path === undefined) continue
      const group = groupsByPath.get(path)
      if (group === undefined) groupsByPath.set(path, [header])
      else group.push(header)
    }
    const groups: BootstrapGroup[] = [...groupsByPath].map(([path, groupHeaders]) => {
      groupHeaders.sort(compareHeaders)
      const newest = groupHeaders[0] as SessionHeader
      return { path, headers: groupHeaders, newestAt: newest.createdAt }
    }).sort((left, right) =>
      right.newestAt - left.newestAt || left.path.localeCompare(right.path))

    const byPath = new Map<string, WorkspaceId>()
    const accounted = new Map<SessionId, WorkspaceId>()
    for (const [id, record] of table.entries()) {
      byPath.set(record.path, id)
      for (const sessionId of record.sessionIds) accounted.set(sessionId, id)
    }

    for (const group of groups) {
      let id = byPath.get(group.path)
      if (id === undefined) {
        const sessionIds = group.headers
          .map(header => header.id)
          .filter(sessionId => !accounted.has(sessionId))
        if (sessionIds.length === 0) continue
        id = WorkspaceId(randomUUID())
        const createdAt = new Date(group.newestAt).toISOString()
        const record: WorkspaceRecord = {
          path: group.path,
          title: basename(group.path),
          sessionIds,
          nestedUnder: {},
          createdAt,
          updatedAt: createdAt,
        }
        await table.put(id, record)
        byPath.set(group.path, id)
        for (const sessionId of sessionIds) accounted.set(sessionId, id)
        continue
      }

      const current = table.get(id) as WorkspaceRecord
      const historical = group.headers
        .map(header => header.id)
        .filter(sessionId => accounted.get(sessionId) === undefined || accounted.get(sessionId) === id)
      const historicalSet = new Set(historical)
      const sessionIds = [
        ...historical,
        ...current.sessionIds.filter(sessionId => !historicalSet.has(sessionId)),
      ]
      if (sameSessionIds(current.sessionIds, sessionIds)) continue
      await table.update(id, record => ({
        ...record,
        sessionIds,
        updatedAt: new Date().toISOString(),
      }))
      for (const sessionId of historical) accounted.set(sessionId, id)
    }

    const groupRank = new Map(groups.map(group => [group.path, group.newestAt]))
    const priorRank = new Map(state.workspaceIds.map((id, index) => [id, index]))
    const workspaceIds = [...table.entries()]
      .sort(([leftId, left], [rightId, right]) => {
        const leftTime = groupRank.get(left.path) ?? Date.parse(left.createdAt)
        const rightTime = groupRank.get(right.path) ?? Date.parse(right.createdAt)
        return rightTime - leftTime
          || (priorRank.get(leftId) ?? Number.MAX_SAFE_INTEGER)
            - (priorRank.get(rightId) ?? Number.MAX_SAFE_INTEGER)
          || String(leftId).localeCompare(String(rightId))
      })
      .map(([id]) => id)

    if (!sameIds(state.workspaceIds, workspaceIds)) {
      await this.setState({ initialized: false, workspaceIds, archivedSessionIds: state.archivedSessionIds })
    }
    await this.setState({ initialized: true, workspaceIds, archivedSessionIds: state.archivedSessionIds })
  }

  private validateStoredState(state: WorkspaceDomainState): void {
    const table = this.requireTable()
    const order = new Set<WorkspaceId>()
    for (const id of state.workspaceIds) {
      if (order.has(id)) {
        throw new Error(`workspace domain is inconsistent: registry order repeats workspace '${id}'`)
      }
      if (table.get(id) === undefined) {
        throw new Error(`workspace domain is inconsistent: registry order references missing workspace '${id}'`)
      }
      order.add(id)
    }
    if (state.initialized && order.size !== table.size) {
      const orphan = [...table.keys()].find(id => !order.has(id))
      throw new Error(
        `workspace domain is inconsistent: workspace '${orphan as WorkspaceId}' is absent from registry order`,
      )
    }

    const paths = new Map<string, WorkspaceId>()
    const accounted = new Map<SessionId, WorkspaceId>()
    for (const [id, record] of table.entries()) {
      const pathHolder = paths.get(record.path)
      if (pathHolder !== undefined) {
        throw new Error(
          `workspace domain is inconsistent: path '${record.path}' is claimed `
          + `by both workspace '${pathHolder}' and workspace '${id}'`,
        )
      }
      paths.set(record.path, id)
      for (const sessionId of record.sessionIds) {
        const holder = accounted.get(sessionId)
        if (holder !== undefined) {
          throw new Error(
            `workspace domain is inconsistent: session '${sessionId}' is accounted `
            + `by both workspace '${holder}' and workspace '${id}'`,
          )
        }
        accounted.set(sessionId, id)
      }
    }
  }

  private rebuildEntities(): void {
    this.entities.clear()
    for (const id of this.requireState().workspaceIds) {
      const record = this.requireTable().get(id) as WorkspaceRecord
      this.entities.set(id, new WorkspaceEntity(this.host, id, record))
    }
  }

  private async replaceHeaderIndex(headers: readonly SessionHeader[]): Promise<void> {
    this.headers.clear()
    this.sessionPaths.clear()
    this.invalidSessionPaths.clear()
    await this.indexHeaders(headers)
  }

  private async indexHeaders(headers: readonly SessionHeader[]): Promise<void> {
    for (const header of headers) await this.indexHeader(header)
  }

  private async indexHeader(header: SessionHeader): Promise<void> {
    this.headers.set(header.id, header)
    this.sessionPaths.delete(header.id)
    if (header.cwd === undefined) {
      this.invalidSessionPaths.set(header.id, 'header has no cwd')
      return
    }
    try {
      const path = await realpathNormalize(header.cwd)
      if (!(await stat(path)).isDirectory()) {
        this.invalidSessionPaths.set(header.id, `cwd '${header.cwd}' is not a directory`)
        return
      }
      this.sessionPaths.set(header.id, path)
      this.invalidSessionPaths.delete(header.id)
    } catch {
      this.invalidSessionPaths.set(header.id, `cwd '${header.cwd}' does not resolve`)
    }
  }

  private async indexLiveSessions(): Promise<void> {
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) return
    await this.indexHeaders(sessions.list().map(session => session.header))
  }

  private reportFilteredCandidates(): void {
    for (const entity of this.entities.values()) {
      const record = this.requireTable().get(entity.id) as WorkspaceRecord
      for (const sessionId of record.sessionIds) {
        const path = this.sessionPaths.get(sessionId)
        if (path === record.path) continue
        const reason = this.invalidSessionPaths.get(sessionId)
          ?? (this.headers.has(sessionId)
            ? `canonical cwd '${path}' differs from workspace path '${record.path}'`
            : 'session header is missing')
        this.ctx.logger.warn(
          `workspace '${entity.id}' filtered session '${sessionId}' from membership: ${reason}`,
        )
      }
    }
  }

  private async readSessionHeader(id: SessionId): Promise<SessionHeader> {
    this.assertSessionAttachable(id)
    const live = this.ctx.get('sessions')?.get(id)
    if (live !== undefined) {
      this.headers.set(id, live.header)
      return live.header
    }
    const cached = this.headers.get(id)
    if (cached !== undefined) return cached

    const headers = await this.ctx.sessionPersistence.list()
    await this.indexHeaders(headers)
    const header = this.headers.get(id)
    if (header === undefined) {
      throw new Error(`cannot validate session '${id}': session persistence holds no such session`)
    }
    return header
  }

  private requireTable(): KvTable<WorkspaceId, WorkspaceRecord> {
    if (this.table === undefined) throw new Error('workspace registry is not started yet')
    return this.table
  }

  private requireState(): WorkspaceDomainState {
    if (this.state === undefined) throw new Error('workspace registry is not started yet')
    return this.state
  }

  private async setState(state: WorkspaceDomainState): Promise<void> {
    await (this.global as DomainGlobal<WorkspaceDomainState>).set(state)
    this.state = state
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(async () => {
      // A committed delete may leave only its marker cleanup pending. Retry
      // recovery before another create/delete can overwrite that pending operation record.
      await this.recoverPendingMutation()
      return await operation()
    })
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}

const sameSessionIds = (left: readonly SessionId[], right: readonly SessionId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

export default WorkspaceRegistry
