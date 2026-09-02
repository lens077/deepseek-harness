import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  clickRow, detectApplePlatform, EMPTY_SELECTION, isToggleModifier, moveLead,
  pruneSelection, selectAll, type SelectionState,
} from '../src/client/selection.ts'

const sid = (value: string): SessionId => value as SessionId
const visible = ['a', 'b', 'c', 'd', 'e'].map(sid)
const plain = { toggle: false, range: false }
const toggle = { toggle: true, range: false }
const range = { toggle: false, range: true }
const both = { toggle: true, range: true }

const state = (selected: string[], anchor?: string, lead?: string): SelectionState => ({
  selected: selected.map(sid),
  anchor: anchor === undefined ? undefined : sid(anchor),
  lead: lead === undefined ? undefined : sid(lead),
})

describe('modifier normalization', () => {
  it('reads Cmd on Apple platforms and Ctrl elsewhere', () => {
    const cmd = { ctrlKey: false, metaKey: true }
    const ctrl = { ctrlKey: true, metaKey: false }
    expect(isToggleModifier(cmd, true)).toBe(true)
    expect(isToggleModifier(ctrl, true)).toBe(false)
    expect(isToggleModifier(ctrl, false)).toBe(true)
    expect(isToggleModifier(cmd, false)).toBe(false)
  })

  it('detects Apple platforms across the navigator signals', () => {
    expect(detectApplePlatform({ userAgentData: { platform: 'macOS' } })).toBe(true)
    expect(detectApplePlatform({ platform: 'MacIntel' })).toBe(true)
    expect(detectApplePlatform({ platform: 'iPhone' })).toBe(true)
    expect(detectApplePlatform({ platform: 'Win32' })).toBe(false)
    expect(detectApplePlatform({ platform: 'Linux x86_64' })).toBe(false)
    // Falls back to the user agent when no platform field exists at all.
    expect(detectApplePlatform({ userAgent: 'Mozilla/5.0 (Macintosh)' })).toBe(true)
    expect(detectApplePlatform({})).toBe(false)
    expect(detectApplePlatform()).toBe(false)
  })
})

describe('clicking rows', () => {
  it('plain click replaces the selection and opens the session', () => {
    const result = clickRow(state(['a', 'b'], 'a', 'b'), visible, sid('d'), plain)
    expect(result.state).toEqual(state(['d'], 'd', 'd'))
    expect(result.open).toBe(true)
  })

  it('toggle click adds a row without opening it', () => {
    const result = clickRow(state(['a'], 'a', 'a'), visible, sid('c'), toggle)
    expect(result.state.selected).toEqual([sid('a'), sid('c')])
    expect(result.state.anchor).toBe(sid('c'))
    expect(result.open).toBe(false)
  })

  it('toggle click removes an already selected row', () => {
    const result = clickRow(state(['a', 'c'], 'a', 'c'), visible, sid('a'), toggle)
    expect(result.state.selected).toEqual([sid('c')])
    // The anchor follows the gesture even when it deselects.
    expect(result.state.anchor).toBe(sid('a'))
  })

  it('range click selects the inclusive span and keeps the anchor', () => {
    const result = clickRow(state(['b'], 'b', 'b'), visible, sid('d'), range)
    expect(result.state.selected).toEqual([sid('b'), sid('c'), sid('d')])
    expect(result.state.anchor).toBe(sid('b'))
    expect(result.state.lead).toBe(sid('d'))
    expect(result.open).toBe(false)
  })

  it('range click works upward with the same inclusive span', () => {
    const result = clickRow(state(['d'], 'd', 'd'), visible, sid('b'), range)
    expect(result.state.selected).toEqual([sid('b'), sid('c'), sid('d')])
    expect(result.state.anchor).toBe(sid('d'))
  })

  it('range click replaces a prior selection outside the span', () => {
    const result = clickRow(state(['a', 'e'], 'b', 'e'), visible, sid('c'), range)
    expect(result.state.selected).toEqual([sid('b'), sid('c')])
  })

  it('toggle+range unions the span onto the existing selection without repeats', () => {
    const result = clickRow(state(['a', 'b'], 'b', 'b'), visible, sid('d'), both)
    expect(result.state.selected).toEqual([sid('a'), sid('b'), sid('c'), sid('d')])
  })

  it('range without an anchor selects the clicked row alone', () => {
    const result = clickRow(EMPTY_SELECTION, visible, sid('c'), range)
    expect(result.state).toEqual(state(['c'], 'c', 'c'))
    expect(result.open).toBe(false)
  })

  it('range from an anchor that left the visible rows re-seats on the click', () => {
    const result = clickRow(state(['z'], 'z', 'z'), visible, sid('c'), range)
    expect(result.state).toEqual(state(['c'], 'c', 'c'))
  })
})

