/**
 * Package-private workspace entity: the single {@link Workspace}
 * implementation. Holds a record snapshot that is swapped in place after each
 * durable mutation; every write funnels through the private `mutate` so
 * `updatedAt` stamping and invalid-account pruning happen exactly once.
 * Not re-exported from the package entrypoint — consumers see only the
 * `Workspace` interface.
 * @module @deepseek-ai/dsh-workspace/src/entity
 */

import { stat } from 'node:fs/promises'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceRecord } from './spec.ts'
import type { Workspace, WorkspaceId } from './types.ts'
import { realpathNormalize } from './paths.ts'

/** An insertSessionBefore request named a session or anchor not on the account (storage failures stay plain errors). */
export class WorkspaceMoveInvalidError extends Error {
  /**
   * @param message - Which id was unaccounted and where.
   */
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceMoveInvalidError'
  }
}

/** A membership request named a Session that cannot belong to the Workspace path. */
export class WorkspaceMembershipInvalidError extends Error {
  /**
   * @param message - Validation failure with the Session and Workspace paths.
   * @param options - Optional underlying header or filesystem error.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WorkspaceMembershipInvalidError'
  }
}

/** An attach request named an invalid nested-placement parent (unaccounted, self, or cycle-forming). */
export class WorkspaceNestInvalidError extends Error {
  /**
   * @param message - Which parent was invalid and why.
   */
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceNestInvalidError'
  }
}

/**
 * The registry-owned machinery an entity mutates through. Entities never see
 * the registry itself — only the open table, the canonical session-path
 * index backing the `sessionIds` projection, and attach-time header reads.
 */
export interface WorkspaceEntityHost {
  /**
   * Resolve the open `workspaces` table.
   * @returns the table; throws while the registry has not started yet.
   */
  table(): KvTable<WorkspaceId, WorkspaceRecord>

  /**
   * Read a session's canonical directory from the registry's header index.
   * @param id - Session whose indexed path is requested.
   * @returns the canonical directory, or `undefined` when the header is
   * missing or its cwd cannot identify an existing directory.
   */
  sessionPath(id: SessionId): string | undefined

  /**
   * Read one stored session header for attach validation.
   * @param id - The session whose header to read.
   * @returns the header; rejects when session persistence is absent or holds
   * no session with this id.
   */
  readSessionHeader(id: SessionId): Promise<SessionHeader>

  /**
   * Reject attachment after permanent deletion has reserved or tombstoned an id.
   * @param id - Session identity entering an account mutation.
   */
  assertSessionAttachable(id: SessionId): void

  /**
   * Publish a successfully validated canonical cwd to the projection index.
   * @param id - Validated session id.
   * @param path - Canonical existing directory from the immutable header cwd.
   */
  rememberSessionPath(id: SessionId, path: string): void
}

/** Chain-slot abort sentinel thrown by the update fn when the record needs no change; only `mutate` observes it. */
const unchangedSentinel = new Error('workspace record unchanged (internal sentinel)')

/** The single {@link Workspace} implementation; constructed only by the registry. */
export class WorkspaceEntity implements Workspace {
  private record: WorkspaceRecord

  /**
   * @param host - Registry-owned table, session-path index, and header reads.
   * @param id - The record's stable id.
   * @param record - The validated record snapshot loaded or just written.
   */
  constructor(
    private readonly host: WorkspaceEntityHost,
    readonly id: WorkspaceId,
    record: WorkspaceRecord,
  ) {
    this.record = record
  }

  get path(): string {
    return this.record.path
  }

  get title(): string {
    return this.record.title
  }

  get createdAt(): string {
    return this.record.createdAt
  }

  get updatedAt(): string {
    return this.record.updatedAt
  }

  get sessionIds(): readonly SessionId[] {
    return this.record.sessionIds.filter(id => this.host.sessionPath(id) === this.record.path)
  }

  get nestedUnder(): Readonly<Record<string, SessionId>> {
    const accounted = new Set<string>(this.sessionIds)
    // Pre-field media: a snapshot loaded before the field existed serves the
    // empty map until its first durable mutation normalizes it.
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- the parsed type requires the field; unparsed pre-field media does not
    return Object.fromEntries(Object.entries(this.record.nestedUnder ?? {})
      .filter(([child, parent]) => accounted.has(child) && accounted.has(parent)))
  }

