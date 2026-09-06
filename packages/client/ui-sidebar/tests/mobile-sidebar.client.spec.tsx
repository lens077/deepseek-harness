// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { SidebarRootComponentProps, SidebarSectionOwnerProps } from '../src/client/contract/slots.ts'
import { SidebarRoot } from '../src/client/SidebarRoot.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function mount(startUngrouped = vi.fn(async () => {})) {
  const navigateMobile = vi.fn()
  const startSession = vi.fn()
  const neverHook = (() => { throw new Error('mobile chrome does not read business snapshots') }) as never
  let owner: SidebarSectionOwnerProps | undefined
  const props: SidebarRootComponentProps = {
    collapsed: true, width: 390, mobileView: 'workspaces', navigateMobile,
    startUngrouped, startSession, toggleSidebar: vi.fn(),
    useSessions: neverHook, useWorkspaces: neverHook, useSessionPendingInteraction: neverHook,
    t: key => (en as Record<string, string>)[key] ?? key,
    renderSlot: ((key: string, params: SidebarSectionOwnerProps) => {
      if (key === 'sidebar.settings') return <button>Settings</button>
      if (key === 'sidebar.nav.entry') return <><button>Overview</button><button>Pending</button></>
      if (key === 'sidebar.workspaces') {
        owner = params
        return <input aria-label="workspace filter" defaultValue="selected workspace" />
      }
      return null
    }) as SidebarRootComponentProps['renderSlot'],
  }
  const view = render(<SidebarRoot {...props} />)
  return { view, props, navigateMobile, startSession, startUngrouped, owner: () => owner }
}

describe('phone sidebar', () => {
  it('keeps four bottom entries and settings outside them, retaining workspace context', () => {
    const b = mount()
    const nav = screen.getByRole('navigation', { name: 'Mobile navigation' })
    expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(['Overview', 'Pending', 'Workspaces', 'New Session'])
    expect(within(nav).queryByRole('button', { name: 'Settings' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    const filter = screen.getByRole('textbox', { name: 'workspace filter' })
    fireEvent.change(filter, { target: { value: 'kept filter' } })
    b.view.rerender(<SidebarRoot {...b.props} mobileView="pending" />)
    expect(screen.queryByRole('textbox', { name: 'workspace filter' })).toBeNull()
    b.view.rerender(<SidebarRoot {...b.props} mobileView="workspaces" />)
    expect(screen.getByRole('textbox', { name: 'workspace filter' })).toBe(filter)
    expect((filter as HTMLInputElement).value).toBe('kept filter')
    b.owner()?.onSessionOpened?.()
    expect(b.navigateMobile).toHaveBeenCalledWith('conversation')
  })

  it('creates ungrouped sessions rather than inheriting the selected workspace', async () => {
    const b = mount()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'New Session' })) })
    expect(b.startUngrouped).toHaveBeenCalledOnce()
    expect(b.startSession).not.toHaveBeenCalled()
    expect(b.navigateMobile).toHaveBeenCalledWith('new')
  })

  it('reports failed scratch creation without leaving the current surface', async () => {
    const b = mount(vi.fn(async () => { throw new Error('offline') }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'New Session' })) })
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(b.navigateMobile).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'New Session' }).hasAttribute('disabled')).toBe(false)
  })
})
