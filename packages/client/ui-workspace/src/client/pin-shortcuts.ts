/**
 * Keyboard shortcuts for the sidebar pinned area: one chord per listed
 * position (the first ten rows), stored browser-locally as the canonical
 * `[Ctrl+][Meta+][Alt+][Shift+]Key` string and matched against this tab's
 * `keydown` events only. The recorder spells a chord from the pressed keys
 * ({@link spellPinShortcut}), the classifier names chords the browser or the
 * operating system owns so the user is warned before binding one
 * ({@link pinShortcutConflict}), and the formatter renders a chord in the
 * platform's own notation ({@link formatPinShortcut}).
 */

/** Canonical chord string; `null` in a binding list means the position has no key. */
export type PinShortcutChord = string

/** Positions the pinned area binds: the first ten listed rows. */
export const PIN_SHORTCUT_SLOTS = 10

/** The digit row, `1` through `9` then `0`, one per position. */
export const PIN_SHORTCUT_DIGIT_PRESET: readonly PinShortcutChord[] = '1234567890'.split('')

/** Platform whose browser and system shortcuts the classifier and the formatter speak for. */
export type PinShortcutPlatform = 'mac' | 'windows' | 'linux'

/** JSON-compatible keyboard facts, so spelling and matching run without browser objects. */
export interface PinShortcutKeyEvent {
  key: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  isComposing?: boolean
  repeat?: boolean
}

/** One recorded keydown: a bindable chord, a transient key to wait past, or a refused key. */
export type PinShortcutSpelling =
  | { kind: 'chord'; chord: PinShortcutChord }
  | { kind: 'transient' }
  | { kind: 'refused' }

/** Who else answers the chord: the browser's own bindings or the operating system's. */
export type PinShortcutOwner = 'browser' | 'system'

const MODIFIER_ORDER = ['Ctrl', 'Meta', 'Alt', 'Shift'] as const
type Modifier = typeof MODIFIER_ORDER[number]

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
const NAVIGATION = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']
const FUNCTION_KEYS = Array.from({ length: 12 }, (_, index) => `F${index + 1}`)
const BINDABLE_KEYS = new Set([...LETTERS.split(''), ...DIGITS.split(''), ...NAVIGATION, ...FUNCTION_KEYS])

/** Transient keys: modifiers alone and IME intermediates never spell a chord. */
const TRANSIENT_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'Process', 'Dead', 'Unidentified'])

/**
 * Detect the platform whose shortcut vocabulary applies. Reads the modern
 * `navigator.userAgentData.platform` and falls back to `navigator.platform`,
 * then the user agent.
 * @param navigatorLike - the navigator to inspect; absent outside a browser.
 * @returns the platform; anything neither Apple nor Windows reads as Linux.
 */
export function detectPinShortcutPlatform(navigatorLike?: {
  readonly platform?: string
  readonly userAgent?: string
  readonly userAgentData?: { readonly platform?: string }
}): PinShortcutPlatform {
  const platform = navigatorLike?.userAgentData?.platform ?? navigatorLike?.platform ?? navigatorLike?.userAgent ?? ''
  // Apple first: `Darwin` would otherwise read as Windows.
  if (/mac|iphone|ipad|ipod/iu.test(platform)) return 'mac'
  if (/win/iu.test(platform)) return 'windows'
  return 'linux'
}

/** The physical letter or digit when the layout reports one, else the produced key. */
function keyNameOf(event: PinShortcutKeyEvent): string {
  const physical = /^(?:Key|Digit)([A-Z0-9])$/u.exec(event.code ?? '')?.[1]
  if (physical !== undefined) return physical
  return event.key.length === 1 ? event.key.toUpperCase() : event.key
}

function modifiersOf(event: PinShortcutKeyEvent): Modifier[] {
  const held: Record<Modifier, boolean> = {
    Ctrl: event.ctrlKey === true, Meta: event.metaKey === true, Alt: event.altKey === true, Shift: event.shiftKey === true,
  }
  return MODIFIER_ORDER.filter(modifier => held[modifier])
}

