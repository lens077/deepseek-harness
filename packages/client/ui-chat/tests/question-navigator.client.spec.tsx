// @vitest-environment jsdom
/**
 * Question navigator acceptance: the rail is one standing search entry on
 * top, a load-all entry under it while earlier history is unloaded, then
 * stepping — it redraws no question list of its own — and every list the
 * search panel shows says what it covers, so an empty result never speaks
 * for the whole session on the loaded window's authority alone.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserMessageNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { QuestionEntry } from '../src/client/chat/turn-summary.ts'
import { QuestionNavigator, type QuestionRemovalProps } from '../src/client/chat/QuestionNavigator.tsx'
import { zh } from '../src/client/locale.ts'

const t = makeTranslate(zh, commonZh) as Parameters<typeof QuestionNavigator>[0]['t']

afterEach(cleanup)

function question(index: number, text: string): QuestionEntry {
  return {
    key: `q${index}`,
    text,
    node: {
      kind: 'user', seq: index, time: index * 1_000, content: [{ type: 'text', text }], source: null,
    } as unknown as UserMessageNode,
  }
}

const QUESTIONS = [
  question(1, '第一个提问'),
  question(2, '第二个提问'),
  question(3, '第三个提问'),
]

function renderNavigator(overrides: Partial<Parameters<typeof QuestionNavigator>[0]> = {}) {
  const props = {
    questions: QUESTIONS,
    current: 0,
    hasMore: false,
    loadingAll: false,
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onSelect: vi.fn(),
    onSelectSeq: vi.fn(),
    onLoadAll: vi.fn(),
    t,
    ...overrides,
  }
  return { ...render(<QuestionNavigator {...props} />), props }
}

/** The dedicated search entry beside the stepping arrows. */
function searchEntry(): HTMLElement {
  return screen.getByRole('button', { name: zh['chat.questions.search'] })
}

function searchFor(text: string): void {
  fireEvent.click(searchEntry())
  fireEvent.change(screen.getByPlaceholderText(zh['chat.questions.search']), { target: { value: text } })
}

