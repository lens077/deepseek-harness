/**
 * Windows-Explorer-style range and toggle selection over the workspace
 * browser's session rows, as pure functions over a visible-row sequence.
 *
 * The sequence is always the rows the user can currently see, in render
 * order: collapsed groups and rows past a group's overflow cut contribute
 * nothing, and a Shift range spans group boundaries exactly as it spans
 * folder boundaries in Explorer. Callers rebuild the sequence per render, so
 * a range never reaches a row that is not on screen.
 *
 * Selection is deliberately separate from the opened session: `currentId`
 * stays the runtime's business fact, while these functions own only the
 * viewing set.
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Selection viewing state. `anchor` is the Explorer range origin (last row
 * reached without Shift); `lead` is the focused row Shift extends to and the
 * arrow keys move. Both stay set after the row leaves the visible sequence so
 * re-expanding a group restores the range origin rather than silently moving
 * it; every consumer resolves them against the current sequence.
 */
export interface SelectionState {
  /** Selected rows, in no meaningful order. */
  selected: readonly SessionId[]
  /**
   * Range origin for Shift. Set together with {@link SelectionState.lead} by
   * every transition, so a state with a lead always has an anchor; both are
   * `undefined` only before the first selecting gesture.
   */
  anchor: SessionId | undefined
  /** Focused row: the Shift target and the arrow-key cursor. */
  lead: SessionId | undefined
}

/** Modifier keys of a selecting gesture, already normalized for the platform. */
export interface SelectionModifiers {
  /** Cmd on Apple platforms, Ctrl elsewhere: toggle one row / extend without replacing. */
  toggle: boolean
  /** Shift: select the range from the anchor. */
  range: boolean
}

/** The empty selection; also the state a disabled toggle collapses to. */
export const EMPTY_SELECTION: SelectionState = { selected: [], anchor: undefined, lead: undefined }

/**
 * Whether a pointer or keyboard event carries the platform's multi-select
 * modifier. Apple platforms use Cmd because Ctrl+click is a system
 * secondary-click there and never reaches a row as a plain click.
 * @param event - modifier flags of the originating event.
 * @param applePlatform - whether the host is an Apple platform.
 * @returns true when the event means "toggle", not "replace".
 */
export function isToggleModifier(
  event: { readonly ctrlKey: boolean; readonly metaKey: boolean },
  applePlatform: boolean,
): boolean {
  return applePlatform ? event.metaKey : event.ctrlKey
}

/**
 * Detect an Apple platform for modifier mapping. Reads the modern
 * `navigator.userAgentData.platform` and falls back to `navigator.platform`,
 * which remains the only signal in several current browsers.
 * @param navigatorLike - the navigator to inspect; absent outside a browser.
 * @returns true on macOS/iOS/iPadOS.
 */