describe('select all', () => {
  it('takes every visible row and spans the anchor to the lead', () => {
    expect(selectAll(visible)).toEqual(state(['a', 'b', 'c', 'd', 'e'], 'a', 'e'))
  })

  it('is empty on an empty list', () => {
    expect(selectAll([])).toEqual(EMPTY_SELECTION)
  })
})

describe('arrow-key movement', () => {
  it('moves a plain lead and carries the anchor along', () => {
    expect(moveLead(state(['b'], 'b', 'b'), visible, 1, false)).toEqual(state(['c'], 'c', 'c'))
    expect(moveLead(state(['b'], 'b', 'b'), visible, -1, false)).toEqual(state(['a'], 'a', 'a'))
  })

  it('extends from the anchor while shrinking back over it', () => {
    const extended = moveLead(state(['b'], 'b', 'b'), visible, 1, true)
    expect(extended).toEqual(state(['b', 'c'], 'b', 'c'))
    // Reversing past the anchor flips the span rather than clearing it.
    const reversed = moveLead(state(['b', 'c'], 'b', 'c'), visible, -1, true)
    expect(reversed).toEqual(state(['b'], 'b', 'b'))
    const crossed = moveLead(reversed as SelectionState, visible, -1, true)
    expect(crossed).toEqual(state(['a', 'b'], 'b', 'a'))
  })

  it('clamps at both ends instead of wrapping', () => {
    expect(moveLead(state(['e'], 'e', 'e'), visible, 1, false)).toBeNull()
    expect(moveLead(state(['a'], 'a', 'a'), visible, -1, false)).toBeNull()
  })

  it('lands on an end of the list when no lead is live', () => {
    expect(moveLead(EMPTY_SELECTION, visible, 1, false)).toEqual(state(['a'], 'a', 'a'))
    expect(moveLead(EMPTY_SELECTION, visible, -1, false)).toEqual(state(['e'], 'e', 'e'))
    expect(moveLead(state([], 'gone', 'gone'), visible, 1, true)).toEqual(state(['a'], 'a', 'a'))
  })

  it('does nothing without visible rows', () => {
    expect(moveLead(state(['a'], 'a', 'a'), [], 1, false)).toBeNull()
  })

  it('falls back to the moved row when the anchor is no longer visible', () => {
    const moved = moveLead(state(['b'], 'gone', 'b'), visible, 1, true)
    expect(moved).toEqual(state(['c'], 'c', 'c'))
  })
})

describe('pruning', () => {
  it('drops rows the browser no longer lists', () => {
    const listed = new Set([sid('a'), sid('c')])
    expect(pruneSelection(state(['a', 'b', 'c'], 'a', 'c'), listed).selected).toEqual([sid('a'), sid('c')])
  })

  it('keeps the anchor and lead so a collapsed group retains its origin', () => {
    const listed = new Set([sid('a')])
    const pruned = pruneSelection(state(['a', 'b'], 'b', 'b'), listed)
    expect(pruned.anchor).toBe(sid('b'))
    expect(pruned.lead).toBe(sid('b'))
  })

  it('returns the same reference when nothing changed', () => {
    const before = state(['a'], 'a', 'a')
    expect(pruneSelection(before, new Set([sid('a')]))).toBe(before)
  })
})
