// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { QuestionShortcutRow, type QuestionShortcutRowProps } from '../src/client/settings/QuestionShortcutRow.tsx'
import { QuestionNavigationPolicy } from '../src/client/input/question-navigation-policy.ts'
import type { QuestionNavigationSettings } from '../src/submission-settings.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
})

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  }))
}

function mount() {
  const policy = new QuestionNavigationPolicy()
  const setQuestionNavigation = vi.fn((settings: QuestionNavigationSettings) => { policy.set(settings) })
  const resetQuestionNavigation = vi.fn(() => { policy.reset() })
  const props: QuestionShortcutRowProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useQuestionNavigation: bindSnapshotSelector(policy.settings),
    setQuestionNavigation,
    resetQuestionNavigation,
    t: makeTranslate(en),
  }
  render(<QuestionShortcutRow {...props} />)
  return { policy, setQuestionNavigation, resetQuestionNavigation }
}

/** The expand-side radio group, addressed by its legend. */
function expandSideRadios(): { left: HTMLInputElement; right: HTMLInputElement } {
  const group = screen.getByRole('group', { name: 'Question bar expand button' })
  const radio = (label: string): HTMLInputElement => {
    const input = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      .find(candidate => candidate.parentElement?.textContent?.includes(label))
    if (input === undefined) throw new Error(`no radio labelled ${label}`)
    return input
  }
  return { left: radio('Left'), right: radio('Right') }
}

describe('QuestionShortcutRow expand-side preference', () => {
  it('offers left and right with right selected by default', () => {
    mount()
    const radios = expandSideRadios()
    expect(radios.right.checked).toBe(true)
    expect(radios.left.checked).toBe(false)
  })

  it('writes the chosen side through the whole preference and follows later changes', () => {
    const b = mount()
    fireEvent.click(expandSideRadios().left)
    expect(b.setQuestionNavigation).toHaveBeenCalledWith(
      expect.objectContaining({ expandButtonSide: 'left', focusPolicy: 'editable' }),
    )
    expect(expandSideRadios().left.checked).toBe(true)

    act(() => { b.policy.reset() })
    expect(expandSideRadios().right.checked).toBe(true)
  })
})
