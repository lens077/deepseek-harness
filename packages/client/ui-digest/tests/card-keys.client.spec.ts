/**
 * The card key table and the arrow-key neighbour search: digits map to the
 * button order and nothing else, availability follows the card's state, and
 * the neighbour search stays on the focused card's row or column and stops
 * at its edge.
 */
import { describe, expect, it } from 'vitest'
import { CARD_ACTION_KEYS, cardActionAvailable, cardActionOfKey, neighborCard, type CardBox } from '../src/client/card-keys.ts'
import type { InboxItem } from '../src/client/select.ts'

const box = (sessionId: string, x: number, y: number, width = 280, height = 200): CardBox => ({ sessionId, x, y, width, height })

const item = (over: Partial<InboxItem> = {}): InboxItem => ({ running: false, waiting: false, ...over } as InboxItem)

describe('card keys', () => {
  it('numbers the actions in button order and spells no other key', () => {
    expect(CARD_ACTION_KEYS).toEqual({ open: '1', continue: '2', handled: '3', todo: '4', pin: '5', snooze: '6' })
    expect(cardActionOfKey('1')).toBe('open')
    expect(cardActionOfKey('6')).toBe('snooze')
    for (const key of ['0', '7', 'a', ' ', '', '12', 'Enter']) expect(cardActionOfKey(key)).toBeNull()
  })

  it('offers each action under the same conditions the card draws its button', () => {
    const idle = item()
    const running = item({ running: true })
    const waiting = item({ waiting: true })
    expect(['open', 'continue', 'handled', 'todo', 'pin', 'snooze'].map(action => cardActionAvailable(idle, action as never, true)))
      .toEqual([true, true, true, true, true, true])
    expect(['open', 'continue', 'handled', 'todo', 'pin', 'snooze'].map(action => cardActionAvailable(running, action as never, true)))
      .toEqual([true, false, false, true, true, false])
    expect(['open', 'continue', 'handled', 'todo', 'pin', 'snooze'].map(action => cardActionAvailable(waiting, action as never, false)))
      .toEqual([true, false, true, true, false, false])
  })
})

describe('neighborCard', () => {
  // A two-column grid of four cards above a section holding one card.
  const grid = [box('a', 0, 0), box('b', 292, 0), box('c', 0, 212), box('d', 292, 212), box('e', 0, 480)]

  it('walks a row and its columns', () => {
    expect(neighborCard(grid, grid[0]!, 'right')).toBe('b')
    expect(neighborCard(grid, grid[1]!, 'left')).toBe('a')
    expect(neighborCard(grid, grid[0]!, 'down')).toBe('c')
    expect(neighborCard(grid, grid[3]!, 'up')).toBe('b')
    expect(neighborCard(grid, grid[2]!, 'right')).toBe('d')
  })

  it('continues down its own column into the next section, and stops at every edge', () => {
    expect(neighborCard(grid, grid[2]!, 'down')).toBe('e')
    expect(neighborCard(grid, grid[4]!, 'up')).toBe('c')
    // The right column ends with the section: nothing sits under it.
    expect(neighborCard(grid, grid[3]!, 'down')).toBeNull()
    expect(neighborCard(grid, grid[1]!, 'right')).toBeNull()
    expect(neighborCard(grid, grid[0]!, 'left')).toBeNull()
    expect(neighborCard(grid, grid[0]!, 'up')).toBeNull()
    expect(neighborCard(grid, grid[4]!, 'down')).toBeNull()
    expect(neighborCard(grid, grid[4]!, 'right')).toBeNull()
  })

  it('crosses board columns of unequal height by the card whose centre sits nearest beside it', () => {
    const board = [box('p', 0, 0, 200, 120), box('q', 0, 132, 200, 400), box('r', 212, 0, 200, 300), box('s', 212, 312, 200, 120)]
    // Both right-hand cards overlap the tall card; the one whose centre is closer wins.
    expect(neighborCard(board, board[1]!, 'right')).toBe('s')
    expect(neighborCard(board, board[3]!, 'left')).toBe('q')
    expect(neighborCard(board, board[0]!, 'right')).toBe('r')
  })
})
