/**
 * Shared validation, capture, and matching for the digest panel's durable
 * toggle shortcut: one chord of zero or more modifiers and one key, stored
 * as the canonical `[Ctrl+][Meta+][Alt+][Shift+]Key` string. The Host schema
 * validates the stored string with {@link TOGGLE_SHORTCUT_PATTERN}; the
 * settings page records with {@link recordToggleShortcut}; the sidebar entry
 * matches with {@link matchesToggleShortcut}.
 */

/** Canonical explicit chord accepted by {@link TOGGLE_SHORTCUT_PATTERN}. */
export type ToggleShortcut = string

/** JSON-compatible keyboard facts, so the recorder and matcher run without browser objects. */
export interface ToggleShortcutKeyEvent {
  key: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  isComposing?: boolean
  repeat?: boolean
}

/** Capture feedback shared by the settings recorder and validation tests. */
export type ToggleShortcutRecordResult =
  | { kind: 'accepted'; shortcut: ToggleShortcut }
  | { kind: 'ignored' }
  | { kind: 'invalid'; reason: 'reserved' | 'unsupported' }

/** The shipped chord. */
export const DEFAULT_TOGGLE_SHORTCUT: ToggleShortcut = 'Ctrl+1'

const MODIFIERS = ['Ctrl', 'Meta', 'Alt', 'Shift'] as const
const KEYS: readonly string[] = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), ...'0123456789'.split(''),
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
]

/** Keys whose bare or shifted press edits or leaves a field; never a toggle. */
const EDITING_KEYS = new Set(['Tab', 'Backspace', 'Delete', 'Enter', 'Space', 'Escape'])

/**
 * Letters the browser or an editable field owns under Ctrl or Meta without
 * Alt: clipboard, undo, select-all, find, tab and window control, and the
 * text-style toggles. The chord fires inside the composer, so these would
 * hijack editing rather than merely shadow a page shortcut.
 */
const OWNED_UNDER_COMMAND = new Set('ACFNPQRSTVWXZ'.split(''))

/** Serializable Host schema pattern; rejects noncanonical modifier order and unsupported keys. */
export const TOGGLE_SHORTCUT_PATTERN = new RegExp(
  `^(?:Ctrl\\+)?(?:Meta\\+)?(?:Alt\\+)?(?:Shift\\+)?(?:${KEYS.join('|')})$`,
  'u',
)

/**
 * Validate a persisted chord without normalizing it.
 * @param shortcut - the stored string.
 * @returns whether the Host and recorder accept the exact string.
 */
export function validateToggleShortcut(shortcut: string): boolean {
  return TOGGLE_SHORTCUT_PATTERN.test(shortcut) && !reserved(shortcut)
}

/**
 * Whether the chord carries Ctrl, Meta, or Alt. A chord without one is what
 * typing produces, so the sidebar entry keeps it silent inside editable
 * fields; a chord with one stays live everywhere.
 * @param shortcut - canonical chord.
 * @returns whether a command modifier is present.
 */
export function hasCommandModifier(shortcut: ToggleShortcut): boolean {
  return /^(?:Ctrl|Meta|Alt)\+/u.test(shortcut)
}

function reserved(shortcut: string): boolean {
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1] as string
  const modifiers = parts.slice(0, -1)
  return (modifiers.includes('Ctrl') || modifiers.includes('Meta')) && !modifiers.includes('Alt')
    && OWNED_UNDER_COMMAND.has(key)
}

/**
 * The key name of one event: the physical letter or digit when the layout
 * reports a code, so a layout that shifts the digit row still reaches the
 * chord, otherwise the produced key.
 */
function keyOf(event: ToggleShortcutKeyEvent): string {
  const physical = /^(?:Key|Digit)([A-Z0-9])$/u.exec(event.code ?? '')?.[1]
  if (physical !== undefined) return physical
  if (event.key === ' ') return 'Space'
  return /^[a-z]$/u.test(event.key) ? event.key.toUpperCase() : event.key
}

/**
 * The canonical chord one keydown spells, or `null` for a transient key
 * (a modifier alone, IME composition, key repeat).
 */
function chordOf(event: ToggleShortcutKeyEvent): { key: string; chord: string } | null {
  if (event.isComposing === true || event.repeat === true
    || ['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'Process', 'Dead', 'Unidentified'].includes(event.key)) return null
  const key = keyOf(event)
  const flags = [event.ctrlKey, event.metaKey, event.altKey, event.shiftKey]
  const modifiers = MODIFIERS.filter((_, index) => flags[index] === true)
  return { key, chord: [...modifiers, key].join('+') }
}

/**
 * Capture one keydown without browser objects or side effects.
 * @param event - keyboard facts; physical letter/digit codes override layout-produced characters.
 * @returns canonical accepted chord, ignored transient key, or a localized-feedback reason.
 */
export function recordToggleShortcut(event: ToggleShortcutKeyEvent): ToggleShortcutRecordResult {
  const spelled = chordOf(event)
  if (spelled === null) return { kind: 'ignored' }
  if (EDITING_KEYS.has(spelled.key)) return { kind: 'invalid', reason: 'reserved' }
  if (!KEYS.includes(spelled.key)) return { kind: 'invalid', reason: 'unsupported' }
  if (reserved(spelled.chord)) return { kind: 'invalid', reason: 'reserved' }
  return { kind: 'accepted', shortcut: spelled.chord }
}

/**
 * Match a keydown exactly, every modifier included; IME composition and key
 * repeat never match.
 * @param shortcut - accepted durable chord.
 * @param event - keyboard facts.
 * @returns whether this event is the chord.
 */
export function matchesToggleShortcut(shortcut: ToggleShortcut, event: ToggleShortcutKeyEvent): boolean {
  return chordOf(event)?.chord === shortcut
}
