/**
 * Browser half of the native directory-picker backend: fills ui-workspace's
 * three directory-flow holes with a renderless occupant that answers each
 * `open` by driving `host.pickDirectory` (the node half's OS chooser) and
 * reporting the one outcome — picked path, cancellation, or failure — back
 * through the owner conversation. Mounting this package therefore composes
 * both sides of the native interaction with one cordis.yml row; no client
 * code branches on a capability kind.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge declaring the directory-flow holes.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { NativeFlowInjected } from './flow.ts'
import { NativeDirectoryFlow } from './flow.ts'


/** Required services (cordis fiber inject): the slot registry and the wire-facing workspace service. */
export const inject = ['slots', 'workspaces']

/**
 * Client plugin body: register the renderless native flow into all three
 * directory-flow holes through `slots.inject()` because the ui-workspace
 * entries may activate later or replace their declarations.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const injected = (): NativeFlowInjected => ({ pick: () => ctx.workspaces.pickDirectory() })
  // Every declaration lifetime must be live before the group installs; the
  // generator makes all registrations one transactional effect.
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', () =>
      ctx.slots.inject('sidebar.workspaces.sessionDirectoryFlow', function* () {
        yield ctx.slots.register({
          name: 'conversation.hero.workspace.directoryFlow', inject: injected,
        }, NativeDirectoryFlow)
        yield ctx.slots.register({
          name: 'sidebar.workspaces.directoryFlow', inject: injected,
        }, NativeDirectoryFlow)
        yield ctx.slots.register({
          name: 'sidebar.workspaces.sessionDirectoryFlow', inject: injected,
        }, NativeDirectoryFlow)
      })))
}