/**
 * Spell the chord one keydown presses.
 * @param event - keyboard facts.
 * @returns the canonical chord, `transient` for a modifier alone, IME
 * composition, or key repeat, and `refused` for a key outside the bindable set.
 */
export function spellPinShortcut(event: PinShortcutKeyEvent): PinShortcutSpelling {
  if (event.isComposing === true || event.repeat === true || TRANSIENT_KEYS.has(event.key)) return { kind: 'transient' }
  const key = keyNameOf(event)
  if (!BINDABLE_KEYS.has(key)) return { kind: 'refused' }
  return { kind: 'chord', chord: [...modifiersOf(event), key].join('+') }
}

/**
 * Match one keydown against a chord, every modifier included.
 * @param chord - canonical chord.
 * @param event - keyboard facts.
 * @returns whether the event presses exactly this chord.
 */
export function matchesPinShortcut(chord: PinShortcutChord, event: PinShortcutKeyEvent): boolean {
  const spelled = spellPinShortcut(event)
  return spelled.kind === 'chord' && spelled.chord === chord
}

/**
 * Whether the chord carries Ctrl, Meta, or Alt. Without one, the chord is
 * what typing produces, so the listener keeps it silent inside editable
 * fields; with one it stays live everywhere.
 * @param chord - canonical chord.
 * @returns whether a command modifier is present.
 */
export function hasPinShortcutCommandModifier(chord: PinShortcutChord): boolean {
  return /^(?:Ctrl|Meta|Alt)\+/u.test(chord)
}

/**
 * Whether a key event originates in an editable control, where a chord
 * typing could spell must not fire.
 * @param target - the event target.
 * @returns true for inputs, text areas, selects, and contenteditable hosts.
 */
export function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.closest('[contenteditable]') !== null
}

function parseChord(chord: PinShortcutChord): { modifiers: Set<Modifier>; key: string } {
  const parts = chord.split('+')
  return { modifiers: new Set(parts.slice(0, -1) as Modifier[]), key: parts[parts.length - 1] as string }
}

/** Command-key chords the macOS browser answers with Option held: developer tools, source, and tab switching. */
const MAC_OPTION_COMMAND_KEYS = new Set(['I', 'J', 'U', 'F', 'B', 'C', 'ArrowLeft', 'ArrowRight'])
/** macOS application control the system answers under Command. */
const MAC_SYSTEM_COMMAND_KEYS = new Set(['Q', 'H', 'M'])
/**
 * Function keys the Windows and Linux browser answers bare: help, find,
 * reload, address bar, caret browsing, menu, fullscreen, and developer tools.
 */
