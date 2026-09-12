/**
 * Whether a key event originates in an editable control, where a chord that
 * typing could spell must not fire: the panel's single-letter triage ring and
 * a modifierless toggle chord both stay silent there.
 * @param target - the event target.
 * @returns true for inputs, text areas, selects, and contenteditable hosts.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.closest('[contenteditable]') !== null
}
