/**
 * Logical line boundaries over a plain-text buffer, shared by the composer's
 * Home/End keymap and the text-field handler that gives ordinary inputs the
 * same gesture. A line runs between newlines: soft wrapping is invisible here,
 * so a wrapped paragraph counts as one line and Home/End reach its real ends.
 */

/** Where a Home/End gesture sends the caret. */
export type CaretEdge = 'start' | 'end'

/** How far the gesture reaches: the caret's own line, or the whole buffer. */
export type CaretScope = 'line' | 'buffer'

/** Whether the gesture moves the caret or drags the selection's free end. */
export type CaretAlter = 'move' | 'extend'

/**
 * Offset of the start of the line containing an offset.
 * @param text - the buffer.
 * @param offset - caret offset into it.
 * @returns the offset just after the preceding newline, or 0.
 */
export function lineStartOffset(text: string, offset: number): number {
  return offset === 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1
}

/**
 * Offset of the end of the line containing an offset.
 * @param text - the buffer.
 * @param offset - caret offset into it.
 * @returns the offset of the next newline, or the buffer length.
 */
export function lineEndOffset(text: string, offset: number): number {
  const next = text.indexOf('\n', offset)
  return next === -1 ? text.length : next
}

/**
 * Target offset of one Home/End gesture.
 * @param text - the buffer the caret sits in.
 * @param focus - the moving end of the current selection.
 * @param edge - start (Home) or end (End).
 * @param scope - the caret's own line, or the whole buffer.
 * @returns the offset the caret lands on.
 */
export function caretTargetOffset(text: string, focus: number, edge: CaretEdge, scope: CaretScope): number {
  if (scope === 'buffer') return edge === 'start' ? 0 : text.length
  return edge === 'start' ? lineStartOffset(text, focus) : lineEndOffset(text, focus)
}
