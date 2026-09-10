// @vitest-environment jsdom
/** The row and the chip over one snapshot: nothing while unavailable; a switch that writes on toggle otherwise. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { ModelRoutingChip, type ModelRoutingChipProps } from '../src/client/ModelRoutingChip.tsx'
import { ModelRoutingRow, type ModelRoutingRowProps } from '../src/client/ModelRoutingRow.tsx'
import type { ModelRoutingState } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

function props(state: Partial<ModelRoutingState> = {}) {
  const store = createSnapshotStore<ModelRoutingState>({
    available: true, writable: true, enabled: true, saving: false, failed: false, ...state,
  })
  const toggle = vi.fn()
  return { toggle, props: { t, toggle, useModelRouting: bindSnapshotSelector(store) } }
}

describe('ModelRoutingRow', () => {
  it('renders nothing while no router serves the namespace', () => {
    const { props: p } = props({ available: false })
    const view = render(<ModelRoutingRow {...p as unknown as ModelRoutingRowProps} />)
    expect(view.container.innerHTML).toBe('')
  })

  it('writes the switch position on toggle and explains each state', () => {
    const { toggle, props: p } = props()
    render(<ModelRoutingRow {...p as unknown as ModelRoutingRowProps} />)
    const control = screen.getByRole('switch', { name: en.toggle })
    expect(control.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(en.onHint)).toBeTruthy()
    fireEvent.click(control)
    expect(toggle).toHaveBeenCalledWith(false)
    cleanup()
    render(<ModelRoutingRow {...props({ enabled: false, failed: true }).props as unknown as ModelRoutingRowProps} />)
    expect(screen.getByRole('switch', { name: en.toggle }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(en.offHint)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(en.writeFailed)
  })

  it('disables the switch on a read-only document and while a write is in flight', () => {
    const { toggle, props: p } = props({ writable: false })
    render(<ModelRoutingRow {...p as unknown as ModelRoutingRowProps} />)
    const control = screen.getByRole<HTMLButtonElement>('switch', { name: en.toggle })
    expect(control.disabled).toBe(true)
    fireEvent.click(control)
    expect(toggle).not.toHaveBeenCalled()
    cleanup()
    render(<ModelRoutingRow {...props({ saving: true }).props as unknown as ModelRoutingRowProps} />)
    expect(screen.getByRole<HTMLButtonElement>('switch', { name: en.toggle }).disabled).toBe(true)
  })
})

describe('ModelRoutingChip', () => {
  it('renders nothing while no router serves the namespace', () => {
    const view = render(<ModelRoutingChip {...props({ available: false }).props as unknown as ModelRoutingChipProps} />)
    expect(view.container.innerHTML).toBe('')
  })

  it('shows the routing state and flips it on click', () => {
    const { toggle, props: p } = props()
    render(<ModelRoutingChip {...p as unknown as ModelRoutingChipProps} />)
    const chip = screen.getByRole('switch', { name: en.toggle })
    expect(chip.getAttribute('aria-checked')).toBe('true')
    expect(chip.getAttribute('title')).toBe(en.chipOnTitle)
    expect(chip.textContent).toBe(en.chipOn)
    fireEvent.click(chip)
    expect(toggle).toHaveBeenCalledWith(false)
    cleanup()
    const off = props({ enabled: false })
    render(<ModelRoutingChip {...off.props as unknown as ModelRoutingChipProps} />)
    const offChip = screen.getByRole('switch', { name: en.toggle })
    expect(offChip.textContent).toBe(en.chipOff)
    expect(offChip.getAttribute('title')).toBe(en.chipOffTitle)
    fireEvent.click(offChip)
    expect(off.toggle).toHaveBeenCalledWith(true)
  })

  it('disables the chip while read-only or saving', () => {
    render(<ModelRoutingChip {...props({ writable: false }).props as unknown as ModelRoutingChipProps} />)
    expect(screen.getByRole<HTMLButtonElement>('switch', { name: en.toggle }).disabled).toBe(true)
    cleanup()
    render(<ModelRoutingChip {...props({ saving: true }).props as unknown as ModelRoutingChipProps} />)
    expect(screen.getByRole<HTMLButtonElement>('switch', { name: en.toggle }).disabled).toBe(true)
  })
})
