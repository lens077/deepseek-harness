/**
 * The sandbox POLICY home (`ctx.sandboxPolicy`): the single owner of the
 * deployment's sandbox fallbacks plus per-session resolution: the file-effect
 * {@link SandboxMode}, the ordered `workspace-write` roots, and the durable
 * mode/directory event folds.
 * Before each agent request, the owner also contributes the resolved policy to
 * the cache-safe runtime-context snapshot. The agent loop logs that snapshot as
 * model history, so replay reconstructs the same mode and root the enforcing
 * consumers resolve without rewriting the stable system prompt.
 *
 * Enforcing filesystem, one-shot bash, and terminal backends read the SAME
 * resolved policy here. The context describes that policy without inventorying
 * capabilities, while each backend retains its own enforcement dialect and each
 * tool owns its operation-specific denial and escalation guidance. The service
 * reads session state once at each operation boundary; executors and providers
 * remain session-free.
 *
 * @module @deepseek-ai/dsh-sandbox-policy
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type { SandboxExecutionPolicy, SandboxMode, SandboxWorkspaceRoots } from '@deepseek-ai/dsh-sandbox'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  effectiveAdditionalDirectories,
  resolveWorkspaceRoot,
  setAdditionalDirectories as commitAdditionalDirectories,
} from './session-directories.ts'
import { effectiveSandboxMode } from './session-mode.ts'

export {
  AdditionalDirectoryError,
  canonicalAdditionalDirectories,
  effectiveAdditionalDirectories,
  resolveWorkspaceRoot,
  setAdditionalDirectories,
} from './session-directories.ts'
export type { AdditionalDirectoryErrorCode } from './session-directories.ts'
export { SANDBOX_MODES, effectiveSandboxMode, setSandboxMode } from './session-mode.ts'

/** Render the policy without claiming which capabilities are mounted. */
function renderPolicyContext(policy: SandboxExecutionPolicy): string {
  switch (policy.mode) {
    case 'read-only':
      return 'Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.'
    case 'workspace-write':
      return `Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under these session workspace roots: ${JSON.stringify(policy.workspaceRoots)}. The first root is the primary working directory; later roots are additional directories. Some platform temporary areas may also be writable.`
    case 'danger-full-access':
      return 'Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.'
    /* v8 ignore next 4 -- SandboxMode is a typed same-process closed union; this branch is only the static exhaustiveness guard. */
    default: {
      const mode: never = policy.mode
      throw new Error(`unreachable sandbox mode: ${String(mode)}`)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sandboxPolicy: SandboxPolicyService
  }
}

/**
 * Plugin config: the deployment's sandbox default. All optional — `Config`
 * supplies the defaults (`mode: 'read-only'` is the fail-safe default; a
 * deployment that wants a workspace-writable agent opts in explicitly). The
 * runner choice is NOT here (it is the `ctx.sandbox` provider's config), nor
 * is any per-family knob: this is the one shared policy home.
 */
export interface Config {
  /** File-sandbox mode a session starts from (default: `read-only`). */
  mode?: SandboxMode
  /**
   * Fallback root for agentless calls and sessions without a cwd (default:
   * `process.cwd()`). Normal agent calls use their session cwd instead.
   */
  workspaceRoot?: string
}

/** Inputs that select the sandbox policy for one capability call. */
export interface SandboxPolicyRequest {
  /** Calling session; its cwd and directory snapshot become the workspace roots. */
  session?: Session
  /** Explicit approved mode override, which outranks session policy. */
  mode?: SandboxMode
}

/**
 * The sandbox-policy service (`ctx.sandboxPolicy`). Owns the deployment
 * default mode, fallback primary root, and current request-time policy section.
 * Tool layers call {@link resolve} for each execution so a session's mode log,
 * immutable cwd, and directory snapshot travel together to every enforcing
 * capability.
 */
export class SandboxPolicyService extends Service {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    mode: z.union(['read-only', 'workspace-write', 'danger-full-access'] as const).default('read-only'),
    // No schema default: process.cwd() is resolved in the constructor so the
    // stored root is always absolute regardless of how it was supplied.
    workspaceRoot: z.string(),
  })

  /** The deployment default mode — the fallback beneath a session override. */
  readonly defaultMode: SandboxMode
  /** The absolute `workspace-write` fallback root for calls without a session cwd. */
  readonly workspaceRoot: string
  constructor(ctx: Context, config: Config) {
    super(ctx, 'sandboxPolicy')
    // schemastery (static Config) already filled `mode`; the cast records that
    // runtime fact. `workspaceRoot` has NO schema default, so its fallback to
    // the process cwd is real branching, resolved absolute either way.
    this.defaultMode = config.mode as SandboxMode
    this.workspaceRoot = resolveWorkspaceRoot(config.workspaceRoot ?? process.cwd())

    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'sandbox:policy',
        order: 110,
        text: (context) => {
          const session = context.agent?.session
          return session === undefined
            ? ''
            : renderPolicyContext(this.resolve({ session }))
        },
      })
    })
  }

  /**
   * Resolve the complete policy for one capability call. An approved explicit
   * mode outranks the session's last `sandbox/mode` event, which outranks the
   * deployment default. A session cwd remains the primary workspace root; the
   * latest `session/directories` snapshot extends only the writable allowlist.
   * The configured root is the fallback for agentless calls and sessions
   * without a cwd.
   * @param request - optional session and approved mode override.
   * @returns the fully resolved per-call mode and ordered canonical roots.
   */
  resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy {
    const { session } = request
    const primary = resolveWorkspaceRoot(session?.header.cwd ?? this.workspaceRoot)
    // Additional roots are already canonical durable values. Replaying them must
    // not consult a symlink target that may have changed since the event commit.
    const additional = new Set(
      session === undefined ? [] : effectiveAdditionalDirectories(session.events),
    )
    additional.delete(primary)
    const workspaceRoots: SandboxWorkspaceRoots = [primary, ...additional]
    return {
      mode: request.mode ?? (session === undefined ? undefined : this.overrideOf(session)) ?? this.defaultMode,
      workspaceRoots,
      ...session === undefined ? {} : { sessionId: session.id },
    }
  }

  /**
   * Read the session's durable additional-directory list.
   * @param session - session whose log supplies the latest snapshot.
   * @returns the immutable canonical list, empty without a snapshot.
   */
  additionalDirectoriesOf(session: Session): readonly string[] {
    return effectiveAdditionalDirectories(session.events)
  }

  /**
   * Replace one session's additional writable directories. Paths must be
   * absolute existing directories; aliases of the primary root or an earlier
   * entry are removed before the whole-list event commits.
   * @param session - owning session.
   * @param directories - complete requested additional-directory list.
   * @returns the committed canonical list.
   */
  setAdditionalDirectories(session: Session, directories: readonly string[]): readonly string[] {
    const primary = resolveWorkspaceRoot(session.header.cwd ?? this.workspaceRoot)
    return commitAdditionalDirectories(session, primary, directories)
  }

  /**
   * Read the session override without applying the deployment default.
   * @param session - session whose log supplies the override.
   * @returns the last logged mode, or `undefined` without one.
   */
  overrideOf(session: Session): SandboxMode | undefined {
    return effectiveSandboxMode(session.events)
  }
}

export default SandboxPolicyService
