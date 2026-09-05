/** Shared validation, capture, and matching for durable composer send shortcuts. */

/** Legacy presets or a canonical explicit modifier chord. */
export type SendShortcut = string

/** JSON-compatible keyboard facts; callers read AltGraph with getModifierState. */
export interface ShortcutKeyEvent {
  key: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  isComposing?: boolean
  repeat?: boolean
  altGraph?: boolean
  keyCode?: number
}

/** Capture feedback shared by the settings recorder and validation tests. */
export type SendShortcutRecordResult =
  | { kind: 'accepted'; shortcut: SendShortcut }
  | { kind: 'ignored' }
  | { kind: 'invalid'; reason: 'modifier' | 'reserved' | 'unsupported' }

const MODIFIERS = ['Ctrl', 'Meta', 'Alt', 'Shift'] as const
const KEYS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...'0123456789',
  'Enter', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown',
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
]
const EDITING_BROWSER_KEYS = new Set([...'ACVXZYRWTNLFPSOQHBIUK0', 'F4', 'F5', 'F6'])

function reserved(modifiers: readonly string[], key: string): boolean {
  if ((modifiers.includes('Ctrl') || modifiers.includes('Meta')) && !modifiers.includes('Alt')
    && EDITING_BROWSER_KEYS.has(key)) return true
  if (modifiers.includes('Alt') && ['F4', 'ArrowLeft', 'ArrowRight'].includes(key)) return true
  return key === 'Space' && (modifiers.includes('Meta') || modifiers.includes('Alt'))
}

const RESERVED_CHORDS = Array.from({ length: 15 }, (_, index) => {
  const modifiers = MODIFIERS.filter((_, bit) => ((index + 1) & (1 << bit)) !== 0)
  return KEYS.filter(key => reserved(modifiers, key)).map(key => [...modifiers, key].join('\\+'))
}).flat()

/** Serializable Host schema pattern; rejects noncanonical and reserved explicit chords. */
export const SEND_SHORTCUT_PATTERN = new RegExp(
  `^(?:enter|mod-enter|(?!(?:${RESERVED_CHORDS.join('|')})$)(?=(?:Ctrl|Meta|Alt)\\+)(?:Ctrl\\+)?(?:Meta\\+)?(?:Alt\\+)?(?:Shift\\+)?(?:${KEYS.join('|')}))$`,
  'u',
)

/**
 * Validate a persisted shortcut without normalizing ambiguous strings.
 * @param shortcut - legacy preset or explicit chord to validate.
 * @returns whether the Host and recorder accept the exact string.
 */
export function validateSendShortcut(shortcut: string): boolean {
  return SEND_SHORTCUT_PATTERN.test(shortcut)
}

function keyOf(event: ShortcutKeyEvent): string {
  const letter = /^Key([A-Z])$/u.exec(event.code ?? '')?.[1]
  if (letter !== undefined) return letter
  const digit = /^Digit([0-9])$/u.exec(event.code ?? '')?.[1]
  if (digit !== undefined) return digit
  if (event.key === ' ') return 'Space'
  return /^[a-z]$/u.test(event.key) ? event.key.toUpperCase() : event.key
}

/**
 * Capture one keydown without browser objects or side effects.
 * @param event - keyboard facts; physical letter/digit codes override layout-produced characters.
 * @returns canonical accepted chord, ignored transient key, or a localized-feedback reason.
 */
export function recordSendShortcut(event: ShortcutKeyEvent): SendShortcutRecordResult {
  if (event.isComposing === true || event.repeat === true || event.keyCode === 229
    || ['Control', 'Meta', 'Alt', 'Shift', 'Escape', 'Process', 'Dead', 'Unidentified'].includes(event.key)) {
    return { kind: 'ignored' }
  }
  if (event.altGraph === true || event.key === 'AltGraph') return { kind: 'invalid', reason: 'modifier' }
  const key = keyOf(event)
  if (['Tab', 'Backspace', 'Delete', '+', '-', '='].includes(key)) return { kind: 'invalid', reason: 'reserved' }
  if (!KEYS.includes(key)) return { kind: 'invalid', reason: 'unsupported' }
  const modifiers = MODIFIERS.filter((_, index) => [event.ctrlKey, event.metaKey, event.altKey, event.shiftKey][index] === true)
  if (!event.ctrlKey && !event.metaKey && !event.altKey) return { kind: 'invalid', reason: 'modifier' }
  if (reserved(modifiers, key)) return { kind: 'invalid', reason: 'reserved' }
  return { kind: 'accepted', shortcut: [...modifiers, key].join('+') }
}

/**
 * Match a keydown exactly; legacy presets retain their Ctrl-or-Cmd Enter behavior.
 * @param shortcut - accepted durable shortcut.
 * @param event - keyboard facts including IME, repeat, and AltGraph guards.
 * @returns whether this event sends under the selected shortcut.
 */
export function matchesSendShortcut(shortcut: SendShortcut, event: ShortcutKeyEvent): boolean {
  if (event.isComposing === true || event.repeat === true || event.keyCode === 229 || event.altGraph === true) return false
  if (shortcut === 'enter' || shortcut === 'mod-enter') {
    return event.key === 'Enter' && event.shiftKey !== true
      && (shortcut === 'enter' || event.ctrlKey === true || event.metaKey === true)
  }
  const recorded = recordSendShortcut(event)
  return recorded.kind === 'accepted' && recorded.shortcut === shortcut
}
