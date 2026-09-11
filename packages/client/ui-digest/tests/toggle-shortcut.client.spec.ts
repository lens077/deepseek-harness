/**
 * The toggle chord library: the Host pattern, the recorder's accept/ignore/
 * refuse arms, the exact matcher, and the command-modifier test the sidebar
 * entry uses to decide whether a chord stays live inside text fields.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOGGLE_SHORTCUT, TOGGLE_SHORTCUT_PATTERN, hasCommandModifier, matchesToggleShortcut,
  recordToggleShortcut, validateToggleShortcut,
} from '../src/toggle-shortcut.ts'

describe('toggle shortcut', () => {
  it('accepts canonical chords with zero or more modifiers and rejects the rest', () => {
    for (const ok of [DEFAULT_TOGGLE_SHORTCUT, 'F2', 'Q', 'Ctrl+Meta+Alt+Shift+F12', 'Alt+ArrowDown', 'Shift+Home', 'Meta+PageUp']) {
      expect(TOGGLE_SHORTCUT_PATTERN.test(ok), ok).toBe(true)
      expect(validateToggleShortcut(ok), ok).toBe(true)
    }
    for (const bad of ['', 'Shift+Ctrl+1', 'ctrl+1', 'Ctrl+', 'Ctrl+Escape', 'Ctrl+Enter', 'Ctrl+Tab', 'Ctrl+;', 'Ctrl++', 'Ctrl+1+2']) {
      expect(TOGGLE_SHORTCUT_PATTERN.test(bad), bad).toBe(false)
      expect(validateToggleShortcut(bad), bad).toBe(false)
    }
    // Chords the pattern spells but editing or the browser owns fail the full validation.
    for (const owned of ['Ctrl+C', 'Meta+V', 'Ctrl+Shift+T', 'Meta+Q']) {
      expect(TOGGLE_SHORTCUT_PATTERN.test(owned), owned).toBe(true)
      expect(validateToggleShortcut(owned), owned).toBe(false)
    }
    // Alt releases the letter from the browser's claim.
    expect(validateToggleShortcut('Ctrl+Alt+C')).toBe(true)
  })

  it('records a press in canonical form, preferring the physical letter or digit', () => {
    expect(recordToggleShortcut({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true })).toEqual({ kind: 'accepted', shortcut: 'Ctrl+Shift+1' })
    expect(recordToggleShortcut({ key: 'i', code: 'KeyI', altKey: true, metaKey: true })).toEqual({ kind: 'accepted', shortcut: 'Meta+Alt+I' })
    expect(recordToggleShortcut({ key: 'q' })).toEqual({ kind: 'accepted', shortcut: 'Q' })
    expect(recordToggleShortcut({ key: 'F2', code: 'F2' })).toEqual({ kind: 'accepted', shortcut: 'F2' })
    expect(recordToggleShortcut({ key: 'ArrowUp', ctrlKey: true })).toEqual({ kind: 'accepted', shortcut: 'Ctrl+ArrowUp' })
  })

  it('ignores transient presses and refuses editing, owned, and unsupported keys', () => {
    for (const key of ['Control', 'Meta', 'Alt', 'Shift', 'AltGraph', 'Process', 'Dead', 'Unidentified']) {
      expect(recordToggleShortcut({ key }), key).toEqual({ kind: 'ignored' })
    }
    expect(recordToggleShortcut({ key: 'a', isComposing: true })).toEqual({ kind: 'ignored' })
    expect(recordToggleShortcut({ key: 'a', repeat: true })).toEqual({ kind: 'ignored' })
    for (const key of ['Tab', 'Backspace', 'Delete', 'Enter', ' ', 'Escape']) {
      expect(recordToggleShortcut({ key, ctrlKey: true }), key).toEqual({ kind: 'invalid', reason: 'reserved' })
    }
    expect(recordToggleShortcut({ key: 'c', code: 'KeyC', ctrlKey: true })).toEqual({ kind: 'invalid', reason: 'reserved' })
    expect(recordToggleShortcut({ key: 'w', code: 'KeyW', metaKey: true })).toEqual({ kind: 'invalid', reason: 'reserved' })
    expect(recordToggleShortcut({ key: ';', code: 'Semicolon' })).toEqual({ kind: 'invalid', reason: 'unsupported' })
    expect(recordToggleShortcut({ key: 'Insert', ctrlKey: true })).toEqual({ kind: 'invalid', reason: 'unsupported' })
  })

  it('matches every modifier exactly and never a repeat or a composing press', () => {
    expect(matchesToggleShortcut('Ctrl+1', { key: '1', code: 'Digit1', ctrlKey: true })).toBe(true)
    expect(matchesToggleShortcut('Ctrl+1', { key: '1', ctrlKey: true })).toBe(true)
    expect(matchesToggleShortcut('Ctrl+1', { key: '1', code: 'Digit1', ctrlKey: true, shiftKey: true })).toBe(false)
    expect(matchesToggleShortcut('Ctrl+1', { key: '1', code: 'Digit1', metaKey: true })).toBe(false)
    expect(matchesToggleShortcut('Ctrl+1', { key: '1', code: 'Digit1', ctrlKey: true, repeat: true })).toBe(false)
    expect(matchesToggleShortcut('F2', { key: 'F2' })).toBe(true)
    expect(matchesToggleShortcut('F2', { key: 'F2', isComposing: true })).toBe(false)
    expect(matchesToggleShortcut('Q', { key: 'Control', ctrlKey: true })).toBe(false)
  })

  it('tells a chord that stays live in text fields from one typing could spell', () => {
    expect(hasCommandModifier('Ctrl+1')).toBe(true)
    expect(hasCommandModifier('Meta+Shift+I')).toBe(true)
    expect(hasCommandModifier('Alt+Q')).toBe(true)
    expect(hasCommandModifier('Shift+F2')).toBe(false)
    expect(hasCommandModifier('F2')).toBe(false)
  })
})