const BROWSER_FUNCTION_KEYS = new Set(['F1', 'F3', 'F5', 'F6', 'F7', 'F10', 'F11', 'F12'])
/** Alt chords the Windows and Linux browser answers: history navigation, the address bar, and the menu. */
const ALT_BROWSER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'D', 'E', 'F'])
/** Ctrl+Alt chords a Linux desktop answers: terminal, lock, and workspace switching. */
const LINUX_CTRL_ALT_SYSTEM_KEYS = new Set(['T', 'L', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

function isLetter(key: string): boolean { return key.length === 1 && LETTERS.includes(key) }
function isDigit(key: string): boolean { return key.length === 1 && DIGITS.includes(key) }
function isFunctionKey(key: string): boolean { return /^F\d{1,2}$/u.test(key) }

function macConflict(modifiers: Set<Modifier>, key: string): PinShortcutOwner | null {
  if (modifiers.has('Meta')) {
    if (modifiers.has('Ctrl')) return 'system'
    if (MAC_SYSTEM_COMMAND_KEYS.has(key) && !modifiers.has('Alt')) return 'system'
    if (modifiers.has('Shift') && ['3', '4', '5'].includes(key)) return 'system'
    if (modifiers.has('Alt')) return MAC_OPTION_COMMAND_KEYS.has(key) ? 'browser' : null
    if (isLetter(key) || isDigit(key) || ARROWS.has(key)) return 'browser'
    return isFunctionKey(key) ? 'system' : null
  }
  if (modifiers.has('Ctrl')) {
    if (ARROWS.has(key)) return 'system'
    if (key === 'PageUp' || key === 'PageDown') return 'browser'
    return isFunctionKey(key) ? 'system' : null
  }
  return isFunctionKey(key) ? 'system' : null
}

function desktopConflict(platform: 'windows' | 'linux', modifiers: Set<Modifier>, key: string): PinShortcutOwner | null {
  if (modifiers.has('Meta')) return 'system'
  if (modifiers.has('Ctrl') && modifiers.has('Alt')) {
    if (platform === 'linux' && LINUX_CTRL_ALT_SYSTEM_KEYS.has(key)) return 'system'
    return ARROWS.has(key) ? 'system' : null
  }
  if (modifiers.has('Ctrl')) {
    if (isLetter(key) || isDigit(key)) return 'browser'
    if (key === 'PageUp' || key === 'PageDown' || key === 'F4' || key === 'F5') return 'browser'
    return null
  }
  if (modifiers.has('Alt')) {
    if (key === 'F4' || (platform === 'linux' && isFunctionKey(key))) return 'system'
    return ALT_BROWSER_KEYS.has(key) ? 'browser' : null
  }
  return BROWSER_FUNCTION_KEYS.has(key) ? 'browser' : null
}

/**
 * Name who else answers a chord on the platform, so the recorder can warn
 * before binding it: the browser may act on it before the page sees it, and
 * the operating system may consume it entirely.
 * @param chord - canonical chord.
 * @param platform - the platform whose shortcut vocabulary applies.
 * @returns the other owner, or `null` when the chord reaches the page unclaimed.
 */
export function pinShortcutConflict(chord: PinShortcutChord, platform: PinShortcutPlatform): PinShortcutOwner | null {
  const { modifiers, key } = parseChord(chord)
  return platform === 'mac' ? macConflict(modifiers, key) : desktopConflict(platform, modifiers, key)
}

/** Reading order of a displayed chord: the macOS convention, which the other platforms share here. */
const DISPLAY_MODIFIER_ORDER: readonly Modifier[] = ['Ctrl', 'Alt', 'Shift', 'Meta']
const MAC_GLYPHS: Record<Modifier, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }
const KEY_GLYPHS: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: 'PgUp', PageDown: 'PgDn',
}

/**
 * Render a chord in the platform's notation: glyphs run together on macOS
 * (`⌥⇧1`), `+`-joined names elsewhere (`Ctrl+Shift+1`, with `Win` or
 * `Super` for the Meta key).
 * @param chord - canonical chord.
 * @param platform - the platform whose notation applies.
 * @returns the label.
 */
export function formatPinShortcut(chord: PinShortcutChord, platform: PinShortcutPlatform): string {
  const { modifiers, key } = parseChord(chord)
  const held = DISPLAY_MODIFIER_ORDER.filter(modifier => modifiers.has(modifier))
  const keyLabel = KEY_GLYPHS[key] ?? key
  if (platform === 'mac') return [...held.map(modifier => MAC_GLYPHS[modifier]), keyLabel].join('')
  const meta = platform === 'windows' ? 'Win' : 'Super'
  return [...held.map(modifier => modifier === 'Meta' ? meta : modifier), keyLabel].join('+')
}

/**
 * Bind a chord to one position, releasing it from any other position so a
 * chord opens exactly one row.
 * @param bindings - the current list, one entry per position.
 * @param slot - zero-based position.
 * @param chord - the chord to bind, or `null` to clear the position.
 * @returns the new list.
 */
export function assignPinShortcut(
  bindings: readonly (PinShortcutChord | null)[], slot: number, chord: PinShortcutChord | null,
): (PinShortcutChord | null)[] {
  return bindings.map((current, index) => index === slot ? chord : current === chord ? null : current)
}
