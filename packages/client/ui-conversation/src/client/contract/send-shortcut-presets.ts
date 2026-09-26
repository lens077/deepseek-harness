/** Send-shortcut preset labels shared by the settings row and the composer chip. */

import type { SendShortcut } from '../../submission-settings.ts'
import type { ConversationKey } from '../locales.ts'

/** One offered send gesture and the dictionary key naming it. */
export interface SendShortcutPreset {
  id: SendShortcut
  label: ConversationKey
}

/** Offered presets, in the order both surfaces list them. */
export const SEND_SHORTCUT_PRESETS: readonly SendShortcutPreset[] = [
  { id: 'enter', label: 'settings.send.enter' },
  { id: 'mod-enter', label: 'settings.send.modEnter' },
  { id: 'Alt+Enter', label: 'settings.send.altEnter' },
  { id: 'Ctrl+Shift+Enter', label: 'settings.send.ctrlShiftEnter' },
  { id: 'Meta+Shift+Enter', label: 'settings.send.metaShiftEnter' },
]

/**
 * Render a recorded chord for display, naming the Meta key as Cmd.
 * @param shortcut - stored preset id or explicit `Modifier+Key` chord.
 * @returns the spaced display form.
 */
export function sendShortcutLabel(shortcut: string): string {
  return shortcut.split('+').map(key => key === 'Meta' ? 'Cmd' : key).join(' + ')
}

/**
 * Test whether a stored shortcut is one of the offered presets.
 * @param shortcut - stored preset id or explicit chord.
 * @returns whether a preset row already represents it.
 */
export function isSendShortcutPreset(shortcut: SendShortcut): boolean {
  return SEND_SHORTCUT_PRESETS.some(preset => preset.id === shortcut)
}
