/** Package-owned session-event invariants for sandbox policy. @module @deepseek-ai/dsh-sandbox-policy/invariant */

import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { SANDBOX_MODES } from './session-mode.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-sandbox-policy'

/** Cordis companion plugin name. */
export const name = 'sandbox-policy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(session: Session, fallbackRoot: string, event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'sandbox/mode' && !SANDBOX_MODES.includes(event.data.mode)) {
    fail(`sandbox/mode carries unknown mode ${JSON.stringify(event.data.mode)}`)
    return
  }
  if (event.type !== 'session/directories') return
  const value: unknown = event.data.additionalDirectories
  if (!Array.isArray(value) || !value.every(path => typeof path === 'string' && isAbsolute(path))) {
    fail('session/directories must carry only absolute path strings')
    return
  }
  // Replay validates the durable spelling only; it never probes whether the
  // roots still exist or follows a symlink whose target may have changed.
  const primary = resolve(session.header.cwd ?? fallbackRoot)
  const canonical = value.map(path => resolve(path))
  if (canonical.some((path, index) => path !== value[index])) {
    fail('session/directories must carry canonical path identities')
    return
  }
  if (new Set([primary, ...canonical]).size !== canonical.length + 1) {
    fail('session/directories must exclude the primary cwd and duplicate directory identities')
  }
}

/** Install validation for loaded and newly appended sandbox modes and directories. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateEvent(session, ctx.sandboxPolicy.workspaceRoot, event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(session, ctx.sandboxPolicy.workspaceRoot, event, fail)
  }, { global: true })
}, { inject: ['sessions', 'sandboxPolicy'] })
/* jscpd:ignore-end */

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
