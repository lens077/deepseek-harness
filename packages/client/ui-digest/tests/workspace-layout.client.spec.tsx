// @vitest-environment jsdom
/** Browser-local workspace filter preferences and their Layout settings control. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createDigestStore } from '../src/client/stores.ts'
import { cardColumnsOf } from '../src/client/card-layout.ts'
import { DigestLayoutRow } from '../src/client/DigestLayoutRow.tsx'
import type { DigestLayoutRowProps } from '../src/client/contract/slots.ts'
import { t } from './fixtures.client.ts'

beforeEach(() => { localStorage.clear() })
afterEach(cleanup)

describe('workspace filter layout', () => {
  it.each([undefined, null, 0, 9, 2.5, 'auto', {}, Number.NaN])('defaults invalid card columns %j to five', (value) => {
    expect(cardColumnsOf(value)).toBe(5)
  })

  it('defaults to one row and retains existing viewing preferences when the field is absent', () => {
    localStorage.setItem('dsh.digest.view.v3', JSON.stringify({ open: true, tab: 'todos', layout: 'columns', showReply: false }))
    const store = createDigestStore().create()
    expect(store.getSnapshot()).toMatchObject({ open: true, tab: 'todos', layout: 'columns', showReply: false, workspaceRows: 'single', cardColumns: 5 })
  })

  it('offers one row, two through six content-sized rows, and all rows under Layout', () => {
    const store = createDigestStore().create()
    const props = {
      useStore: (selector: (state: ReturnType<typeof store.getSnapshot>) => unknown) => selector(store.getSnapshot()),
      actions: store.actions,
      t,
    } as unknown as DigestLayoutRowProps
    const view = render(<DigestLayoutRow {...props} />)
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: '汇总工作区栏' })
    expect([...select.options].map(option => option.textContent)).toEqual([
      '单行', '最多 2 行', '最多 3 行', '最多 4 行', '最多 5 行', '最多 6 行', '显示全部',
    ])
    for (const value of ['2', '6', 'all', 'single']) {
      fireEvent.change(select, { target: { value } })
      view.rerender(<DigestLayoutRow {...props} />)
      expect(select.value).toBe(value)
      expect(createDigestStore().create().getSnapshot().workspaceRows).toBe(value === '2' || value === '6' ? Number(value) : value)
    }
  })
})
