import { describe, expect, it } from 'vitest'
import { ConversationSettingsSchema, type ConversationSettings } from '../src/submission-settings.ts'
import {
  matchesSendShortcut, recordSendShortcut, validateSendShortcut,
  type ShortcutKeyEvent,
} from '../src/send-shortcut.ts'

const VALID = ['enter', 'mod-enter', 'Ctrl+Shift+Enter', 'Meta+Enter', 'Meta+Shift+Enter', 'Alt+Enter', 'Ctrl+Alt+S', 'Ctrl+Alt+Shift+1']

describe('send shortcut validation and recording', () => {
  // Boundary assertions keep unrelated fields absent so schema defaults are exercised.
  it.each(VALID)('accepts canonical shortcut %s in the Host schema', (shortcut) => {
    expect(validateSendShortcut(shortcut)).toBe(true)
    expect(ConversationSettingsSchema({ sendShortcut: shortcut } as ConversationSettings).sendShortcut).toBe(shortcut)
  })

  it.each([
    '', 'Enter', 'Shift+Enter', 'Shift+S', 'S', 'Cmd+Enter', 'ctrl+Enter', 'Alt+Ctrl+S',
    'Ctrl+Ctrl+Enter', 'Ctrl+Alt+Shift+Digit1', 'Ctrl+Tab', 'Alt+F4', 'Ctrl+A', 'Meta+C',
    'Ctrl+Shift+V', 'Meta+Shift+Z', 'Ctrl+R', 'Meta+W', 'Ctrl+T', 'Meta+N', 'Ctrl+L',
    'Meta+F', 'Ctrl+P', 'Ctrl+0', 'Ctrl++', 'Meta+-', 'Ctrl+Delete', 'Alt+ArrowLeft',
    'Alt+ArrowRight', 'Meta+Space', 'Alt+Space', 'Ctrl+F5', 'Ctrl+F13', 'Ctrl+Enter\n',
  ])('rejects ambiguous, reserved, or unsupported persisted shortcut %s', (shortcut) => {
    expect(validateSendShortcut(shortcut)).toBe(false)
    expect(() => ConversationSettingsSchema({ sendShortcut: shortcut } as ConversationSettings)).toThrow()
  })

  it.each([
    [{ key: 'Enter', ctrlKey: true, shiftKey: true }, 'Ctrl+Shift+Enter'],
    [{ key: 'Enter', metaKey: true }, 'Meta+Enter'],
    [{ key: 'Enter', altKey: true }, 'Alt+Enter'],
    [{ key: 'ß', code: 'KeyS', ctrlKey: true, altKey: true }, 'Ctrl+Alt+S'],
    [{ key: '¡', code: 'Digit1', altKey: true, shiftKey: true }, 'Alt+Shift+1'],
    [{ key: 's', altKey: true }, 'Alt+S'],
    [{ key: ' ', ctrlKey: true }, 'Ctrl+Space'],
    [{ key: 'ArrowUp', ctrlKey: true, altKey: true }, 'Ctrl+Alt+ArrowUp'],
    [{ key: 'F12', altKey: true }, 'Alt+F12'],
    [{ key: 'Home', ctrlKey: true, metaKey: true, altKey: true, shiftKey: true }, 'Ctrl+Meta+Alt+Shift+Home'],
  ] satisfies [ShortcutKeyEvent, string][])('records physical key facts as a canonical chord', (event, shortcut) => {
    expect(recordSendShortcut(event)).toEqual({ kind: 'accepted', shortcut })
    expect(validateSendShortcut(shortcut)).toBe(true)
    expect(matchesSendShortcut(shortcut, event)).toBe(true)
  })

  it.each([
    { key: 'Enter', isComposing: true, ctrlKey: true },
    { key: 's', keyCode: 229, ctrlKey: true, altKey: true },
    { key: 'Enter', repeat: true, metaKey: true },
    { key: 'Control' }, { key: 'Meta' }, { key: 'Alt' }, { key: 'Shift' },
    { key: 'Escape' }, { key: 'Dead', code: 'KeyE', altKey: true }, { key: 'Process' },
  ])('ignores transient capture keys', (event) => {
    expect(recordSendShortcut(event)).toEqual({ kind: 'ignored' })
  })

  it.each([
    [{ key: 'Enter' }, 'modifier'],
    [{ key: 'Enter', shiftKey: true }, 'modifier'],
    [{ key: 's', code: 'KeyS', ctrlKey: true, altKey: true, altGraph: true }, 'modifier'],
    [{ key: 'AltGraph' }, 'modifier'],
    [{ key: 'Tab', ctrlKey: true }, 'reserved'],
    [{ key: 'a', ctrlKey: true }, 'reserved'],
    [{ key: 'Enter', shiftKey: true }, 'modifier'],
    [{ key: 'F4', altKey: true }, 'reserved'],
    [{ key: 'F13', altKey: true }, 'unsupported'],
    [{ key: 'AudioVolumeUp', ctrlKey: true }, 'unsupported'],
  ] satisfies [ShortcutKeyEvent, string][])('reports actionable capture failures', (event, reason) => {
    expect(recordSendShortcut(event)).toEqual({ kind: 'invalid', reason })
  })
})

describe('send shortcut matching', () => {
  it('retains the default and modifier presets without accepting shifted Enter', () => {
    expect(matchesSendShortcut('enter', { key: 'Enter' })).toBe(true)
    expect(matchesSendShortcut('mod-enter', { key: 'Enter' })).toBe(false)
    for (const modifier of ['ctrlKey', 'metaKey']) {
      expect(matchesSendShortcut('enter', { key: 'Enter', [modifier]: true })).toBe(true)
      expect(matchesSendShortcut('mod-enter', { key: 'Enter', [modifier]: true })).toBe(true)
      expect(matchesSendShortcut('mod-enter', { key: 'Enter', [modifier]: true, shiftKey: true })).toBe(false)
    }
  })

  it('requires every custom modifier and rejects extra modifiers', () => {
    const shortcut = 'Ctrl+Alt+S'
    expect(matchesSendShortcut(shortcut, { key: 's', ctrlKey: true, altKey: true })).toBe(true)
    expect(matchesSendShortcut(shortcut, { key: 's', metaKey: true, altKey: true })).toBe(false)
    expect(matchesSendShortcut(shortcut, { key: 's', ctrlKey: true })).toBe(false)
    expect(matchesSendShortcut(shortcut, { key: 's', ctrlKey: true, altKey: true, shiftKey: true })).toBe(false)
    expect(matchesSendShortcut(shortcut, { key: 'Enter', ctrlKey: true })).toBe(false)
  })

  it.each(['isComposing', 'repeat', 'altGraph'] as const)('rejects %s for presets and custom chords', (flag) => {
    for (const shortcut of ['enter', 'mod-enter', 'Ctrl+Enter']) {
      expect(matchesSendShortcut(shortcut, { key: 'Enter', ctrlKey: true, [flag]: true })).toBe(false)
    }
  })
})
