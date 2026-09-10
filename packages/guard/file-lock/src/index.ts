/**
 * Cross-session file lock policy. A `tools/execute` wrapper leases a file to
 * the session that modifies it until that session's turn ends; a foreign
 * write queues for the lease and is refused after `writeWaitMs`; a foreign
 * read waits `readWaitMs`, then asks the user to read now or keep waiting,
 * and a kept wait subscribes for the release with no time bound. Every
 * decision is a `file-lock/*` session event folded into the `fileLocks`
 * projection.
 *
 * @module @deepseek-ai/dsh-tool-call-file-lock
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-settings'
import type { ToolDispatchExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import { fileLocksProjection } from './projection.ts'
import { FileLockRegistry, type Lease, type LeaseHolder } from './registry.ts'
import type { FileAccess, FileLockHolder, FileLockSettings, FileLockWaitOutcome } from './types.ts'

export type * from './types.ts'
export { FileLockRegistry } from './registry.ts'
export type { Lease, LeaseHolder, WaitOutcome } from './registry.ts'
export { fileLocksProjection } from './projection.ts'

/** Cordis plugin name used by loader diagnostics and as the notice source. */
export const name = 'file-lock'

/** Required services: tool dispatch, live agents, path resolution, and the projection registry. */
export const inject = ['tools', 'agents', 'fs', 'sessionProjections']

/** Settings namespace the user-editable section is stored under. */
export const FILE_LOCK_SETTINGS_NAMESPACE = 'file-lock'

/** Structured error code of a refused write. */
export const FILE_LOCKED = 'FILE_LOCKED'

/** Option label that reads the file while the foreign lease is live. */
export const READ_NOW_LABEL = 'Read now'
/** Option label that keeps waiting until the lease is released. */
export const KEEP_WAITING_LABEL = 'Keep waiting'

/** Which argument of one tool names the file and which access the call performs. */
export interface ToolAccessRule {
  /** Registered tool name. */
  readonly tool: string
  /** Argument carrying the path the tool resolves. */
  readonly pathArgument: string
  /** Access the call performs unless `readWhenArgument` carries one of `readWhenValues`. */
  readonly access: FileAccess
  /** Argument whose value can turn a `write` rule into a read for one call. */
  readonly readWhenArgument?: string
  /** Values of `readWhenArgument` under which the call only reads. */
  readonly readWhenValues?: string[]
}

/** Complete plugin configuration: the user-editable section plus the tool rules. */
export interface Config extends FileLockSettings {
  /** Tools the policy covers; a tool absent here is never locked. */
  readonly tools: ToolAccessRule[]
}

/** Loader validation of the user-editable section; also the settings schema. */
export const FileLockSettingsSchema: z<FileLockSettings> = z.object({
  readWaitMs: z.number().step(1).min(0).default(30_000),
  writeWaitMs: z.number().step(1).min(0).default(600_000),
  leaseTtlMs: z.number().step(1).min(0).default(1_800_000),
  delegatedReadTimeout: z.union(['wait', 'read-now']).default('wait'),
})

/** Rules for the shipped filesystem tools. */
export const DEFAULT_TOOL_RULES: ToolAccessRule[] = [
  { tool: 'read', pathArgument: 'file_path', access: 'read' },
  { tool: 'read_image', pathArgument: 'file_path', access: 'read' },
  { tool: 'write', pathArgument: 'file_path', access: 'write' },
  { tool: 'edit', pathArgument: 'file_path', access: 'write' },
  { tool: 'str_replace_editor', pathArgument: 'path', access: 'write', readWhenArgument: 'command', readWhenValues: ['view'] },
]

const ToolAccessRuleSchema: z<ToolAccessRule> = z.object({
  tool: z.string().required(),
  pathArgument: z.string().required(),
  access: z.union(['read', 'write']).required(),
  readWhenArgument: z.string(),
  readWhenValues: z.array(z.string()),
})

/** Loader validation for the complete configuration. */
export const Config: z<Config> = z.object({
  readWaitMs: z.number().step(1).min(0).default(30_000),
  writeWaitMs: z.number().step(1).min(0).default(600_000),
  leaseTtlMs: z.number().step(1).min(0).default(1_800_000),
  delegatedReadTimeout: z.union(['wait', 'read-now']).default('wait'),
  tools: z.array(ToolAccessRuleSchema).default(DEFAULT_TOOL_RULES.map(rule => ({ ...rule }))),
})

