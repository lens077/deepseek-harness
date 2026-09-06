// @vitest-environment jsdom
/** Opt-in phone strip preference leaves desktop drawing preferences unchanged. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useSyncExternalStore, type ComponentProps } from 'react'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskFlowSettingsSchema, type TaskFlowSettings } from '../src/settings.ts'
import { FlowStylePolicy } from '../src/client/style-policy.ts'
import { MobileDockRow } from '../src/client/MobileDockRow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => { cleanup(); localStorage.clear() })

describe('phone task-flow visibility', () => {
  it('defaults to no strip and rejects non-boolean durable preferences', () => {
    expect(TaskFlowSettingsSchema({})).toEqual({ dockVariant: 'rail', canvasVariant: 'cards', fontSize: 11, mobileDock: false })
    expect(TaskFlowSettingsSchema({ mobileDock: true }).mobileDock).toBe(true)
    // @ts-expect-error -- Serialized settings must reject string-valued booleans.
    expect(() => TaskFlowSettingsSchema({ mobileDock: 'true' })).toThrow()
    const host = stubSettingsScope<TaskFlowSettings>()
    const policy = new FlowStylePolicy(host.scope)
    const drawing = policy.style.getSnapshot()
    expect(policy.mobileDock.getSnapshot()).toBe(false)
    policy.setMobileDock(true)
    expect(policy.mobileDock.getSnapshot()).toBe(true)
    expect(policy.style.getSnapshot()).toBe(drawing)
    expect(host.set).toHaveBeenCalledWith('mobileDock', true)
    policy.setMobileDock(true)
    expect(host.set).toHaveBeenCalledOnce()
    host.publish({ value: TaskFlowSettingsSchema({ mobileDock: false }) })
    expect(policy.mobileDock.getSnapshot()).toBe(false)
  })

  it('retains only the mobile toggle across remote browser instances', () => {
    const host = stubSettingsScope<TaskFlowSettings>()
    host.publish({ mode: 'memory', status: 'unavailable' })
    const first = new FlowStylePolicy(host.scope)
    first.setMobileDock(true)
    const second = new FlowStylePolicy(host.scope)
    expect(second.mobileDock.getSnapshot()).toBe(true)
    expect(second.style.getSnapshot()).toEqual({ dock: 'rail', canvas: 'cards', fontSize: 11 })
    expect(localStorage.getItem('dsh.task-flow.mobile-dock')).toBe('true')
    expect(host.set).not.toHaveBeenCalled()
    localStorage.setItem('dsh.task-flow.mobile-dock', JSON.stringify('invalid'))
    expect(new FlowStylePolicy(host.scope).mobileDock.getSnapshot()).toBe(false)
  })

  it('updates the opt-in checkbox live and scopes hiding to phone presentation', () => {
    const policy = new FlowStylePolicy()
    const useMobileDock: ComponentProps<typeof MobileDockRow>['useMobileDock'] = selector =>
      selector(useSyncExternalStore(policy.mobileDock.subscribe, policy.mobileDock.getSnapshot))
    const props = {
      useMobileDock,
      setMobileDock: (value: boolean) => { policy.setMobileDock(value) },
      t: makeTranslate(en),
    } as ComponentProps<typeof MobileDockRow>
    const view = render(<MobileDockRow {...props} />)
    const checkbox = view.getByRole('checkbox', { name: 'Show task flow on mobile' }) as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(false)
    const css = readFileSync(resolve(import.meta.dirname, '../src/client/TaskFlowDock.module.css'), 'utf8')
    expect(css).toMatch(/:global\(\[data-mobile\]\) \.dock:not\(\[data-mobile-enabled\]\)\s*\{\s*display: none;/)
  })
})
