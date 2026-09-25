/**
 * The inbox card's action keys and the panel's spatial card navigation, as
 * pure functions over JSON-compatible facts so the panel, the card, and the
 * tests share one table. The digit keys follow the button order the card
 * draws; availability follows the same conditions that decide whether the
 * card draws the button at all, so a key never runs an action the card
 * does not offer.
 */
import { CARD_ACTIONS, type CardAction } from '../nav-settings.ts'
import type { InboxItem } from './select.ts'

/** The digit each card action answers to, in button order. */
export const CARD_ACTION_KEYS: Readonly<Record<CardAction, string>> = Object.freeze(
  Object.fromEntries(CARD_ACTIONS.map((action, index) => [action, String(index + 1)])) as Record<CardAction, string>,
)

/**
 * The card action one bare key spells.
 * @param key - the pressed `KeyboardEvent.key`.
 * @returns the action of a digit in {@link CARD_ACTION_KEYS}, or `null` for any other key.
 */
export function cardActionOfKey(key: string): CardAction | null {
  const index = Number(key) - 1
  return key.length === 1 && Number.isInteger(index) ? CARD_ACTIONS[index] ?? null : null
}

/**
 * Whether the card offers `action` in its current state: a running session
 * cannot be continued, handled, or snoozed; one waiting on the user cannot
 * be continued or snoozed; pinning follows the master switch.
 * @param item - the card's item.
 * @param action - the action to test.
 * @param pinning - whether the pin action is offered at all.
 * @returns whether the card draws the button for `action`.
 */
export function cardActionAvailable(item: InboxItem, action: CardAction, pinning: boolean): boolean {
  switch (action) {
    case 'open': case 'todo': return true
    case 'continue': case 'snooze': return !item.running && !item.waiting
    case 'handled': return !item.running
    case 'pin': return pinning
    /* v8 ignore next -- closed-union exhaustiveness guard */
    default: return assertNever(action)
  }
}

/* v8 ignore next 3 -- closed-union backstop; only reached if the action is forged */
function assertNever(value: never): never {
  throw new Error(`unknown card action: ${String(value)}`)
}

/** One card's on-screen box, in any consistent pixel space. */
export interface CardBox {
  readonly sessionId: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** An arrow-key direction. */
export type Direction = 'up' | 'down' | 'left' | 'right'

/**
 * The card an arrow key reaches from `from`: among the cards that overlap
 * `from` across the arrow's axis (the same row for `left`/`right`, the same
 * column for `up`/`down`) and whose centre lies in the arrow's direction,
 * the one closest along the arrow; equally close cards are told apart by
 * how far their centres sit across the arrow. A card the arrow would miss
 * is never reached, so the edge of a row or column stops the key.
 * @param boxes - every visible card's box.
 * @param from - the focused card's box.
 * @param direction - the arrow pressed.
 * @returns the reached card's session id, or `null` at the edge.
 */
export function neighborCard(boxes: readonly CardBox[], from: CardBox, direction: Direction): string | null {
  const vertical = direction === 'up' || direction === 'down'
  const sign = direction === 'down' || direction === 'right' ? 1 : -1
  const along = (box: CardBox): number => vertical ? box.y + box.height / 2 : box.x + box.width / 2
  const across = (box: CardBox): number => vertical ? box.x + box.width / 2 : box.y + box.height / 2
  const near = (box: CardBox): number => vertical ? box.x : box.y
  const far = (box: CardBox): number => vertical ? box.x + box.width : box.y + box.height
  let best: { id: string; ahead: number; drift: number } | null = null
  for (const box of boxes) {
    if (box.sessionId === from.sessionId) continue
    const ahead = (along(box) - along(from)) * sign
    if (ahead <= 0) continue
    if (near(box) >= far(from) || near(from) >= far(box)) continue
    const drift = Math.abs(across(box) - across(from))
    if (best === null || ahead < best.ahead || (ahead === best.ahead && drift < best.drift)) best = { id: box.sessionId, ahead, drift }
  }
  return best === null ? null : best.id
}
