/**
 * Session-level additional writable directories: validation, canonicalization,
 * durable whole-list writes, and replay folding.
 * @module dsh-sandbox-policy/session-directories
 */

import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'

/** Why an additional directory cannot enter a session policy. */
export type AdditionalDirectoryErrorCode = 'not-absolute' | 'unavailable' | 'not-directory'

/** A rejected additional directory with a stable machine-readable reason. */
export class AdditionalDirectoryError extends Error {
  /** The rejected path exactly as supplied by the caller. */
  readonly path: string
  /** Stable rejection reason for wire adapters. */
  readonly code: AdditionalDirectoryErrorCode

  /**
   * @param path - rejected caller-supplied path.
   * @param code - stable rejection reason.
   * @param cause - optional filesystem failure.
   */
  constructor(path: string, code: AdditionalDirectoryErrorCode, cause?: unknown) {
    const detail = code === 'not-absolute'
      ? 'must be absolute'
      : code === 'not-directory'
        ? 'is not a directory'
        : 'does not exist or cannot be resolved'
    super(`additional directory ${JSON.stringify(path)} ${detail}`, cause === undefined ? undefined : { cause })
    this.name = 'AdditionalDirectoryError'
    this.path = path
    this.code = code
  }
}

/**
 * Resolve one primary workspace path to the identity used by sandbox policy.
 * Missing paths retain their spelling, matching the longstanding primary-cwd
 * behavior; additional directories use the stricter validator below.
 * @param path - configured fallback or session cwd.
 * @returns absolute filesystem identity.
 */
export function resolveWorkspaceRoot(path: string): string {
  const absolute = resolve(canonicalPath(path))
  try {
    return resolve(realpathSync.native(absolute))
  } catch {
    // Primary roots preserve the longstanding missing-path behavior; additional
    // roots pass through the strict validator below and cannot reach this arm.
    return absolute
  }
}

/** Resolve and verify one caller-supplied additional directory. */
function canonicalAdditionalDirectory(path: string): string {
  if (!isAbsolute(path)) throw new AdditionalDirectoryError(path, 'not-absolute')
  let canonical: string
  try {
    canonical = resolve(realpathSync.native(path))
  } catch (error: unknown) {
    throw new AdditionalDirectoryError(path, 'unavailable', error)
  }
  try {
    if (!statSync(canonical).isDirectory()) throw new AdditionalDirectoryError(path, 'not-directory')
  } catch (error: unknown) {
    if (error instanceof AdditionalDirectoryError) throw error
    throw new AdditionalDirectoryError(path, 'unavailable', error)
  }
  return canonical
}

/**
 * Canonicalize an ordered additional-directory list, removing filesystem aliases
 * of the primary root and earlier entries. Ancestor and descendant roots remain:
 * each is an explicit caller grant, and the implementation never substitutes a
 * common parent.
 * @param primaryRoot - resolved primary workspace identity.
 * @param directories - caller-supplied additional directories.
 * @returns canonical, order-preserving, deduplicated directories.
 */
export function canonicalAdditionalDirectories(
  primaryRoot: string,
  directories: readonly string[],
): string[] {
  const canonicalPrimary = resolveWorkspaceRoot(primaryRoot)
  const seen = new Set([canonicalPrimary])
  const result: string[] = []
  for (const path of directories) {
    const canonical = canonicalAdditionalDirectory(path)
    if (seen.has(canonical)) continue
    seen.add(canonical)
    result.push(canonical)
  }
  return result
}

/**
 * Fold the last durable additional-directory snapshot.
 * @param events - session log in sequence order.
 * @returns the latest list, or an empty list when no snapshot exists.
 */
export function effectiveAdditionalDirectories(events: readonly SessionEvent[]): readonly string[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'session/directories') return event.data.additionalDirectories
  }
  return []
}

/** Whether two ordered directory snapshots carry the same canonical values. */
function directoriesEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index])
}

/**
 * Replace a session's additional-directory snapshot after strict filesystem
 * validation. Equal canonical input is idempotent and appends nothing.
 * @param session - owning session.
 * @param primaryRoot - resolved primary root used to reject aliases of cwd.
 * @param directories - complete requested additional-directory list.
 * @returns the committed canonical list.
 */
export function setAdditionalDirectories(
  session: Session,
  primaryRoot: string,
  directories: readonly string[],
): readonly string[] {
  const canonical = canonicalAdditionalDirectories(primaryRoot, directories)
  const previous = effectiveAdditionalDirectories(session.events)
  if (directoriesEqual(previous, canonical)) return previous
  return session.append('session/directories', { additionalDirectories: canonical }).data.additionalDirectories
}
