/**
 * Home/End caret motion inside the composer, computed from the EditorState
 * rather than the DOM. macOS binds Home/End to document scrolling even while
 * a contenteditable holds focus, so the composer has to place the caret
 * itself; doing it over the detect projection keeps the gesture independent
 * of the non-standard `Selection.modify` and of soft-wrap geometry.
 *
 * Chips count as one position each (the detect projection's U+FFFC), so a
 * line edge never lands inside a reference. All functions must run inside
 * `editor.update()` — a Lexical command listener already provides one.
 */
import { $getSelection, $isRangeSelection } from 'lexical'
import { caretTargetOffset } from '../line-boundary.ts'
import type { CaretAlter, CaretEdge, CaretScope } from '../line-boundary.ts'
import { $composerLayout, $detectOffsetOfPoint } from './projection.ts'
import { $selectDetectPoints } from './span-map.ts'

/**
 * Move or extend the composer caret to a line or document edge.
 * @param edge - start (Home) or end (End).
 * @param scope - the caret's own line, or the whole draft.
 * @param alter - move the caret, or drag the selection's free end to it.
 * @returns whether the caret moved; false leaves the keystroke to the
 * browser, which is the case for a chip-only NodeSelection and for an
 * unfocused editor, neither of which carries a caret to move.
 */
export function $moveComposerCaret(edge: CaretEdge, scope: CaretScope, alter: CaretAlter): boolean {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return false
  const layout = $composerLayout()
  const anchor = $detectOffsetOfPoint(layout, selection.anchor)
  const focus = $detectOffsetOfPoint(layout, selection.focus)
  if (anchor === null || focus === null) return false
  const target = caretTargetOffset(layout.detectText, focus, edge, scope)
  return $selectDetectPoints(alter === 'extend' ? anchor : target, target)
}
