// @vitest-environment jsdom
// SideBySideDiff: the line pairing that keeps the two columns level (creates,
// context, even and uneven replacements, one-sided runs, the terminator rule),
// the padding rows that stand in for an absent side, the per-segment provenance
// labels, the empty-segments null render, and the lockstep horizontal scroll
// including the equality check that stops the mirror-back loop.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { pairDiffLines, SideBySideDiff, type SideBySideSegment } from '../src/index.ts'

afterEach(cleanup)

/** One segment's rendered text per row, per side, with padding rows as ''. */
function sides(container: HTMLElement): { old: string[]; new: string[] } {
  const pane = (side: string): string[] => [
    ...(container.querySelector(`[data-side="${side}"]`)?.children ?? []),
  ].map(row => row.textContent ?? '')
  return { old: pane('old'), new: pane('new') }
}

function segment(oldText: string | null, newText: string, label = 'Turn 1 · Edit'): SideBySideSegment {
  return { label, oldText, newText }
}

describe('pairDiffLines', () => {
  it('pairs a create as added rows against an empty left side', () => {
    expect(pairDiffLines(null, 'a\nb')).toEqual([
      { kind: 'add', left: null, right: 'a' },
      { kind: 'add', left: null, right: 'b' },
    ])
  })

  it('keeps context lines on both sides', () => {
    expect(pairDiffLines('a\nb', 'a\nb')).toEqual([
      { kind: 'same', left: 'a', right: 'a' },
      { kind: 'same', left: 'b', right: 'b' },
    ])
  })

  it('zips an even replacement into one row per changed line', () => {
    expect(pairDiffLines('a\nb\nc', 'a\nB\nc')).toEqual([
      { kind: 'same', left: 'a', right: 'a' },
      { kind: 'change', left: 'b', right: 'B' },
      { kind: 'same', left: 'c', right: 'c' },
    ])
  })

  it('falls the longer side through when a replacement grows', () => {
    expect(pairDiffLines('a\nb', 'A\nB\nC')).toEqual([
      { kind: 'change', left: 'a', right: 'A' },
      { kind: 'change', left: 'b', right: 'B' },
      { kind: 'add', left: null, right: 'C' },
    ])
  })

  it('falls the longer side through when a replacement shrinks', () => {
    expect(pairDiffLines('a\nb\nc', 'A')).toEqual([
      { kind: 'change', left: 'a', right: 'A' },
      { kind: 'del', left: 'b', right: null },
      { kind: 'del', left: 'c', right: null },
    ])
  })

  it('renders a pure deletion as left-only rows', () => {
    expect(pairDiffLines('a\nb\nc', 'a\nc')).toEqual([
      { kind: 'same', left: 'a', right: 'a' },
      { kind: 'del', left: 'b', right: null },
      { kind: 'same', left: 'c', right: 'c' },
    ])
  })

  it('renders a pure insertion as right-only rows', () => {
    expect(pairDiffLines('a\nc', 'a\nb\nc')).toEqual([
      { kind: 'same', left: 'a', right: 'a' },
      { kind: 'add', left: null, right: 'b' },
      { kind: 'same', left: 'c', right: 'c' },
    ])
  })

  it('treats a whole-file deletion as left-only rows with no following added run', () => {
    expect(pairDiffLines('a\nb', '')).toEqual([
      { kind: 'del', left: 'a', right: null },
      { kind: 'del', left: 'b', right: null },
    ])
  })

  it('treats one trailing newline as a terminator and keeps interior blanks', () => {
    expect(pairDiffLines(null, 'a\n')).toEqual([{ kind: 'add', left: null, right: 'a' }])
    expect(pairDiffLines(null, 'a\n\nb')).toEqual([
      { kind: 'add', left: null, right: 'a' },
      { kind: 'add', left: null, right: '' },
      { kind: 'add', left: null, right: 'b' },
    ])
    expect(pairDiffLines(null, '')).toEqual([])
  })
})

describe('SideBySideDiff rendering', () => {
  it('draws the path, each segment label, and level columns with padding rows', () => {
    const { container } = render(
      <SideBySideDiff path="src/app.ts" segments={[segment('a\nb\nc', 'a\nc')]} />,
    )
    expect(screen.getByText('src/app.ts')).toBeTruthy()
    expect(screen.getByText('Turn 1 · Edit')).toBeTruthy()
    const rows = sides(container)
    expect(rows.old).toEqual(['a', 'b', 'c'])
    // The deleted line's right side is a padding row, so both columns keep three rows.
    expect(rows.new).toEqual(['a', '', 'c'])
    expect(container.querySelectorAll('[class*="_pad_"]').length).toBe(1)
  })

  it('pads the whole left column for a create', () => {
    const { container } = render(
      <SideBySideDiff path="notes/new.md" segments={[segment(null, 'a\nb')]} />,
    )
    const rows = sides(container)
    expect(rows.old).toEqual(['', ''])
    expect(rows.new).toEqual(['a', 'b'])
    expect(container.querySelectorAll('[data-side="old"] [class*="_pad_"]').length).toBe(2)
  })

  it('marks the removed and added sides with their own tones', () => {
    const { container } = render(
      <SideBySideDiff path="src/app.ts" segments={[segment('a', 'B')]} />,
    )
    expect(container.querySelectorAll('[class*="_del_"]').length).toBe(1)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(1)
  })

  it('draws one pane pair per segment, in the order the changes happened', () => {
    const { container } = render(
      <SideBySideDiff
        path="src/app.ts"
        segments={[segment('a', 'b', 'Turn 1 · Write'), segment('b', 'c', 'Turn 3 · Edit')]}
      />,
    )
    expect(container.querySelectorAll('[class*="_segment_"]').length).toBe(2)
    expect(screen.getByText('Turn 1 · Write')).toBeTruthy()
    expect(screen.getByText('Turn 3 · Edit')).toBeTruthy()
  })

  it('renders nothing when there are no segments', () => {
    const { container } = render(<SideBySideDiff path="src/app.ts" segments={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('mirrors horizontal scrolling between the two panes and stops at equality', () => {
    const { container } = render(
      <SideBySideDiff path="src/app.ts" segments={[segment('a\nb', 'A\nB')]} />,
    )
    const left = container.querySelector('[data-side="old"]') as HTMLElement
    const right = container.querySelector('[data-side="new"]') as HTMLElement

    left.scrollLeft = 120
    fireEvent.scroll(left)
    expect(right.scrollLeft).toBe(120)

    // Already level: the mirror-back is a no-op, which is what ends the loop.
    fireEvent.scroll(right)
    expect(left.scrollLeft).toBe(120)

    right.scrollLeft = 40
    fireEvent.scroll(right)
    expect(left.scrollLeft).toBe(40)
  })
})
