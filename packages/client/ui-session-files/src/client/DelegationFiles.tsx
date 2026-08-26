// DelegationFiles: what the child a delegation spawned changed, drawn under
// the call that spawned it. The parent transcript records only the delegation
// call and its result, so without this a delegated turn shows no file work at
// all — and the rail can list such a file but has nowhere to send a reader who
// selects it.

import { useState } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { SideBySideDiff } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ChatFileDiffExpansion } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionTreeState } from './tree-controller.ts'
import { basename, segmentLabel } from './session-files.ts'
import type { NS } from './locales.ts'
import css from './DelegationFiles.module.css'

/** Descendant reads and the expansion preference, injected by the plugin body. */
export interface DelegationFilesInjected {
  hooks: {
    tree: ObservableSnapshot<SessionTreeState>
    diffExpansion: ObservableSnapshot<ChatFileDiffExpansion>
  }
  /** Localize one segment's provenance header. */
  label: (segment: { turn: number | null; tool: string | null; source: string | null }) => string
}

/** Full props for the delegation-row tail. */
export type DelegationFilesProps =
  PropsRuntime<'tool.call.tail'>
  & PropsLocale<typeof NS>
  & InjectFace<DelegationFilesInjected>

/**
 * The child session id a delegation call recorded, if this call was one.
 *
 * The producing tool owns this payload and it crosses the wire, so it is
 * narrowed here rather than trusted: a build that predates the field, a
 * background delegation, and any other tool all yield null.
 * @param meta - the settled call's tool-private presentation payload.
 * @returns the child session id, or null when this call spawned none.
 */
export function childSessionOf(meta: unknown): string | null {
  if (typeof meta !== 'object' || meta === null) return null
  const { childSessionId } = meta as Record<string, unknown>
  return typeof childSessionId === 'string' && childSessionId !== '' ? childSessionId : null
}

/**
 * Render the child's changed files under its delegation call.
 * @param props - the call's owner currency, descendant reads, and localized copy.
 * @returns the tail, or null when this call spawned no child that changed anything.
 */
export function DelegationFiles({
  sessionId, block, useTree, useDiffExpansion, label, t,
}: DelegationFilesProps) {
  const expansion = useDiffExpansion(value => value)
  // Only a settled node carries `meta`; a call still in flight has none.
  const child = childSessionOf('kind' in block ? block.meta : undefined)
  const source = useTree(state => (
    child === null
      ? undefined
      : state.bySession[String(sessionId)]?.sources.find(entry => entry.sessionId === child)
  ))
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map())

  if (source === undefined || source.files.length === 0) return null
  const isOpen = (path: string): boolean =>
    toggled.get(path) ?? (expansion === 'all' || (expansion === 'single' && source.files.length === 1))

  return (
    <div className={css.root}>
      <div className={css.label}>{t('delegation.changed', { source: source.label })}</div>
      {source.files.map(file => (
        <div key={file.path}>
          <button
            type="button"
            className={css.file}
            title={file.path}
            aria-expanded={isOpen(file.path)}
            onClick={() => {
              setToggled((current) => {
                const next = new Map(current)
                next.set(file.path, !isOpen(file.path))
                return next
              })
            }}
          >
            {basename(file.path)}
          </button>
          {isOpen(file.path) && file.segments.length > 0 && (
            <SideBySideDiff
              path={file.path}
              segments={file.segments.map(segment => ({
                label: label(segment),
                oldText: segment.oldText,
                newText: segment.newText,
              }))}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export { segmentLabel }
