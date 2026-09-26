// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { CompanionMenu } from '../src/client/CompanionMenu.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en, commonEn)

afterEach(cleanup)

describe('companion usage preview entry', () => {
  it('opens today directly instead of requiring an intermediate menu selection', () => {
    const onUsage = vi.fn()
    const view = render(<CompanionMenu usageOpen={false} onUsage={onUsage} t={t} />)
    const trigger = screen.getByRole('button', { name: en.menu })
    fireEvent.click(trigger)
    expect(onUsage).toHaveBeenCalledWith('today')
    expect(screen.queryByRole('menu')).toBeNull()
    view.rerender(<CompanionMenu usageOpen onUsage={onUsage} t={t} />)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    view.rerender(<CompanionMenu usageOpen={false} onUsage={onUsage} t={t} />)
    expect(document.activeElement).toBe(trigger)
  })
})
