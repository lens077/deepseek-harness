/**
 * Home/End caret motion for the ordinary `<input>` and `<textarea>` fields
 * outside the composer — search boxes, settings fields, rename prompts.
 * macOS binds both keys to document scrolling even while such a field holds
 * focus, so without this listener a press scrolls the transcript instead of
 * moving the caret. The composer owns its own keymap; this listener runs in
 * the bubble phase and skips an already-handled press, so a field or panel
 * that claims Home/End for itself keeps it.
 */
import { caretTargetOffset } from './line-boundary.ts'

/**
 * Input types that expose a text selection. The others (email, number, date
 * and friends) report a null selection and reject setSelectionRange, so the
 * gesture leaves them to the browser.
 */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'password'])

/** The focused field a press may address, or null. */
function textField(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (target instanceof HTMLTextAreaElement) return target.readOnly || target.disabled ? null : target
  if (!(target instanceof HTMLInputElement)) return null
  if (target.readOnly || target.disabled) return null
  return TEXT_INPUT_TYPES.has(target.type) ? target : null
}

/**
 * Apply one Home/End press to a text field.
 * @param field - the focused field.
 * @param event - the press being handled.
 */
function applyCaret(field: HTMLInputElement | HTMLTextAreaElement, event: KeyboardEvent): void {
  const start = field.selectionStart
  const end = field.selectionEnd
  /* v8 ignore next -- the filtered input types always expose a selection. */
  if (start === null || end === null) return
  const backward = field.selectionDirection === 'backward'
  const anchor = backward ? end : start
  const focus = backward ? start : end
  const target = caretTargetOffset(
    field.value,
    focus,
    event.key === 'Home' ? 'start' : 'end',
    event.ctrlKey || event.metaKey ? 'buffer' : 'line',
  )
  const from = event.shiftKey ? anchor : target
  field.setSelectionRange(
    Math.min(from, target),
    Math.max(from, target),
    target < from ? 'backward' : 'forward',
  )
  event.preventDefault()
}

/**
 * Install the document-level Home/End listener.
 * @param enabled - live preference read at press time, so toggling the
 * setting takes effect without re-arming the listener.
 * @returns the removal disposer.
 */
export function registerTextFieldHomeEnd(enabled: () => boolean): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.altKey) return
    if (event.key !== 'Home' && event.key !== 'End') return
    if (!enabled()) return
    const field = textField(event.target)
    if (field !== null) applyCaret(field, event)
  }
  document.addEventListener('keydown', onKeyDown)
  return () => { document.removeEventListener('keydown', onKeyDown) }
}