describe('question search entry', () => {
  it('is a standing button above the arrows: the rail redraws no list until it is asked', () => {
    renderNavigator()
    expect(searchEntry()).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['chat.questions.previous'] })).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['chat.questions.next'] })).toBeTruthy()
    expect(screen.getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual([
      zh['chat.questions.search'], zh['chat.questions.previous'], zh['chat.questions.next'],
    ])
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(searchEntry())
    expect(screen.getByRole('dialog', { name: zh['chat.questions.history'] })).toBeTruthy()
    expect(screen.getByPlaceholderText(zh['chat.questions.search'])).toBeTruthy()
    expect(searchEntry().getAttribute('aria-expanded')).toBe('true')
  })

  it('closes on a pointer press outside the panel and on the entry itself', () => {
    renderNavigator()
    fireEvent.click(searchEntry())
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(searchEntry())
    fireEvent.click(searchEntry())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps load-all usable before the loaded window contains a question', () => {
    const { props } = renderNavigator({ questions: [], hasMore: true })
    const search = searchEntry() as HTMLButtonElement
    const previous = screen.getByRole('button', { name: zh['chat.questions.previous'] }) as HTMLButtonElement
    const next = screen.getByRole('button', { name: zh['chat.questions.next'] }) as HTMLButtonElement
    const loadAll = screen.getByRole('button', { name: zh['chat.questions.loadAll'] }) as HTMLButtonElement
    expect(search.disabled).toBe(true)
    expect(previous.disabled).toBe(true)
    expect(next.disabled).toBe(true)
    expect(loadAll.disabled).toBe(false)

    fireEvent.click(search)
    fireEvent.click(previous)
    fireEvent.click(next)
    fireEvent.click(loadAll)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(props.onPrevious).not.toHaveBeenCalled()
    expect(props.onNext).not.toHaveBeenCalled()
    expect(props.onLoadAll).toHaveBeenCalledOnce()
  })

  it('renders nothing for a complete lone question, which has nowhere to step and nothing to search among', () => {
    const { container } = renderNavigator({ questions: [QUESTIONS[0]!] })
    expect(container.innerHTML).toBe('')
  })

  it('keeps back-to-bottom as the last rail entry, greyed rather than gone while already at the bottom', () => {
    // Regression: the control used to live in a sticky slot inside the scroller
    // and unmount at the bottom, so it drifted out of the rail's column on
    // narrow viewports and the column reflowed every time it came and went.
    const onToBottom = vi.fn()
    const { rerender, props } = renderNavigator({ atBottom: true, onToBottom })
    const buttons = screen.getAllByRole('button')
    const bottom = buttons.at(-1) as HTMLButtonElement
    expect(bottom.getAttribute('aria-label')).toBe(zh['chat.toBottom'])
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
      zh['chat.questions.search'], zh['chat.questions.previous'], zh['chat.questions.next'], zh['chat.toBottom'],
    ])
    expect(bottom.disabled).toBe(true)
    fireEvent.click(bottom)
    expect(onToBottom).not.toHaveBeenCalled()

    rerender(<QuestionNavigator {...props} atBottom={false} />)
    const away = screen.getByRole('button', { name: zh['chat.toBottom'] }) as HTMLButtonElement
    expect(away.disabled).toBe(false)
    fireEvent.click(away)
    expect(onToBottom).toHaveBeenCalledOnce()
  })

  it('keeps back-to-bottom mounted alone for a complete lone question, where the question controls leave', () => {
    renderNavigator({ questions: [QUESTIONS[0]!], atBottom: false, onToBottom: vi.fn() })
    expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([zh['chat.toBottom']])
    expect(screen.queryByRole('button', { name: zh['chat.questions.search'] })).toBeNull()
  })

  it('lists the loaded questions on an empty query, saying when older pages are still unloaded', () => {
    renderNavigator({ hasMore: true })
    fireEvent.click(searchEntry())
    expect(screen.getAllByRole('button').filter(b => b.getAttribute('title') !== null)).toHaveLength(3)
    expect(screen.getByRole('status').textContent).toBe(zh['chat.questions.windowOnlyIdle'])
  })

  it('offers to load the whole session on the rail, right under search, only while pages are unloaded', () => {
    const { props } = renderNavigator({ hasMore: true })
    // Standing on the rail with the panel closed: the search it serves need
    // not be open first, and its order says what it belongs to.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual([
      zh['chat.questions.search'], zh['chat.questions.loadAll'], zh['chat.questions.previous'], zh['chat.questions.next'],
    ])
    fireEvent.click(screen.getByRole('button', { name: zh['chat.questions.loadAll'] }))
    expect(props.onLoadAll).toHaveBeenCalledOnce()
    cleanup()
    renderNavigator({ hasMore: false })
    expect(screen.queryByRole('button', { name: zh['chat.questions.loadAll'] })).toBeNull()
  })

  it('shows the load-all request as busy until the last page lands', () => {
    renderNavigator({ hasMore: true, loadingAll: true })
    const busy = screen.getByRole('button', { name: zh['chat.questions.loadingAll'] })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    expect(busy.getAttribute('aria-busy')).toBe('true')
    cleanup()
    // The final page clears hasMore before the request settles: the busy
    // entry stays until the loop itself reports completion.
    renderNavigator({ hasMore: false, loadingAll: true })
    expect(screen.getByRole('button', { name: zh['chat.questions.loadingAll'] })).toBeTruthy()
  })
})

