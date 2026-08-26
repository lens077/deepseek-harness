// @vitest-environment jsdom
// The delegation-row tail: reading the child session a delegation recorded,
// matching it to what the descendant read found, and drawing that child's files
// under the call that spawned it.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  childSessionOf, DelegationFiles, type DelegationFilesProps,
} from '../src/client/DelegationFiles.tsx'
import type { SessionTreeState } from '../src/client/tree-controller.ts'
import { segmentLabel } from '../src/client/session-files.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const SID = 'parent' as SessionId
const t = makeTranslate(zh)

/** A settled delegation call whose meta names `child`. */
function delegation(child: string | undefined) {
  return { kind: 'tool-result', callId: 'c1', meta: child === undefined ? undefined : { childSessionId: child } }
}

function treeWith(files: Array<{ path: string; segments: number }>): SessionTreeState {
  return {
    bySession: {
      [SID]: {
        status: 'ready',
        partial: false,
        error: null,
        sources: [{
          sessionId: 'child',
          label: 'reviewer',
          files: files.map(file => ({
            path: file.path,
            firstSeq: 1,
            lastSeq: 1,
            segments: Array.from({ length: file.segments }, (_v, index) => ({
              turn: index + 1,
              tool: 'edit',
              source: 'reviewer',
              time: index,
              oldText: 'a',
              newText: 'b',
            })),
          })),
        }],
      },
    },
  }
}

function props(
  block: unknown,
  tree: SessionTreeState,
  expansion: 'all' | 'single' | 'none' = 'all',
): DelegationFilesProps {
  return {
    sessionId: SID,
    block,
    useTree: bindSnapshotSelector(createSnapshotStore(tree)),
    useDiffExpansion: bindSnapshotSelector(createSnapshotStore(expansion)),
    label: (segment: Parameters<typeof segmentLabel>[0]) => segmentLabel(segment, t),
    t,
  } as unknown as DelegationFilesProps
}

describe('childSessionOf', () => {
  it('accepts a recorded id and refuses everything else', () => {
    expect(childSessionOf({ childSessionId: 'child' })).toBe('child')
    // A background delegation records `{}`; an older build records nothing.
    expect(childSessionOf({})).toBeNull()
    expect(childSessionOf(undefined)).toBeNull()
    expect(childSessionOf(null)).toBeNull()
    expect(childSessionOf('child')).toBeNull()
    expect(childSessionOf({ childSessionId: 7 })).toBeNull()
    expect(childSessionOf({ childSessionId: '' })).toBeNull()
  })
})

describe('DelegationFiles', () => {
  it('draws the child\'s files under the call, expanded by default', () => {
    render(<DelegationFiles {...props(delegation('child'), treeWith([{ path: 'src/a.ts', segments: 2 }]))} />)
    expect(screen.getByText('reviewer 改动的文件')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'a.ts' }).getAttribute('aria-expanded')).toBe('true')
    // Each segment names the descendant, because turn numbers restart per session.
    expect(screen.getAllByText('reviewer · 第 1 轮 · edit')).toHaveLength(1)
    expect(screen.getAllByText('reviewer · 第 2 轮 · edit')).toHaveLength(1)
  })

  it('toggles one file without disturbing the rest', () => {
    const { container } = render(<DelegationFiles {...props(
      delegation('child'),
      treeWith([{ path: 'a.ts', segments: 1 }, { path: 'b.ts', segments: 1 }]),
    )} />)
    expect(container.querySelectorAll('[data-side-by-side-diff]')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'a.ts' }))
    expect(container.querySelectorAll('[data-side-by-side-diff]')).toHaveLength(1)
  })

  it('honors the collapsed and single-file modes', () => {
    const two = [{ path: 'a.ts', segments: 1 }, { path: 'b.ts', segments: 1 }]
    const closed = render(<DelegationFiles {...props(delegation('child'), treeWith(two), 'none')} />)
    expect(closed.container.querySelectorAll('[data-side-by-side-diff]')).toHaveLength(0)
    cleanup()

    const several = render(<DelegationFiles {...props(delegation('child'), treeWith(two), 'single')} />)
    expect(several.container.querySelectorAll('[data-side-by-side-diff]')).toHaveLength(0)
    cleanup()

    const one = render(<DelegationFiles {...props(
      delegation('child'), treeWith([{ path: 'a.ts', segments: 1 }]), 'single',
    )} />)
    expect(one.container.querySelectorAll('[data-side-by-side-diff]')).toHaveLength(1)
  })

  it('lists a file the child recorded no hunks for, with nothing to expand', () => {
    const { container } = render(<DelegationFiles {...props(
      delegation('child'), treeWith([{ path: 'a.ts', segments: 0 }]),
    )} />)
    expect(screen.getByRole('button', { name: 'a.ts' })).toBeTruthy()
    expect(container.querySelectorAll('[data-side-by-side-diff]')).toHaveLength(0)
  })

  it('draws nothing for a call that spawned no child, an unread child, or one still running', () => {
    const tree = treeWith([{ path: 'a.ts', segments: 1 }])
    // Not a delegation at all.
    expect(render(<DelegationFiles {...props(delegation(undefined), tree)} />).container.firstChild).toBeNull()
    cleanup()
    // A delegation whose child the descendant read has not covered.
    expect(render(<DelegationFiles {...props(delegation('other'), tree)} />).container.firstChild).toBeNull()
    cleanup()
    // A call still in flight has no settled meta to read.
    expect(render(<DelegationFiles {...props({ callId: 'c1' }, tree)} />).container.firstChild).toBeNull()
    cleanup()
    // A child that changed nothing contributes no source row.
    expect(render(<DelegationFiles {...props(delegation('child'), { bySession: {} })} />).container.firstChild)
      .toBeNull()
  })
})
