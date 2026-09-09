// @vitest-environment jsdom
/**
 * The general-settings row that chooses how session rows present their
 * running/completed/error perimeter: animated, static, or hidden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { createWorkspaceViewStore } from '../src/client/stores.ts'
import { SessionStatusSettingsRow, type SessionStatusSettingsRowProps } from '../src/client/SessionStatusSettingsRow.tsx'
import { zh } from '../src/client/locales.ts'

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

const t = makeTranslate(zh, commonZh) as SessionStatusSettingsRowProps['t']

function mount() {
  const store = createWorkspaceViewStore().create()
  render(
    <SessionStatusSettingsRow
      useStore={bindSnapshotSelector(store)}
      actions={store.actions}
      useSessions={vi.fn() as never}
      useSessionPendingInteraction={vi.fn() as never}
      useResource={useResource}
      useWorkspaces={vi.fn() as never}
      t={t}
    />,
  )
  return store
}

describe('SessionStatusSettingsRow', () => {
  it('describes the three modes and reports the animated default', () => {
    const store = mount()
    expect(screen.getByText('对话状态动画')).toBeTruthy()
    expect(screen.getByText('关闭动画时仍显示静态状态边框；完全关闭时仅保留状态点和辅助说明。')).toBeTruthy()
    expect(screen.getByRole('button', { name: /打开（默认）/ })).toBeTruthy()
    expect(store.getSnapshot().sessionStatusIndicatorMode).toBe('animated')
  })

  it('switches through static and hidden, persists under the v9 key, and returns to animated', () => {
    const store = mount()
    fireEvent.click(screen.getByRole('button', { name: /打开（默认）/ }))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['打开（默认）', '关闭动画', '完全关闭'])
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭动画' }))
    expect(store.getSnapshot().sessionStatusIndicatorMode).toBe('static')

    fireEvent.click(screen.getByRole('button', { name: /关闭动画/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '完全关闭' }))
    expect(store.getSnapshot().sessionStatusIndicatorMode).toBe('hidden')
    expect(localStorage.getItem('dsh.workspace.view.v9')).toContain('"sessionStatusIndicatorMode":"hidden"')
    expect(localStorage.getItem('dsh.workspace.view.v8')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /完全关闭/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '打开（默认）' }))
    expect(store.getSnapshot().sessionStatusIndicatorMode).toBe('animated')
  })
})