  /**
   * Replace this projection after a registry-owned table mutation commits.
   * @param record - the committed durable record.
   */
  replaceRecord(record: WorkspaceRecord): void {
    this.record = record
  }

  async setTitle(title: string): Promise<void> {
    await this.mutate(record => ({ ...record, title }))
  }

  async attachSession(sessionId: SessionId, options?: { nestUnder?: SessionId }): Promise<void> {
    this.host.assertSessionAttachable(sessionId)
    // Validation is skipped when the settled snapshot already accounts the
    // id: the cwd fact was checked when it first attached and both inputs
    // (stored header cwd, workspace path) are immutable. Membership itself is
    // decided on the write chain inside `mutate`, never on this snapshot.
    if (!this.record.sessionIds.includes(sessionId)) await this.validateAttachment(sessionId)
    await this.mutate((record) => {
      this.host.assertSessionAttachable(sessionId)
      const nestUnder = options?.nestUnder
      const sessionIds = record.sessionIds.includes(sessionId)
        ? record.sessionIds
        : [sessionId, ...record.sessionIds]
      if (nestUnder === undefined) {
        return sessionIds === record.sessionIds ? record : { ...record, sessionIds }
      }
      // Nested placement is decided on the write chain like membership: the
      // parent must be accounted at this chain slot, and the parent chain
      // must not lead back to the attached session (a cycle would orphan the
      // whole branch from every top-level walk).
      if (nestUnder === sessionId) {
        throw new WorkspaceNestInvalidError(
          `cannot nest session '${sessionId}' under itself in workspace '${record.path}'`,
        )
      }
      if (!record.sessionIds.includes(nestUnder)) {
        throw new WorkspaceNestInvalidError(
          `cannot nest session '${sessionId}' under '${nestUnder}' in workspace '${record.path}': `
          + 'the parent session is not accounted',
        )
      }
      for (let ancestor = record.nestedUnder[nestUnder]; ancestor !== undefined; ancestor = record.nestedUnder[ancestor]) {
        if (ancestor === sessionId) {
          throw new WorkspaceNestInvalidError(
            `cannot nest session '${sessionId}' under '${nestUnder}' in workspace '${record.path}': `
            + 'the parent chain leads back to the session',
          )
        }
      }
      if (sessionIds === record.sessionIds && record.nestedUnder[sessionId] === nestUnder) return record
      return { ...record, sessionIds, nestedUnder: { ...record.nestedUnder, [sessionId]: nestUnder } }
    })
  }

  async attachSessions(sessionIds: readonly SessionId[]): Promise<void> {
    const unique = [...new Set(sessionIds)]
    for (const sessionId of unique) this.host.assertSessionAttachable(sessionId)
    await Promise.all(unique
      .filter(sessionId => !this.record.sessionIds.includes(sessionId))
      .map(sessionId => this.validateAttachment(sessionId)))
    await this.mutate((record) => {
      for (const sessionId of unique) this.host.assertSessionAttachable(sessionId)
      const added = unique.filter(sessionId => !record.sessionIds.includes(sessionId))
      return added.length === 0 ? record : { ...record, sessionIds: [...added, ...record.sessionIds] }
    })
  }

  async insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void> {
    await this.mutate((record) => {
      if (!record.sessionIds.includes(sessionId)) {
        throw new WorkspaceMoveInvalidError(
          `cannot move session '${sessionId}' in workspace '${record.path}': the session is not accounted`,
        )
      }
      if (beforeSessionId !== undefined && !record.sessionIds.includes(beforeSessionId)) {
        throw new WorkspaceMoveInvalidError(
          `cannot move session '${sessionId}' before '${beforeSessionId}' in workspace '${record.path}': `
          + 'the anchor session is not accounted',
        )
      }
      if (beforeSessionId === sessionId) return record
      const without = record.sessionIds.filter(id => id !== sessionId)
      const at = beforeSessionId === undefined ? without.length : without.indexOf(beforeSessionId)
      const sessionIds = [...without.slice(0, at), sessionId, ...without.slice(at)]
      return sessionIds.every((id, index) => id === record.sessionIds[index])
        ? record
        : { ...record, sessionIds }
    })
  }

  async detachSession(sessionId: SessionId): Promise<void> {
    await this.detachSessions([sessionId])
  }

