// @vitest-environment jsdom
/**
 * Question navigator acceptance: the rail is one standing search entry on
 * top, a load-all entry under it while earlier history is unloaded, then
 * stepping — it redraws no question list of its own — and every list the
 * search panel shows says what it covers, so an empty result never speaks
 * for the whole session on the loaded window's authority alone.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserMessageNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { QuestionEntry } from '../src/client/chat/turn-summary.ts'
import { QuestionNavigator } from '../src/client/chat/QuestionNavigator.tsx'
import { zh } from '../src/client/locales.ts'

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

  it('renders nothing for a lone question, which has nowhere to step and nothing to search among', () => {
    const { container } = renderNavigator({ questions: [QUESTIONS[0]!] })
    expect(container.innerHTML).toBe('')
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
