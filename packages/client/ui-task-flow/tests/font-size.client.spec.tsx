// @vitest-environment jsdom
/** Task-flow typography preference and mini graph density regressions. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { TaskFlowSettingsSchema, type TaskFlowSettings } from '../src/settings.ts'
import { FlowFontControls, FlowFontSizeRow, type FlowFontSizeRowProps } from '../src/client/FlowFontSizeRow.tsx'
import { FlowStylePolicy } from '../src/client/style-policy.ts'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)
afterEach(cleanup)

describe('task-flow font preference', () => {
  it('defaults older preferences without changing their independent variants', () => {
    expect(TaskFlowSettingsSchema({})).toEqual({ dockVariant: 'rail', canvasVariant: 'cards', fontSize: 11, mobileDock: false })
    expect(TaskFlowSettingsSchema({ dockVariant: 'cards', canvasVariant: 'lanes' })).toEqual({ dockVariant: 'cards', canvasVariant: 'lanes', fontSize: 11, mobileDock: false })
    for (const fontSize of [10, 11, 16]) expect(TaskFlowSettingsSchema({ fontSize }).fontSize).toBe(fontSize)
    // @ts-expect-error -- Serialized settings can contain nonnumeric font values.
    for (const fontSize of [9, 17, 11.5, '12']) expect(() => TaskFlowSettingsSchema({ fontSize })).toThrow()
  })

  it('persists font size separately and adopts sections without the new field', () => {
    const stub = stubSettingsScope<TaskFlowSettings>()
    const policy = new FlowStylePolicy(stub.scope)
    policy.setFontSize(14)
    expect(stub.set).toHaveBeenCalledWith('fontSize', 14)
    expect(policy.style.getSnapshot()).toEqual({ dock: 'rail', canvas: 'cards', fontSize: 14 })
    policy.setFontSize(14)
    expect(stub.set).toHaveBeenCalledTimes(1)
    policy.setDock('lanes')
    policy.setCanvas('rail')
    expect(policy.style.getSnapshot()).toEqual({ dock: 'lanes', canvas: 'rail', fontSize: 14 })
    // A running Host can still serve its older registered settings schema.
    stub.publish({ status: 'ready', value: { dockVariant: 'cards', canvasVariant: 'lanes' } as TaskFlowSettings })
    expect(policy.style.getSnapshot()).toEqual({ dock: 'cards', canvas: 'lanes', fontSize: 11 })
    stub.publish({ value: { dockVariant: 'rail', canvasVariant: 'cards', fontSize: 16, mobileDock: false } })
    expect(policy.style.getSnapshot().fontSize).toBe(16)
  })

  it('exposes labeled controls with disabled endpoints in Settings and compact headers', () => {
    const setFontSize = vi.fn()
    const props = {
      useFlowStyle: (selector: (style: { fontSize: number }) => unknown) => selector({ fontSize: 11 }), setFontSize, t,
    } as FlowFontSizeRowProps
    const view = render(<FlowFontSizeRow {...props} />)
    expect(view.getByText(en['settings.fontSize.description'])).toBeTruthy()
    expect(view.getByText('11px')).toBeTruthy()
    fireEvent.click(view.getByLabelText(en['fontSize.increase']))
    fireEvent.click(view.getByLabelText(en['fontSize.decrease']))
    expect(setFontSize.mock.calls).toEqual([[12], [10]])
    view.rerender(<FlowFontControls fontSize={10} setFontSize={setFontSize} t={t} />)
    expect((view.getByLabelText(en['fontSize.decrease']) as HTMLButtonElement).disabled).toBe(true)
    view.rerender(<FlowFontControls fontSize={16} setFontSize={setFontSize} t={t} />)
    expect((view.getByLabelText(en['fontSize.increase']) as HTMLButtonElement).disabled).toBe(true)
  })
})

it('bounds mini graph scrolling and isolates every graph text size from global typography', () => {
  const source = (name: string) => readFileSync(resolve(import.meta.dirname, '../src/client', name), 'utf8')
  const dock = source('TaskFlowDock.module.css')
  const body = dock.match(/\.body\s*\{([^}]+)\}/)![1]!
  expect(body).toContain('max-height: 160px')
  expect(body).toContain('overflow: auto')
  expect(body).toContain('overscroll-behavior: contain')
  expect(dock).toContain('flex-wrap: wrap')
  expect(source('TaskFlowDock.tsx')).toContain('role="region" aria-label={t(\'graph.label\')} tabIndex={0}')
  for (const file of ['FlowGraph.module.css', 'TaskFlowDock.module.css', 'TaskFlowView.module.css']) {
    const sizes = [...source(file).matchAll(/font-size:\s*([^;]+);/g)].map(match => match[1])
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes.every(size => size === 'inherit' || size === 'var(--dsh-task-flow-font-size, 11px)')).toBe(true)
  }
  expect(source('FlowGraph.module.css')).toContain(':global([data-task-flow-dock]) .rail')
})
