// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import type { QuickModelChip, QuickSwitchState } from '../src/client/quick-switch.ts'
import { QuickModelDock, QuickModelSwitch, type QuickSwitchResult } from '../src/client/QuickModelSwitch.tsx'
import { zh } from '../src/client/locales.ts'

const t: Parameters<typeof QuickModelSwitch>[0]['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

const chip = (model: string, over: Partial<QuickModelChip> & { noEffort?: boolean } = {}): QuickModelChip => {
  const { noEffort = false, ...rest } = over
  return {
    key: `deepseek-official/${model}`,
    selection: { provider: 'deepseek-official', model, reasoningEffort: 'high' },
    name: model,
    ...noEffort ? {} : { effort: 'High' },
    active: false,
    ...rest,
  }
}

const accepted: QuickSwitchResult = { accepted: true }

describe('QuickModelSwitch', () => {
  it('renders one pressable pill per route with the current one pressed and inert', () => {
    const onSelect = vi.fn(() => Promise.resolve(accepted))
    render(<QuickModelSwitch
      chips={[chip('pro', { noEffort: true }), chip('flash', { active: true })]}
      locked={false}
      busy={false}
      onSelect={onSelect}
      t={t}
    />)
    expect(screen.getByRole('group', { name: '常用模型快速切换' })).toBeTruthy()
    const pro = screen.getByRole('button', { name: '切换到 pro' })
    const flash = screen.getByRole('button', { name: '切换到 flash，推理等级 High' })
    expect(pro.getAttribute('aria-pressed')).toBe('false')
    expect(flash.getAttribute('aria-pressed')).toBe('true')
    expect(flash.textContent).toBe('flashHigh')

    fireEvent.click(flash)
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(pro)
    expect(onSelect).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'pro', reasoningEffort: 'high' })
  })

  it('renders nothing when no pill offers a switch', () => {
    const none = render(<QuickModelSwitch chips={[]} locked={false} busy={false} onSelect={vi.fn()} t={t} />)
    expect(none.container.firstChild).toBeNull()
    cleanup()
    const onlyCurrent = render(<QuickModelSwitch
      chips={[chip('flash', { active: true })]}
      locked={false}
      busy={false}
      onSelect={vi.fn()}
      t={t}
    />)
    expect(onlyCurrent.container.firstChild).toBeNull()
  })

  it('disables the pills while locked or while a selection is in flight', () => {
    const { rerender } = render(<QuickModelSwitch chips={[chip('pro')]} locked busy={false} onSelect={vi.fn()} t={t} />)
    expect(screen.getByRole('button', { name: /pro/ })).toHaveProperty('disabled', true)
    rerender(<QuickModelSwitch chips={[chip('pro')]} locked={false} busy onSelect={vi.fn()} t={t} />)
    expect(screen.getByRole('button', { name: /pro/ })).toHaveProperty('disabled', true)
    rerender(<QuickModelSwitch chips={[chip('pro')]} locked={false} busy={false} onSelect={vi.fn()} t={t} />)
    expect(screen.getByRole('button', { name: /pro/ })).toHaveProperty('disabled', false)
  })

  it('announces a refused selection through the toast and lets it clear', async () => {
    vi.useFakeTimers()
    try {
      const onSelect = vi.fn(() => Promise.resolve<QuickSwitchResult>({ accepted: false, message: 'no adapter' }))
      render(<QuickModelSwitch chips={[chip('pro')]} locked={false} busy={false} onSelect={onSelect} t={t} />)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /pro/ }))
        await Promise.resolve()
      })
      expect(screen.getByText('模型操作失败：no adapter')).toBeTruthy()
      await act(async () => { await vi.runAllTimersAsync() })
      expect(screen.queryByText('模型操作失败：no adapter')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

const reasoning = {
  efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
  defaultEffort: 'high',
}

function directoryState(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'flash', reasoningEffort: 'high' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'pro', name: 'DeepSeek-V4-Pro', reasoning },
      ],
    }],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

function mountDock(over: {
  quickSwitch?: Partial<QuickSwitchState>
  directory?: Partial<ModelDirectoryState>
  available?: boolean
  removed?: boolean
} = {}) {
  const directory = createSnapshotStore(directoryState(over.directory))
  const quickSwitch = createSnapshotStore<QuickSwitchState>({
    enabled: true,
    recent: [
      { provider: 'deepseek-official', model: 'pro', reasoningEffort: 'max' },
      { provider: 'deepseek-official', model: 'flash', reasoningEffort: 'high' },
    ],
    ...over.quickSwitch,
  })
  const select = vi.fn(() => Promise.resolve(accepted))
  const props = {
    session: { removed: over.removed ?? false } as SessionSnapshot,
    useModelDirectory: bindSnapshotSelector(directory),
    useQuickSwitch: bindSnapshotSelector(quickSwitch),
    available: over.available ?? true,
    select,
    t,
  } as unknown as Parameters<typeof QuickModelDock>[0]
  const rendered = render(<QuickModelDock {...props} />)
  return { rendered, select, directory, quickSwitch }
}

describe('QuickModelDock adapter', () => {
  it('resolves the remembered routes against the live directory and submits the remembered effort', async () => {
    const b = mountDock()
    const pro = screen.getByRole('button', { name: '切换到 DeepSeek-V4-Pro，推理等级 Max' })
    expect(screen.getByRole('button', { name: /DeepSeek-V4-Flash/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(pro)
    expect(b.select).toHaveBeenCalledWith({ provider: 'deepseek-official', model: 'pro', reasoningEffort: 'max' })

    act(() => {
      b.directory.set(directoryState({ current: { provider: 'deepseek-official', model: 'pro', reasoningEffort: 'max' } }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /DeepSeek-V4-Pro/ }).getAttribute('aria-pressed')).toBe('true')
    })
  })

  it('waits while a selection crosses the wire and locks for a removed session', () => {
    const busy = mountDock({ directory: { status: 'selecting' } })
    expect(screen.getByRole('button', { name: /DeepSeek-V4-Pro/ })).toHaveProperty('disabled', true)
    busy.rendered.unmount()
    mountDock({ removed: true })
    expect(screen.getByRole('button', { name: /DeepSeek-V4-Pro/ })).toHaveProperty('disabled', true)
  })

  it('renders nothing while the preference is off, for an unavailable session, or before anything is remembered', () => {
    expect(mountDock({ quickSwitch: { enabled: false } }).rendered.container.firstChild).toBeNull()
    cleanup()
    expect(mountDock({ available: false }).rendered.container.firstChild).toBeNull()
    cleanup()
    expect(mountDock({ quickSwitch: { recent: [] } }).rendered.container.firstChild).toBeNull()
  })
})