  async detachSessions(sessionIds: readonly SessionId[]): Promise<void> {
    const removed = new Set(sessionIds)
    await this.mutate((record) => {
      if (!record.sessionIds.some(sessionId => removed.has(sessionId))) return record
      // Children nested under a detached parent are promoted to top level:
      // accounting removal never expands to a whole visual branch.
      const nestedUnder = Object.fromEntries(Object.entries(record.nestedUnder)
        .filter(([child, parent]) => !removed.has(child as SessionId) && !removed.has(parent)))
      return {
        ...record,
        sessionIds: record.sessionIds.filter(sessionId => !removed.has(sessionId)),
        nestedUnder,
      }
    })
  }

  async status(): Promise<'ok' | 'missing-dir'> {
    try {
      return (await stat(this.record.path)).isDirectory() ? 'ok' : 'missing-dir'
    } catch {
      // Any stat failure (ENOENT, dangling parent, permission loss) means the
      // directory is not usable right now; the record itself never mutates.
      return 'missing-dir'
    }
  }

  private async validateAttachment(sessionId: SessionId): Promise<void> {
    let header: SessionHeader
    try {
      header = await this.host.readSessionHeader(sessionId)
    } catch (error) {
      throw new WorkspaceMembershipInvalidError(
        `cannot attach unknown session '${sessionId}' to workspace '${this.record.path}': `
        + (error instanceof Error ? error.message : String(error)),
        { cause: error },
      )
    }
    if (header.cwd === undefined) {
      throw new WorkspaceMembershipInvalidError(
        `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
        + 'its stored header carries no cwd to validate against',
      )
    }
    let cwd: string
    try {
      cwd = await realpathNormalize(header.cwd)
    } catch (error) {
      throw new WorkspaceMembershipInvalidError(
        `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
        + `its cwd '${header.cwd}' does not resolve, so it cannot be validated`,
        { cause: error },
      )
    }
    if (!(await stat(cwd)).isDirectory()) {
      throw new WorkspaceMembershipInvalidError(
        `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
        + `its cwd '${header.cwd}' is not a directory`,
      )
    }
    if (cwd !== this.record.path) {
      throw new WorkspaceMembershipInvalidError(
        `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
        + `its cwd resolves to '${cwd}'`,
      )
    }
    this.host.rememberSessionPath(sessionId, cwd)
  }

  /**
   * The single write path: run `fn` on the domain write chain via
   * `table.update`, stamping `updatedAt` and pruning candidates that no
   * longer pass the id-plus-canonical-cwd membership check, then swap the
   * snapshot.
   *
   * `fn` sees the value current at its chain slot, so membership decisions
   * (attach/detach idempotence) are race-free against queued writes; a fn
   * signalling no change by returning `current` verbatim aborts the slot
   * through the sentinel when pruning also finds nothing, so a no-op neither
   * rewrites the medium nor emits a change event.
   */
  private async mutate(fn: (record: WorkspaceRecord) => WorkspaceRecord): Promise<void> {
    let next: WorkspaceRecord
    try {
      next = await this.host.table().update(this.id, (stored) => {
        // Pre-field media may reach this chain slot without the nesting map;
        // normalize at the durable boundary so `fn` and the prune below read
        // the defaulted field (the archivedSessionIds arrangement).
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- parsed type requires the field; unparsed pre-field media lacks it
        const current: WorkspaceRecord = stored.nestedUnder === undefined
          ? { ...stored, nestedUnder: {} }
          : stored
        const changed = fn(current)
        const sessionIds = changed.sessionIds.filter(
          id => this.host.sessionPath(id) === changed.path,
        )
        // Nesting entries follow the membership prune: an entry survives only
        // while both of its ends remain accounted members.
        const accounted = new Set<string>(sessionIds)
        const nestedUnder = Object.fromEntries(Object.entries(changed.nestedUnder)
          .filter(([child, parent]) => accounted.has(child) && accounted.has(parent)))
        const nestingPruned = Object.keys(nestedUnder).length !== Object.keys(changed.nestedUnder).length
        if (changed === current && sessionIds.length === current.sessionIds.length && !nestingPruned) {
          throw unchangedSentinel
        }
        return { ...changed, sessionIds, nestedUnder, updatedAt: new Date().toISOString() }
      })
    } catch (error) {
      if (error === unchangedSentinel) return
      throw error
    }
    this.record = next
  }
}