/** The access one call performs under its rule. */
function accessOf(rule: ToolAccessRule, args: Record<string, unknown>): FileAccess {
  if (rule.readWhenArgument === undefined || rule.readWhenValues === undefined) return rule.access
  const value = args[rule.readWhenArgument]
  return typeof value === 'string' && rule.readWhenValues.includes(value) ? 'read' : rule.access
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`
}

/** One resolved lock target of a tool call. */
interface LockTarget {
  readonly key: string
  readonly path: string
}

/**
 * Register the policy: the settings section, the `fileLocks` projection, the
 * turn-end and disposal releases, and the `tools/execute` wrapper.
 * @param ctx - plugin context; every registration is scoped to it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const entry: FileLockSettings = {
    readWaitMs: config.readWaitMs,
    writeWaitMs: config.writeWaitMs,
    leaseTtlMs: config.leaseTtlMs,
    delegatedReadTimeout: config.delegatedReadTimeout,
  }
  let settings: () => FileLockSettings = () => entry
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, FILE_LOCK_SETTINGS_NAMESPACE, FileLockSettingsSchema, entry, {
      setSource: (current) => { settings = current },
      onChange: () => {},
    })
  })

  const rules = new Map(config.tools.map(rule => [rule.tool, rule]))
  /** Keys each session logged `file-lock/acquired` for in its open turn. */
  const acquiredKeys = new Map<SessionId, Set<string>>()
  /** Keys each session chose to read against a live foreign lease for the rest of its turn. */
  const readNowKeys = new Map<SessionId, Set<string>>()

  const registry = new FileLockRegistry({
    leaseTtlMs: () => settings().leaseTtlMs,
    onExpire: (lease) => {
      for (const holder of lease.holders) {
        acquiredKeys.get(holder)?.delete(lease.key)
        // A disposed agent already released its share through `agent/disposed`.
        ctx.agents.get(holder)?.session.append('file-lock/released', { paths: [lease.path], reason: 'ttl' })
      }
    },
  })
  ctx.effect(() => () => { registry.dispose() })
  ctx.sessionProjections.register(fileLocksProjection)

  const forget = (session: SessionId): void => {
    registry.releaseAll(session)
    acquiredKeys.delete(session)
    readNowKeys.delete(session)
  }
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end') forget(session.id)
  })
  ctx.on('agent/disposed', ({ agent }) => { forget(agent.id) })

  /** The root agent of `agent`'s runtime family. */
  const familyOf = (agent: Agent): SessionId => {
    let current = agent
    while (true) {
      const owner = ctx.agents.list().find(candidate => ctx.agents.isOwnedBy(current.id, candidate))
      if (owner === undefined) return current.id
      current = owner
    }
  }

  const describeHolder = (lease: Lease): FileLockHolder => {
    const session = ctx.agents.get(lease.owner)?.session
    const cwd = session?.header.cwd
    /* v8 ignore start -- an owner's disposal releases its share, so a live lease names a live owner */
    const title = session === undefined ? undefined : ctx.get('sessionTitle')?.get(session)?.title
    /* v8 ignore stop */
    return {
      session: lease.owner,
      ...cwd === undefined ? {} : { cwd },
      ...title === undefined ? {} : { title },
    }
  }

  const holderLabel = (holder: FileLockHolder): string => {
    const who = holder.title === undefined ? `session ${holder.session}` : `session "${holder.title}"`
    return holder.cwd === undefined ? who : `${who} (workspace ${holder.cwd})`
  }

  const notice = (text: string, summary: string): UserMessage => createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name, form: 'notice', summary },
  })

  const withNotice = async (next: () => Promise<ToolExecutionResult>, message: UserMessage): Promise<ToolExecutionResult> => {
    const result = await next()
    return { ...result, additionalContexts: [...result.additionalContexts ?? [], message] }
  }

  const refusal = (path: string, holder: FileLockHolder, since: number, waitedMs: number): ToolExecutionResult => {
    const message = `file lock: "${path}" is being modified by ${holderLabel(holder)} since ${new Date(since).toISOString()}; `
      + `waited ${seconds(waitedMs)}. Wait for that session to finish its turn, or work on a different file.`
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
      error: { message, info: { name: 'FileLockError', code: FILE_LOCKED } },
    }
  }

  /** The lock target of one call, or undefined when its path argument is not a string the tool could resolve. */
  const resolveTarget = async (
    exec: ToolDispatchExecution, agent: Agent, args: Record<string, unknown>, rule: ToolAccessRule,
  ): Promise<LockTarget | undefined> => {
    const requested = args[rule.pathArgument]
    if (typeof requested !== 'string' || requested.length === 0) return undefined
    const cwd = agent.session.header.cwd
    const target = await ctx.fs.resolve(requested, { ...cwd === undefined ? {} : { cwd }, signal: exec.signal })
    return { key: String(target.targetKey), path: target.displayPath }
  }

  const remember = (table: Map<SessionId, Set<string>>, session: SessionId, key: string): boolean => {
    let keys = table.get(session)
    if (keys === undefined) {
      keys = new Set()
      table.set(session, keys)
    }
    if (keys.has(key)) return false
    keys.add(key)
    return true
  }

  const settle = (agent: Agent, target: LockTarget, access: FileAccess, outcome: FileLockWaitOutcome, startedAt: number): number => {
    const waitedMs = Date.now() - startedAt
    agent.session.append('file-lock/settled', { path: target.path, access, outcome, waitedMs })
    return waitedMs
  }

  const write = async (
    exec: ToolDispatchExecution, agent: Agent, holder: LeaseHolder, target: LockTarget, next: () => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> => {
    const acquired = (): Promise<ToolExecutionResult> => {
      if (remember(acquiredKeys, agent.id, target.key)) {
        agent.session.append('file-lock/acquired', { path: target.path })
      }
      return next()
    }
    const foreign = registry.foreignLease(target.key, holder.family)
    if (foreign === undefined) {
      // A free or family-held key grants synchronously.
      await registry.acquire(target.key, target.path, holder, exec.signal, 0)
      return acquired()
    }
    const startedAt = Date.now()
    const description = describeHolder(foreign)
    agent.session.append('file-lock/waiting', { path: target.path, access: 'write', holder: description })
    const outcome = await registry.acquire(target.key, target.path, holder, exec.signal, settings().writeWaitMs)
    if (outcome === 'timeout') {
      const waitedMs = settle(agent, target, 'write', 'refused', startedAt)
      return refusal(target.path, description, foreign.since, waitedMs)
    }
    if (outcome === 'aborted') {
      settle(agent, target, 'write', 'aborted', startedAt)
      return next()
    }
    settle(agent, target, 'write', 'released', startedAt)
    return acquired()
  }

  const readNowNotice = (target: LockTarget, holder: FileLockHolder): UserMessage => notice(
    `[file-lock] "${target.path}" is being modified by ${holderLabel(holder)} right now; the content you read may be incomplete or change again.`,
    `read ${target.path} during a foreign modification`,
  )

  const releasedNotice = (target: LockTarget, holder: FileLockHolder, waitedMs: number): UserMessage => notice(
    `[file-lock] waited ${seconds(waitedMs)} until ${holderLabel(holder)} finished modifying "${target.path}"; the content you read is the released version.`,
    `read ${target.path} after a ${seconds(waitedMs)} wait`,
  )

  /** Ask the human, racing the question against the lease release. */
  const ask = async (
    exec: ToolDispatchExecution, agent: Agent, family: SessionId, target: LockTarget, holder: FileLockHolder,
    userQuestions: UserQuestionService,
  ): Promise<'read-now' | 'keep-waiting' | 'released' | 'aborted' | 'unavailable'> => {
    const controller = new AbortController()
    const onAbort = (): void => { controller.abort(exec.signal.reason) }
    exec.signal.addEventListener('abort', onAbort, { once: true })
    try {
      const release = registry.awaitRelease(target.key, family, controller.signal)
      const question = userQuestions.ask({
        agent,
        signal: controller.signal,
        questions: [{
          id: 'file-lock',
          header: 'File lock',
          question: `"${target.path}" is being modified by ${holderLabel(holder)}. Read it now, or keep waiting until that session finishes?`,
          options: [
            { label: READ_NOW_LABEL, description: 'Read the current content; it may be incomplete.' },
            { label: KEEP_WAITING_LABEL, description: 'Resume the read as soon as the lock is released.' },
          ],
        }],
      })
      const settled = await Promise.race([
        question.then(
          answer => ({ kind: 'answer' as const, answer }),
          (error: unknown) => ({ kind: 'failed' as const, error }),
        ),
        release.then(outcome => ({ kind: 'release' as const, outcome })),
      ])
      // The loser settles against the aborted signal; its outcome is irrelevant.
      controller.abort()
      if (exec.signal.aborted) return 'aborted'
      if (settled.kind === 'release') return 'released'
      // A question no answerer claims, or one refused for this caller, falls to the delegated policy.
      if (settled.kind === 'failed') return 'unavailable'
      const chosen = settled.answer.answers.find(item => item.id === 'file-lock')?.selected[0]
      return chosen === READ_NOW_LABEL ? 'read-now' : 'keep-waiting'
    } finally {
      exec.signal.removeEventListener('abort', onAbort)
    }
  }

  const read = async (
    exec: ToolDispatchExecution, agent: Agent, holder: LeaseHolder, target: LockTarget, next: () => Promise<ToolExecutionResult>,
  ): Promise<ToolExecutionResult> => {
    const foreign = registry.foreignLease(target.key, holder.family)
    if (foreign === undefined) return next()
    const description = describeHolder(foreign)
    if (readNowKeys.get(agent.id)?.has(target.key)) return withNotice(next, readNowNotice(target, description))

    const startedAt = Date.now()
    agent.session.append('file-lock/waiting', { path: target.path, access: 'read', holder: description })
    const first = await registry.awaitRelease(target.key, holder.family, exec.signal, settings().readWaitMs)
    if (first === 'free') {
      const waitedMs = settle(agent, target, 'read', 'released', startedAt)
      return withNotice(next, releasedNotice(target, description, waitedMs))
    }
    if (first === 'aborted') {
      settle(agent, target, 'read', 'aborted', startedAt)
      return next()
    }

    const readNow = (): Promise<ToolExecutionResult> => {
      remember(readNowKeys, agent.id, target.key)
      settle(agent, target, 'read', 'read-now', startedAt)
      return withNotice(next, readNowNotice(target, description))
    }
    const userQuestions = holder.family === agent.id ? ctx.get('userQuestions') : undefined
    let decision: 'read-now' | 'keep-waiting' | 'released' | 'aborted' | 'unavailable' = 'unavailable'
    if (userQuestions !== undefined) {
      agent.session.append('file-lock/asked', { path: target.path, holder: description, waitedMs: Date.now() - startedAt })
      decision = await ask(exec, agent, holder.family, target, description, userQuestions)
    }
    if (decision === 'released') {
      const waitedMs = settle(agent, target, 'read', 'released', startedAt)
      return withNotice(next, releasedNotice(target, description, waitedMs))
    }
    if (decision === 'aborted') {
      settle(agent, target, 'read', 'aborted', startedAt)
      return next()
    }
    if (decision === 'unavailable') {
      const policy = settings().delegatedReadTimeout
      agent.session.append('file-lock/answered', { path: target.path, choice: policy === 'read-now' ? 'read-now' : 'keep-waiting', by: 'policy' })
      if (policy === 'read-now') return readNow()
    } else {
      agent.session.append('file-lock/answered', { path: target.path, choice: decision, by: 'user' })
      if (decision === 'read-now') return readNow()
    }

    agent.session.append('file-lock/subscribed', { path: target.path, holder: description })
    const final = await registry.awaitRelease(target.key, holder.family, exec.signal)
    if (final === 'free') {
      const waitedMs = settle(agent, target, 'read', 'released', startedAt)
      return withNotice(next, releasedNotice(target, description, waitedMs))
    }
    settle(agent, target, 'read', 'aborted', startedAt)
    return next()
  }

  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const rule = rules.get(exec.name)
    const agent = exec.agent
    if (rule === undefined || agent === undefined || !isRecord(exec.arguments)) return next()
    const target = await resolveTarget(exec, agent, exec.arguments, rule)
    if (target === undefined) return next()
    const holder: LeaseHolder = { session: agent.id, family: familyOf(agent) }
    return accessOf(rule, exec.arguments) === 'write'
      ? write(exec, agent, holder, target, next)
      : read(exec, agent, holder, target, next)
  })
}
