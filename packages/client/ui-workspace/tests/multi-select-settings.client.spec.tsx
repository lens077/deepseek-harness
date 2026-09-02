// @vitest-environment jsdom
/**
 * The general-settings row that turns session-row range and toggle selection
 * on or off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { createWorkspaceViewStore } from '../src/client/stores.ts'
import { MultiSelectSettingsRow, type MultiSelectSettingsRowProps } from '../src/client/MultiSelectSettingsRow.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

const t = makeTranslate(zh, commonZh) as MultiSelectSettingsRowProps['t']

function mount() {
  const store = createWorkspaceViewStore().create()
  render(
    <MultiSelectSettingsRow
      useStore={bindSnapshotSelector(store)}
      actions={store.actions}
      useSessions={vi.fn() as never}
      useWorkspaces={vi.fn() as never}
      t={t}
    />,
  )
  return store
}

describe('MultiSelectSettingsRow', () => {
  it('describes the feature and reports the enabled default', () => {
    mount()
    expect(screen.getByText('会话连选与多选')).toBeTruthy()
    expect(screen.getByRole('button', { name: /启用/ })).toBeTruthy()
  })

  it('turns the setting off and back on through the menu', () => {
    const store = mount()
    fireEvent.click(screen.getByRole('button', { name: /启用/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '关闭' }))
    expect(store.getSnapshot().multiSelect).toBe(false)
    expect(screen.getByRole('button', { name: /关闭/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /关闭/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '启用' }))
    expect(store.getSnapshot().multiSelect).toBe(true)
  })

  it('dismisses the menu without changing the setting', () => {
    const store = mount()
    fireEvent.click(screen.getByRole('button', { name: /启用/ }))
    expect(screen.getByRole('menuitem', { name: '关闭' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menuitem', { name: '关闭' })).toBeNull()
    expect(store.getSnapshot().multiSelect).toBe(true)
  })
})
