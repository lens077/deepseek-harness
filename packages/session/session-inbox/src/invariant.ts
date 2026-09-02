/** Package-owned invariant companion. @module @deepseek-ai/dsh-session-inbox/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-inbox'

/** Cordis companion plugin name. */
export const name = 'session-inbox-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the service's private serialized writer owns every
 * row mutation, the domain schemas validate rows on reopen, and every
 * `session-inbox/changed` payload is the snapshot read back from the same
 * tables it was written to, so no second authority exists to compare against.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['sessionInbox'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
