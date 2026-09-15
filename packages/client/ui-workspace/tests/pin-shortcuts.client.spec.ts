// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  PIN_SHORTCUT_DIGIT_PRESET, PIN_SHORTCUT_SLOTS, assignPinShortcut, detectPinShortcutPlatform, formatPinShortcut,
  hasPinShortcutCommandModifier, isEditableKeyTarget, matchesPinShortcut, pinShortcutConflict, spellPinShortcut,
} from '../src/client/pin-shortcuts.ts'

describe('detectPinShortcutPlatform', () => {
  it('reads userAgentData first, then platform, then the user agent, and defaults to Linux', () => {
    expect(detectPinShortcutPlatform({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe('mac')
    expect(detectPinShortcutPlatform({ platform: 'MacIntel' })).toBe('mac')
    expect(detectPinShortcutPlatform({ platform: 'iPhone' })).toBe('mac')
    expect(detectPinShortcutPlatform({ platform: 'Win32' })).toBe('windows')
    expect(detectPinShortcutPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })).toBe('windows')
    expect(detectPinShortcutPlatform({ platform: 'Linux x86_64' })).toBe('linux')
    expect(detectPinShortcutPlatform({})).toBe('linux')
    expect(detectPinShortcutPlatform()).toBe('linux')
  })
})

describe('spellPinShortcut', () => {
  it('spells modifiers in canonical order around the physical letter or digit', () => {
    expect(spellPinShortcut({ key: '1', code: 'Digit1' })).toEqual({ kind: 'chord', chord: '1' })
    expect(spellPinShortcut({ key: '!', code: 'Digit1', shiftKey: true })).toEqual({ kind: 'chord', chord: 'Shift+1' })
    expect(spellPinShortcut({ key: 'a', code: 'KeyA', ctrlKey: true, altKey: true, metaKey: true, shiftKey: true }))
      .toEqual({ kind: 'chord', chord: 'Ctrl+Meta+Alt+Shift+A' })
    // Without a physical code the produced character is upper-cased; named keys pass through.
    expect(spellPinShortcut({ key: 'b' })).toEqual({ kind: 'chord', chord: 'B' })
    expect(spellPinShortcut({ key: '7', code: 'Numpad7' })).toEqual({ kind: 'chord', chord: '7' })
    expect(spellPinShortcut({ key: 'F5' })).toEqual({ kind: 'chord', chord: 'F5' })
    expect(spellPinShortcut({ key: 'ArrowLeft', altKey: true })).toEqual({ kind: 'chord', chord: 'Alt+ArrowLeft' })
  })

  it('waits past modifiers alone, composition, and repeat, and refuses keys outside the bindable set', () => {
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'Process', 'Dead', 'Unidentified']) {
      expect(spellPinShortcut({ key })).toEqual({ kind: 'transient' })
    }
    expect(spellPinShortcut({ key: '1', isComposing: true })).toEqual({ kind: 'transient' })
    expect(spellPinShortcut({ key: '1', repeat: true })).toEqual({ kind: 'transient' })
    for (const key of ['Tab', 'Enter', 'Escape', ' ', 'Backspace', 'Delete', '-', 'F13', '中']) {
      expect(spellPinShortcut({ key })).toEqual({ kind: 'refused' })
    }
  })
})

describe('matchesPinShortcut / hasPinShortcutCommandModifier', () => {
  it('matches exactly, every modifier included, never on repeat', () => {
    expect(matchesPinShortcut('1', { key: '1', code: 'Digit1' })).toBe(true)
    expect(matchesPinShortcut('1', { key: '1', code: 'Digit1', ctrlKey: true })).toBe(false)
    expect(matchesPinShortcut('Alt+1', { key: '¡', code: 'Digit1', altKey: true })).toBe(true)
    expect(matchesPinShortcut('Alt+1', { key: '1', code: 'Digit1', altKey: true, repeat: true })).toBe(false)
    expect(matchesPinShortcut('1', { key: 'Shift' })).toBe(false)
  })

  it('names the chords that stay live inside editable fields', () => {
    expect(hasPinShortcutCommandModifier('1')).toBe(false)
    expect(hasPinShortcutCommandModifier('Shift+1')).toBe(false)
    expect(hasPinShortcutCommandModifier('Ctrl+1')).toBe(true)
    expect(hasPinShortcutCommandModifier('Meta+1')).toBe(true)
    expect(hasPinShortcutCommandModifier('Alt+Shift+1')).toBe(true)
  })
})

