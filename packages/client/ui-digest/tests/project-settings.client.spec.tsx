// @vitest-environment jsdom
/**
 * The scan settings: the policy mirroring the `project-todos` scope into a
 * view and routing cleaned writes, and the settings page over direct props —
 * roots list with add/remove/choose, patterns saved as one list, workspace
 * inclusion, and the disabled and failure states.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { ProjectTodosSettings } from '@deepseek-ai/dsh-project-todos/types'
import { ProjectSettingsPolicy, cleanList, type ProjectSettingsView } from '../src/client/project-settings.ts'
import { ProjectSettingsSection } from '../src/client/ProjectSettingsSection.tsx'
import type { ProjectSettingsSectionProps } from '../src/client/contract/slots.ts'
import { zh } from '../src/client/locales.ts'
import { t } from './fixtures.client.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('cleanList', () => {
  it('trims, drops blanks, and de-duplicates in first-seen order', () => {
    expect(cleanList([' /a ', '', '/b', '/a', '  '])).toEqual(['/a', '/b'])
  })
})

describe('ProjectSettingsPolicy', () => {
  it('mirrors the scope through loading, ready, and unavailable', () => {
    const stub = stubSettingsScope<ProjectTodosSettings>()
    const policy = new ProjectSettingsPolicy(stub.scope)
    expect(policy.view.getSnapshot()).toMatchObject({ status: 'loading', roots: [], writable: false })
    stub.publish({ status: 'ready', writable: true, value: { roots: ['/a'], files: ['TODO.md'], includeWorkspaces: false } })
    expect(policy.view.getSnapshot()).toEqual({ status: 'ready', writable: true, roots: ['/a'], files: ['TODO.md'], includeWorkspaces: false })
    stub.publish({ status: 'unavailable', value: undefined })
    expect(policy.view.getSnapshot()).toMatchObject({ status: 'unavailable', roots: ['/a'] })
    stub.publish({ status: 'unavailable', value: { roots: [], files: [], includeWorkspaces: true } })
    expect(policy.view.getSnapshot()).toMatchObject({ status: 'unavailable', roots: [] })
  })

  it('cleans lists before writing', async () => {
    const stub = stubSettingsScope<ProjectTodosSettings>()
    const policy = new ProjectSettingsPolicy(stub.scope)
    await policy.setRoots([' /a', '/a', ''])
    await policy.setFiles(['TODO.md', ' '])
    await policy.setIncludeWorkspaces(false)
    expect(stub.set.mock.calls).toEqual([['roots', ['/a']], ['files', ['TODO.md']], ['includeWorkspaces', false]])
  })
})

type SectionCalls = {
  setRoots: ReturnType<typeof vi.fn<(roots: readonly string[]) => Promise<void>>>
  setFiles: ReturnType<typeof vi.fn<(files: readonly string[]) => Promise<void>>>
  setIncludeWorkspaces: ReturnType<typeof vi.fn<(include: boolean) => Promise<void>>>
  pickDirectory: ReturnType<typeof vi.fn<() => Promise<string | null>>>
}

function mount(view: Partial<ProjectSettingsView> = {}, over: Partial<SectionCalls> = {}) {
  const state: ProjectSettingsView = { status: 'ready', writable: true, roots: ['/a', '/b'], files: ['TODO.md'], includeWorkspaces: true, ...view }
  const calls: SectionCalls = {
    setRoots: vi.fn<(roots: readonly string[]) => Promise<void>>(async () => undefined),
    setFiles: vi.fn<(files: readonly string[]) => Promise<void>>(async () => undefined),
    setIncludeWorkspaces: vi.fn<(include: boolean) => Promise<void>>(async () => undefined),
    pickDirectory: vi.fn<() => Promise<string | null>>(async () => '/picked'),
    ...over,
  }
  const props = {
    close: vi.fn(),
    useProjectSettings: ((selector: (s: ProjectSettingsView) => unknown) => selector(state)),
    ...calls,
    t,
  } as unknown as ProjectSettingsSectionProps
  render(<ProjectSettingsSection {...props} />)
  return calls
}

describe('ProjectSettingsSection', () => {
  it('lists roots and removes, adds by typing, and adds by choosing a directory', async () => {
    const c = mount()
    expect(screen.getByText('/a')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: zh['settings.roots.remove'] })[0]!)
    expect(c.setRoots).toHaveBeenLastCalledWith(['/b'])
    const input = screen.getByRole('textbox', { name: zh['settings.roots.placeholder'] })
    const add = screen.getByRole('button', { name: zh['settings.roots.submit'] })
    expect((add as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '  /c ' } })
    fireEvent.click(add)
    expect(c.setRoots).toHaveBeenLastCalledWith(['/a', '/b', '/c'])
    await act(async () => { await Promise.resolve() })
    expect((input as HTMLInputElement).value).toBe('')
    // Blank submit changes nothing.
    fireEvent.submit(input.closest('form')!)
    expect(c.setRoots).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: zh['settings.roots.add'] }))
    await act(async () => { await Promise.resolve() })
    expect(c.setRoots).toHaveBeenLastCalledWith(['/a', '/b', '/picked'])
  })

  it('ignores a cancelled chooser and reports a failing chooser or write', async () => {
    vi.useFakeTimers()
    const c = mount({}, {
      pickDirectory: vi.fn<() => Promise<string | null>>(async () => null),
      setIncludeWorkspaces: vi.fn<(include: boolean) => Promise<void>>(async () => { throw new Error('denied') }),
    })
    fireEvent.click(screen.getByRole('button', { name: zh['settings.roots.add'] }))
    await act(async () => { await Promise.resolve() })
    expect(c.setRoots).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox'))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('alert').textContent).toBe('保存失败：denied')
    act(() => { vi.advanceTimersByTime(4_000) })
    expect(screen.queryByRole('alert')).toBeNull()
    c.pickDirectory.mockRejectedValueOnce('nope')
    fireEvent.click(screen.getByRole('button', { name: zh['settings.roots.add'] }))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('alert').textContent).toBe('选择目录失败：nope')
  })

  it('saves patterns as one list only when they changed', async () => {
    const c = mount()
    const area = screen.getByRole('textbox', { name: zh['settings.files'] }) as HTMLTextAreaElement
    const save = screen.getByRole('button', { name: zh['settings.files.save'] }) as HTMLButtonElement
    expect(area.value).toBe('TODO.md')
    expect(save.disabled).toBe(true)
    fireEvent.change(area, { target: { value: 'TODO.md\n\n' } })
    expect(save.disabled).toBe(true)
    fireEvent.change(area, { target: { value: 'TODO.md\nnotes/TODO.md' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    expect(c.setFiles).toHaveBeenCalledWith(['TODO.md', 'notes/TODO.md'])
    await act(async () => { await Promise.resolve() })
    expect(save.disabled).toBe(true)
  })

  it('writes the workspace toggle', () => {
    const c = mount()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(c.setIncludeWorkspaces).toHaveBeenCalledWith(false)
  })

  it('disables everything while loading or when the connection cannot write', () => {
    mount({ status: 'loading' })
    expect(screen.getByText(zh['settings.loading'])).toBeTruthy()
    expect(screen.getByRole('checkbox').hasAttribute('disabled')).toBe(true)
    cleanup()
    mount({ status: 'ready', writable: false, roots: [] })
    expect(screen.getByText(zh['settings.unavailable'])).toBeTruthy()
    expect(screen.getByText(zh['settings.roots.empty'])).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['settings.roots.add'] }).hasAttribute('disabled')).toBe(true)
  })
})