export function detectApplePlatform(navigatorLike?: {
  readonly platform?: string
  readonly userAgent?: string
  readonly userAgentData?: { readonly platform?: string }
}): boolean {
  if (navigatorLike === undefined) return false
  const platform = navigatorLike.userAgentData?.platform
    ?? navigatorLike.platform
    ?? navigatorLike.userAgent
    ?? ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** Deduplicate while keeping first-seen order, so a range never repeats a row. */
function unique(ids: readonly SessionId[]): readonly SessionId[] {
  return [...new Set(ids)]
}

/**
 * The inclusive slice of `visible` between two rows, in visible order.
 * Returns an empty range when either endpoint has left the sequence, which
 * makes every caller fall back to a single-row selection.
 */
function rangeBetween(
  visible: readonly SessionId[],
  from: SessionId,
  to: SessionId,
): readonly SessionId[] {
  const start = visible.indexOf(from)
  const end = visible.indexOf(to)
  if (start === -1 || end === -1) return []
  return start <= end ? visible.slice(start, end + 1) : visible.slice(end, start + 1)
}

/** Outcome of a click: the next selection, and whether the row should open. */
export interface ClickOutcome {
  state: SelectionState
  /**
   * Whether this gesture opens the session. Only an unmodified click opens;
   * every modified gesture is a pure selection change, matching Explorer,
   * where Ctrl/Shift+click never activates the item.
   */
  open: boolean
}

/**
 * Apply a row click under Explorer semantics.
 *
 * - plain: replace the selection with this row and open it
 * - toggle: add or remove this row, move the anchor here, do not open
 * - range: replace the selection with anchor→row, keeping the anchor
 * - toggle+range: union the existing selection with anchor→row
 *
 * A range gesture with no surviving anchor degrades to selecting the clicked
 * row alone, which is what Explorer does on a fresh list.
 *
 * @param state - current selection.
 * @param visible - session ids in current render order.
 * @param id - the clicked row.
 * @param modifiers - normalized modifier flags.
 * @returns the next selection and whether to open the session.
 */
export function clickRow(
  state: SelectionState,
  visible: readonly SessionId[],
  id: SessionId,
  modifiers: SelectionModifiers,
): ClickOutcome {
  if (modifiers.range) {
    const anchor = state.anchor ?? id
    const range = rangeBetween(visible, anchor, id)
    // A vanished anchor leaves no range to draw; select the clicked row and
    // re-seat the anchor there so the next Shift click has an origin.
    if (range.length === 0) {
      return { state: { selected: [id], anchor: id, lead: id }, open: false }
    }
    const selected = modifiers.toggle ? unique([...state.selected, ...range]) : range
    return { state: { selected, anchor, lead: id }, open: false }
  }
  if (modifiers.toggle) {
    const has = state.selected.includes(id)
    const selected = has ? state.selected.filter(candidate => candidate !== id) : [...state.selected, id]
    return { state: { selected, anchor: id, lead: id }, open: false }
  }
  return { state: { selected: [id], anchor: id, lead: id }, open: true }
}

/**
 * Select every visible row (Ctrl/Cmd+A). The anchor moves to the first row
 * and the lead to the last, so a following Shift+click ranges from the top.
 * @param visible - session ids in current render order.
 * @returns the next selection.
 */
export function selectAll(visible: readonly SessionId[]): SelectionState {
  if (visible.length === 0) return EMPTY_SELECTION
  return { selected: [...visible], anchor: visible[0], lead: visible[visible.length - 1] }
}

/**
 * Move the lead by one row (arrow keys), optionally extending the range.
 *
 * Without Shift this is a plain single selection that also moves the anchor.
 * With Shift the anchor stays and the selection becomes anchor→new lead.
 * Movement clamps at both ends rather than wrapping, matching Explorer.
 *
 * @param state - current selection.
 * @param visible - session ids in current render order.
 * @param delta - -1 for previous row, 1 for next row.
 * @param extend - whether Shift is held.
 * @returns the next selection, or null when nothing moves.
 */
export function moveLead(
  state: SelectionState,
  visible: readonly SessionId[],
  delta: -1 | 1,
  extend: boolean,
): SelectionState | null {
  const from = state.lead === undefined ? -1 : visible.indexOf(state.lead)
  // With no live lead, the first keypress lands on an end of the list rather
  // than being swallowed: Down opens at the top, Up at the bottom.
  const index = from === -1
    ? (delta === 1 ? 0 : visible.length - 1)
    : from + delta
  const target = visible[index]
  // One bounds check covers both entry paths: an empty list and a move past
  // either end alike leave nothing to land on, so the keypress does nothing.
  if (target === undefined) return null
  // A live lead always carries an anchor, so `from !== -1` and `extend`
  // together mean the range origin below is present.
  const anchor = extend && from !== -1 ? state.anchor : undefined
  const range = anchor === undefined ? [] : rangeBetween(visible, anchor, target)
  // No range to draw — a plain move, or an anchor that left the visible rows —
  // re-seats on the moved row so Shift+Arrow advances instead of freezing.
  if (anchor === undefined || range.length === 0) {
    return { selected: [target], anchor: target, lead: target }
  }
  return { selected: range, anchor, lead: target }
}

/**
 * Drop rows that are no longer listed, so a selection cannot retain sessions
 * that were archived, deleted, or filtered away by a search. The anchor and
 * lead survive on purpose: a collapsed group must keep its range origin.
 * @param state - current selection.
 * @param listed - every session id the browser still knows about.
 * @returns the pruned selection, or the same reference when nothing changed.
 */
export function pruneSelection(
  state: SelectionState,
  listed: ReadonlySet<SessionId>,
): SelectionState {
  const selected = state.selected.filter(id => listed.has(id))
  if (selected.length === state.selected.length) return state
  return { ...state, selected }
}