describe('isEditableKeyTarget', () => {
  it('is true for inputs, text areas, selects, and contenteditable hosts only', () => {
    const host = document.createElement('div')
    host.setAttribute('contenteditable', 'true')
    const inner = document.createElement('span')
    host.append(inner)
    for (const tag of ['input', 'textarea', 'select']) expect(isEditableKeyTarget(document.createElement(tag))).toBe(true)
    expect(isEditableKeyTarget(inner)).toBe(true)
    expect(isEditableKeyTarget(document.createElement('button'))).toBe(false)
    expect(isEditableKeyTarget(null)).toBe(false)
    expect(isEditableKeyTarget(document)).toBe(false)
  })
})

describe('pinShortcutConflict', () => {
  it('names macOS browser and system chords', () => {
    const on = (chord: string) => pinShortcutConflict(chord, 'mac')
    expect(on('1')).toBeNull()
    expect(on('Alt+1')).toBeNull()
    expect(on('Ctrl+1')).toBeNull()
    expect(on('Meta+1')).toBe('browser')
    expect(on('Meta+T')).toBe('browser')
    expect(on('Meta+Shift+T')).toBe('browser')
    expect(on('Meta+ArrowLeft')).toBe('browser')
    expect(on('Meta+Alt+I')).toBe('browser')
    expect(on('Meta+Alt+1')).toBeNull()
    expect(on('Meta+Home')).toBeNull()
    expect(on('Meta+Q')).toBe('system')
    expect(on('Meta+Shift+4')).toBe('system')
    expect(on('Meta+Shift+1')).toBe('browser')
    expect(on('Ctrl+Meta+F')).toBe('system')
    expect(on('Meta+F5')).toBe('system')
    expect(on('Ctrl+ArrowLeft')).toBe('system')
    expect(on('Ctrl+PageDown')).toBe('browser')
    expect(on('Ctrl+F3')).toBe('system')
    expect(on('Ctrl+Home')).toBeNull()
    expect(on('F11')).toBe('system')
    expect(on('Shift+End')).toBeNull()
  })

  it('names Windows and Linux browser and system chords', () => {
    const win = (chord: string) => pinShortcutConflict(chord, 'windows')
    const linux = (chord: string) => pinShortcutConflict(chord, 'linux')
    expect(win('1')).toBeNull()
    expect(win('Meta+1')).toBe('system')
    expect(win('Ctrl+1')).toBe('browser')
    expect(win('Ctrl+Shift+T')).toBe('browser')
    expect(win('Ctrl+PageUp')).toBe('browser')
    expect(win('Ctrl+F5')).toBe('browser')
    expect(win('Ctrl+ArrowLeft')).toBeNull()
    expect(win('Ctrl+Alt+ArrowUp')).toBe('system')
    expect(win('Ctrl+Alt+T')).toBeNull()
    expect(linux('Ctrl+Alt+T')).toBe('system')
    expect(linux('Ctrl+Alt+E')).toBeNull()
    expect(win('Alt+F4')).toBe('system')
    expect(win('Alt+F1')).toBeNull()
    expect(linux('Alt+F1')).toBe('system')
    expect(win('Alt+ArrowLeft')).toBe('browser')
    expect(win('Alt+1')).toBeNull()
    expect(win('F5')).toBe('browser')
    expect(win('F2')).toBeNull()
    // Shift keeps the browser's function keys (Shift+F5 reloads past the cache).
    expect(win('Shift+F5')).toBe('browser')
    expect(win('Shift+F2')).toBeNull()
  })
})

describe('formatPinShortcut', () => {
  it('runs glyphs together on macOS and joins names elsewhere, naming the Meta key per platform', () => {
    expect(formatPinShortcut('Ctrl+Meta+Alt+Shift+1', 'mac')).toBe('⌃⌥⇧⌘1')
    expect(formatPinShortcut('Alt+ArrowUp', 'mac')).toBe('⌥↑')
    expect(formatPinShortcut('PageDown', 'mac')).toBe('PgDn')
    expect(formatPinShortcut('Ctrl+Shift+1', 'windows')).toBe('Ctrl+Shift+1')
    expect(formatPinShortcut('Meta+F2', 'windows')).toBe('Win+F2')
    expect(formatPinShortcut('Meta+ArrowRight', 'linux')).toBe('Super+→')
  })
})

describe('assignPinShortcut', () => {
  it('binds one position and releases the chord from any other, or clears a position', () => {
    const preset = [...PIN_SHORTCUT_DIGIT_PRESET]
    expect(preset).toHaveLength(PIN_SHORTCUT_SLOTS)
    expect(assignPinShortcut(preset, 2, 'Alt+3')).toEqual(['1', '2', 'Alt+3', '4', '5', '6', '7', '8', '9', '0'])
    expect(assignPinShortcut(preset, 0, '5')).toEqual(['5', '2', '3', '4', null, '6', '7', '8', '9', '0'])
    expect(assignPinShortcut(preset, 9, null)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', null])
    // Clearing never releases other positions: several may be empty at once.
    expect(assignPinShortcut([null, null, '3'], 2, null)).toEqual([null, null, null])
  })
})