describe('question search honesty', () => {
  it('never reports "no match" from the loaded window alone', async () => {
    // No host search composed in: the window is all this view can see, so its
    // silence about earlier questions must be stated, not implied.
    renderNavigator({ hasMore: true, searchQuestions: undefined })
    searchFor('不存在的词')
    expect(await screen.findByText(zh['chat.questions.windowOnly'])).toBeTruthy()
    expect(screen.queryByText(zh['chat.questions.searchEmpty'])).toBeNull()
  })

  it('says a session-wide search found nothing only when one actually ran', async () => {
    const searchQuestions = vi.fn().mockResolvedValue({ hits: [], complete: true })
    renderNavigator({ hasMore: true, searchQuestions })
    searchFor('不存在的词')
    expect(await screen.findByText(zh['chat.questions.searchEmpty'])).toBeTruthy()
  })

  it('admits the result is partial when the host truncated it', async () => {
    const searchQuestions = vi.fn().mockResolvedValue({
      hits: [{ seq: 1, time: 1_000, snippet: '第一个提问' }],
      complete: false,
    })
    renderNavigator({ hasMore: true, searchQuestions })
    searchFor('提问')
    expect(await screen.findByText(zh['chat.questions.searchPartial'])).toBeTruthy()
  })

  it('reports a failed search instead of showing an empty list', async () => {
    const searchQuestions = vi.fn().mockRejectedValue(new Error('offline'))
    renderNavigator({ hasMore: true, searchQuestions })
    searchFor('提问')
    expect(await screen.findByText(zh['chat.questions.searchFailed'])).toBeTruthy()
    expect(screen.queryByText(zh['chat.questions.searchEmpty'])).toBeNull()
  })

  it('searches the whole session, returning hits the loaded window does not hold', async () => {
    const searchQuestions = vi.fn().mockResolvedValue({
      hits: [{ seq: 99, time: 99_000, snippet: '很早以前的提问' }],
      complete: true,
    })
    renderNavigator({ hasMore: true, searchQuestions })
    searchFor('很早')
    expect(await screen.findByText('很早以前的提问')).toBeTruthy()
  })

  it('jumps an out-of-window hit by seq, so the paging path can fetch it', async () => {
    const searchQuestions = vi.fn().mockResolvedValue({
      hits: [{ seq: 99, time: 99_000, snippet: '很早以前的提问' }],
      complete: true,
    })
    const { props } = renderNavigator({ hasMore: true, searchQuestions })
    searchFor('很早')
    fireEvent.click(await screen.findByText('很早以前的提问'))
    expect(props.onSelectSeq).toHaveBeenCalledWith(99)
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('jumps an in-window hit by index, reusing the loaded question directly', async () => {
    const searchQuestions = vi.fn().mockResolvedValue({
      hits: [{ seq: 2, time: 2_000, snippet: '第二个提问' }],
      complete: true,
    })
    const { props } = renderNavigator({ hasMore: true, searchQuestions })
    searchFor('第二')
    fireEvent.click(await screen.findByText('第二个提问'))
    expect(props.onSelect).toHaveBeenCalledWith(1)
    expect(props.onSelectSeq).not.toHaveBeenCalled()
  })

  it('sends the query as data, never pre-filtered by the loaded window', async () => {
    const searchQuestions = vi.fn().mockResolvedValue({ hits: [], complete: true })
    renderNavigator({ hasMore: true, searchQuestions })
    searchFor('  提问  ')
    await screen.findByText(zh['chat.questions.searchEmpty'])
    expect(searchQuestions).toHaveBeenCalledWith('提问', expect.anything())
  })
})

describe('question context removal', () => {
  function removalProps(overrides: Partial<QuestionRemovalProps> = {}): QuestionRemovalProps {
    return {
      turnOfQuestion: new Map([['q1', 1], ['q2', 2], ['q3', 3]]),
      removableTurns: new Set([1, 2]),
      removedTurns: new Set(),
      onRemoveTurns: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    }
  }

  /** The centered removal dialog, told apart from the panel by its own title. */
  function queryConfirmDialog(): HTMLElement | null {
    return screen.queryByRole('dialog', { name: zh['chat.questions.removeConfirmTitle'] })
  }

  function confirmDialog(): HTMLElement {
    return screen.getByRole('dialog', { name: zh['chat.questions.removeConfirmTitle'] })
  }

  function rowOf(text: string): HTMLElement {
    const row = screen.getByText(text).closest('[data-current], div:has(> button[title])')
    if (!(row instanceof HTMLElement)) throw new Error(`no row for ${text}`)
    return row
  }

  it('offers no removal control until the view composes removal facts', () => {
    renderNavigator()
    fireEvent.click(searchEntry())
    expect(screen.queryByRole('button', { name: zh['chat.questions.select'] })).toBeNull()
    expect(screen.queryByRole('button', { name: zh['chat.questions.removeOne'] })).toBeNull()
  })

  it('removes one question through its row entry after confirming in the centered dialog', async () => {
    const removal = removalProps()
    renderNavigator({ removal })
    fireEvent.click(searchEntry())
    // Only removable rows carry the entry: the running third turn has none.
    const entries = screen.getAllByRole('button', { name: zh['chat.questions.removeOne'] })
    expect(entries).toHaveLength(2)
    fireEvent.click(entries[1]!)
    // The dialog names the count, the exact question leaving, and the keys.
    const dialog = confirmDialog()
    expect(dialog.textContent).toContain(zh['chat.questions.removeConfirm'].replace('{count}', '1'))
    expect(dialog.textContent).toContain('第二个提问')
    expect(dialog.textContent).not.toContain('第一个提问')
    expect(dialog.textContent).toContain(zh['chat.questions.removeConfirmHint'])
    expect(removal.onRemoveTurns).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: zh['chat.questions.removeConfirmYes'] }))
    expect(removal.onRemoveTurns).toHaveBeenCalledWith([2])
    await screen.findByRole('button', { name: zh['chat.questions.select'] })
    expect(queryConfirmDialog()).toBeNull()
  })

  it('cancels a pending confirmation without calling the host, leaving the panel open', () => {
    const removal = removalProps()
    renderNavigator({ removal })
    fireEvent.click(searchEntry())
    fireEvent.click(screen.getAllByRole('button', { name: zh['chat.questions.removeOne'] })[0]!)
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: zh['chat.questions.removeConfirmNo'] }))
    expect(queryConfirmDialog()).toBeNull()
    expect(removal.onRemoveTurns).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: zh['chat.questions.history'] })).toBeTruthy()
  })

  it('confirms with Enter and cancels with Escape', () => {
    const removal = removalProps()
    renderNavigator({ removal })
    fireEvent.click(searchEntry())
    fireEvent.click(screen.getAllByRole('button', { name: zh['chat.questions.removeOne'] })[0]!)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(queryConfirmDialog()).toBeNull()
    expect(removal.onRemoveTurns).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: zh['chat.questions.removeOne'] })[0]!)
    // A key that decides nothing leaves the request standing.
    fireEvent.keyDown(document, { key: 'a' })
    expect(removal.onRemoveTurns).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(removal.onRemoveTurns).toHaveBeenCalledWith([1])
  })

  it('keeps the panel open while the dialog stands, though the dialog sits outside it', () => {
    renderNavigator({ removal: removalProps() })
    fireEvent.click(searchEntry())
    fireEvent.click(screen.getAllByRole('button', { name: zh['chat.questions.removeOne'] })[0]!)
    // The dialog is portaled to the body, so its own presses are "outside" the
    // panel; the panel must not close under them and take the dialog with it.
    fireEvent.pointerDown(confirmDialog())
    expect(confirmDialog()).toBeTruthy()
    expect(screen.getByRole('dialog', { name: zh['chat.questions.history'] })).toBeTruthy()
  })

  it('answers nothing twice while the removal runs', () => {
    const removal = removalProps({ onRemoveTurns: vi.fn().mockReturnValue(new Promise(() => {})) })
    renderNavigator({ removal })
    fireEvent.click(searchEntry())
    fireEvent.click(screen.getAllByRole('button', { name: zh['chat.questions.removeOne'] })[0]!)
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: zh['chat.questions.removeConfirmYes'] }))
    const running = within(confirmDialog()).getByRole('button', { name: zh['chat.questions.removing'] })
    expect((running as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(removal.onRemoveTurns).toHaveBeenCalledOnce()
    expect(confirmDialog()).toBeTruthy()
  })

  it('multi-selects removable rows as checkboxes and removes them together', async () => {
    const removal = removalProps()
    const { props } = renderNavigator({ removal })
    fireEvent.click(searchEntry())
    fireEvent.click(screen.getByRole('button', { name: zh['chat.questions.select'] }))
    const boxes = screen.getAllByRole('checkbox') as HTMLButtonElement[]
    expect(boxes).toHaveLength(3)
    // The running turn cannot be picked; a click there navigates nowhere either.
    expect(boxes[2]!.disabled).toBe(true)
    const remove = screen.getByRole('button', { name: zh['chat.questions.removeSelected'].replace('{count}', '0') }) as HTMLButtonElement
    expect(remove.disabled).toBe(true)
    fireEvent.click(boxes[1]!)
    fireEvent.click(boxes[0]!)
    expect(props.onSelect).not.toHaveBeenCalled()
    expect(boxes[0]!.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(boxes[1]!)
    expect(boxes[1]!.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(boxes[1]!)
    fireEvent.click(screen.getByRole('button', { name: zh['chat.questions.removeSelected'].replace('{count}', '2') }))
    const dialog = confirmDialog()
    expect(dialog.textContent).toContain(zh['chat.questions.removeConfirm'].replace('{count}', '2'))
    expect(dialog.textContent).toContain('第一个提问')
    expect(dialog.textContent).toContain('第二个提问')
    fireEvent.click(within(dialog).getByRole('button', { name: zh['chat.questions.removeConfirmYes'] }))
    expect(removal.onRemoveTurns).toHaveBeenCalledWith([1, 2])
    // Success leaves selection mode.
    await screen.findByRole('button', { name: zh['chat.questions.select'] })
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('picks every removable row on screen at once, and clears the picks again', () => {
    const removal = removalProps()
    renderNavigator({ removal })
    fireEvent.click(searchEntry())
    fireEvent.click(screen.getByRole('button', { name: zh['chat.questions.select'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['chat.questions.selectAll'] }))
    // The running third turn is not removable, so select-all leaves it alone.
    expect(screen.getAllByRole('checkbox').map(box => box.getAttribute('aria-checked')))
      .toEqual(['true', 'true', 'false'])
    fireEvent.click(screen.getByRole('button', { name: zh['chat.questions.selectNone'] }))
    expect(screen.getAllByRole('checkbox').map(box => box.getAttribute('aria-checked')))
      .toEqual(['false', 'false', 'false'])
  })

  it('offers no select-all when no row on screen can be removed', () => {
    renderNavigator({ removal: removalProps() })
    fireEvent.click(searchEntry())
    fireEvent.click(screen.getByRole('button', { name: zh['chat.questions.select'] }))
    fireEvent.change(screen.getByPlaceholderText(zh['chat.questions.search']), { target: { value: '第三' } })
    const all = screen.getByRole('button', { name: zh['chat.questions.selectAll'] }) as HTMLButtonElement
    expect(all.disabled).toBe(true)
  })

  /** Checked state of every row, in list order. */
  function picks(): (string | null)[] {
    return screen.getAllByRole('checkbox').map(box => box.getAttribute('aria-checked'))
  }

  it('enters selection from a ⌘/Ctrl press on a row, and toggles that one pick', () => {
    const { props } = renderNavigator({ removal: removalProps() })
    fireEvent.click(searchEntry())
    expect(screen.getByText(zh['chat.questions.selectHint'])).toBeTruthy()
    fireEvent.click(screen.getByTitle('第一个提问'), { metaKey: true })
    // The press picks instead of navigating, and the mode toggle was skipped.
    expect(props.onSelect).not.toHaveBeenCalled()
    expect(picks()).toEqual(['true', 'false', 'false'])
    fireEvent.click(screen.getByTitle('第二个提问'), { ctrlKey: true })
    expect(picks()).toEqual(['true', 'true', 'false'])
    fireEvent.click(screen.getByTitle('第二个提问'), { metaKey: true })
    expect(picks()).toEqual(['true', 'false', 'false'])
  })

  it('takes every removable row between the anchor and a Shift press', () => {
    const removal: QuestionRemovalProps = {
      turnOfQuestion: new Map([['q1', 1], ['q2', 2], ['q3', 3], ['q4', 4]]),
      // The third turn is still running, so a range steps over it.
      removableTurns: new Set([1, 2, 4]),
      removedTurns: new Set(),
      onRemoveTurns: vi.fn().mockResolvedValue(undefined),
    }
    renderNavigator({ questions: [...QUESTIONS, question(4, '第四个提问')], removal })
    fireEvent.click(searchEntry())
    fireEvent.click(screen.getByTitle('第一个提问'), { metaKey: true })
    fireEvent.click(screen.getByTitle('第四个提问'), { shiftKey: true })
    expect(picks()).toEqual(['true', 'true', 'false', 'true'])
    fireEvent.click(screen.getByRole('button', { name: zh['chat.questions.removeSelected'].replace('{count}', '3') }))
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: zh['chat.questions.removeConfirmYes'] }))
    expect(removal.onRemoveTurns).toHaveBeenCalledWith([1, 2, 4])
  })

  it('treats a Shift press with no reachable anchor as a single pick', () => {
    renderNavigator({ removal: removalProps() })
    fireEvent.click(searchEntry())
    // Nothing anchors the range yet.
    fireEvent.click(screen.getByTitle('第二个提问'), { shiftKey: true })
    expect(picks()).toEqual(['false', 'true', 'false'])

    // An anchor the query filtered away cannot end a range either, so the
    // press picks its own row and becomes the new anchor.
    fireEvent.change(screen.getByPlaceholderText(zh['chat.questions.search']), { target: { value: '第一' } })
    fireEvent.click(screen.getByTitle('第一个提问'), { shiftKey: true })
    expect(picks()).toEqual(['true'])
    expect(screen.getByRole('button', { name: zh['chat.questions.removeSelected'].replace('{count}', '2') })).toBeTruthy()
  })

  /** The row container the pointer events go to, addressed by its question text. */
  function rowContainer(text: string): HTMLElement {
    const row = screen.getByText(text).closest('button')?.parentElement
    if (!(row instanceof HTMLElement)) throw new Error(`no row for ${text}`)
    return row
  }

  function renderFourRows(): QuestionRemovalProps {
    const removal: QuestionRemovalProps = {
      turnOfQuestion: new Map([['q1', 1], ['q2', 2], ['q3', 3], ['q4', 4]]),
      // The third turn is still running, so a range steps over it.
      removableTurns: new Set([1, 2, 4]),
      removedTurns: new Set(),
      onRemoveTurns: vi.fn().mockResolvedValue(undefined),
    }
    renderNavigator({ questions: [...QUESTIONS, question(4, '第四个提问')], removal })
    fireEvent.click(searchEntry())
    return removal
  }

  it('takes the range live while Shift is held, following the hovered row', () => {
    renderFourRows()
    fireEvent.click(screen.getByTitle('第一个提问'), { metaKey: true })
    fireEvent.pointerOver(rowContainer('第四个提问'))
    fireEvent.keyDown(document, { key: 'Shift' })
    // The hovered row is picked with the range that reaches it.
    expect(picks()).toEqual(['true', 'true', 'false', 'true'])
    // Sweeping back shrinks the range: it recomputes from the picks the
    // gesture started with rather than accumulating everything crossed.
    fireEvent.pointerOver(rowContainer('第二个提问'))
    expect(picks()).toEqual(['true', 'true', 'false', 'false'])
    // Releasing Shift commits, so a later Escape cannot take it back.
    fireEvent.keyUp(document, { key: 'Shift' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('enters selection from a held Shift alone, with the hovered row as the pick', () => {
    const { props } = renderNavigator({ removal: removalProps() })
    fireEvent.click(searchEntry())
    fireEvent.pointerOver(rowContainer('第二个提问'))
    fireEvent.keyDown(document, { key: 'Shift' })
    expect(picks()).toEqual(['false', 'true', 'false'])
    expect(props.onSelect).not.toHaveBeenCalled()
    // A hovered row that cannot be removed adds nothing.
    fireEvent.pointerOver(rowContainer('第三个提问'))
    expect(picks()).toEqual(['false', 'true', 'false'])
  })

  it('cancels an open range with Escape, keeping the picks it started from', () => {
    renderFourRows()
    fireEvent.click(screen.getByTitle('第一个提问'), { metaKey: true })
    fireEvent.pointerOver(rowContainer('第四个提问'))
    fireEvent.keyDown(document, { key: 'Shift' })
    expect(picks()).toEqual(['true', 'true', 'false', 'true'])
    fireEvent.keyDown(document, { key: 'Escape' })
    // Back to the pick held before the sweep, still in selection mode.
    expect(picks()).toEqual(['true', 'false', 'false', 'false'])
  })

  it('backs Escape out one level at a time: range, then selection, then the panel', () => {
    renderNavigator({ removal: removalProps() })
    fireEvent.click(searchEntry())
    fireEvent.click(screen.getByTitle('第一个提问'), { metaKey: true })
    fireEvent.keyDown(document, { key: 'Escape' })
    // No range was open, so this leaves selection mode and drops the picks.
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('dialog', { name: zh['chat.questions.history'] })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: zh['chat.questions.history'] })).toBeNull()
  })

  it('leaves Escape to the removal dialog while it stands', () => {
    renderNavigator({ removal: removalProps() })
    fireEvent.click(searchEntry())
    fireEvent.click(screen.getAllByRole('button', { name: zh['chat.questions.removeOne'] })[0]!)
    fireEvent.keyDown(document, { key: 'Escape' })
    // The dialog closed and the panel stayed: one Escape, one level.
    expect(queryConfirmDialog()).toBeNull()
    expect(screen.getByRole('dialog', { name: zh['chat.questions.history'] })).toBeTruthy()
  })

  it('ignores a modifier press on a row that cannot be removed', () => {
    const { props } = renderNavigator({ removal: removalProps() })
    fireEvent.click(searchEntry())
    fireEvent.click(screen.getByTitle('第三个提问'), { metaKey: true })
    fireEvent.click(screen.getByTitle('第三个提问'), { shiftKey: true })
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('names in the dialog only the questions whose turns are leaving', () => {
    // A question whose turn the window holds no boundary for is never listed.
    const removal = removalProps({ turnOfQuestion: new Map([['q1', 1], ['q2', 2]]) })
    renderNavigator({ removal })
    fireEvent.click(searchEntry())
    fireEvent.click(screen.getAllByRole('button', { name: zh['chat.questions.removeOne'] })[0]!)
    const listed = within(confirmDialog()).getAllByRole('listitem').map(item => item.textContent)
    expect(listed).toEqual(['第一个提问'])
  })

  it('leaves selection mode with its picks when cancelled, and forgets it when the panel closes', () => {
    renderNavigator({ removal: removalProps() })
    fireEvent.click(searchEntry())
    fireEvent.click(screen.getByRole('button', { name: zh['chat.questions.select'] }))
    fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    fireEvent.click(screen.getByRole('button', { name: zh['chat.questions.selectCancel'] }))
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['chat.questions.select'] }))
    expect(screen.getAllByRole('checkbox')[0]!.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(searchEntry())
    fireEvent.click(searchEntry())
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('reports a refused removal and keeps the rows', async () => {
    const removal = removalProps({ onRemoveTurns: vi.fn().mockRejectedValue(new Error('turn 2 has not completed')) })
    renderNavigator({ removal })
    fireEvent.click(searchEntry())
    fireEvent.click(screen.getAllByRole('button', { name: zh['chat.questions.removeOne'] })[1]!)
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: zh['chat.questions.removeConfirmYes'] }))
    expect((await screen.findByRole('alert')).textContent).toContain('turn 2 has not completed')
    expect(screen.getAllByText(/提问$/)).toHaveLength(3)
    fireEvent.click(within(confirmDialog()).getAllByRole('button', { name: commonZh['close'] })[1]!)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('marks an already-removed question and never offers it again', () => {
    renderNavigator({ removal: removalProps({ removableTurns: new Set([1]), removedTurns: new Set([2]) }) })
    fireEvent.click(searchEntry())
    expect(screen.getByText(zh['chat.questions.removed'])).toBeTruthy()
    expect(rowOf('第二个提问').getAttribute('data-removed')).toBe('true')
    expect(screen.getAllByRole('button', { name: zh['chat.questions.removeOne'] })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: zh['chat.questions.select'] }))
    const boxes = screen.getAllByRole('checkbox') as HTMLButtonElement[]
    expect(boxes[1]!.disabled).toBe(true)
    expect(boxes[2]!.getAttribute('title')).toBe(zh['chat.questions.notRemovable'])
  })

  it('drops a pick whose turn stops being removable', () => {
    const { rerender, props } = renderNavigator({ removal: removalProps() })
    fireEvent.click(searchEntry())
    fireEvent.click(screen.getByRole('button', { name: zh['chat.questions.select'] }))
    fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    rerender(<QuestionNavigator {...props} removal={removalProps({ removableTurns: new Set([2]), removedTurns: new Set([1]) })} />)
    expect(screen.getAllByRole('checkbox')[0]!.getAttribute('aria-checked')).toBe('false')
    const remove = screen.getByRole('button', { name: zh['chat.questions.removeSelected'].replace('{count}', '0') })
    expect(remove.hasAttribute('disabled')).toBe(true)
  })

  it('keeps navigation for out-of-window hits and offers them no removal', async () => {
    const searchQuestions = vi.fn().mockResolvedValue({
      hits: [{ seq: 99, time: 99_000, snippet: '很早以前的提问' }],
      complete: true,
    })
    const { props } = renderNavigator({ hasMore: true, searchQuestions, removal: removalProps() })
    searchFor('很早')
    const hit = await screen.findByText('很早以前的提问')
    expect(screen.queryByRole('button', { name: zh['chat.questions.removeOne'] })).toBeNull()
    fireEvent.click(hit)
    expect(props.onSelectSeq).toHaveBeenCalledWith(99)
  })
})
