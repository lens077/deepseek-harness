/** Package-owned invariant companion. @module @deepseek-ai/dsh-project-todos/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-project-todos'

/** Cordis companion plugin name. */
export const name = 'project-todos-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the service owns no durable state of its own — every
 * snapshot is recomputed from the user's files by one serialized scan, and
 * every `project-todos/changed` payload is the snapshot `get` serves next,
 * so no second authority exists to compare against.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['projectTodos'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
