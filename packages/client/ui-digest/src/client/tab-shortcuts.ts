/** Fixed tab navigation takes precedence over the configurable panel toggle. */
import { matchesToggleShortcut, type ToggleShortcutKeyEvent } from '../toggle-shortcut.ts'
import type { InboxTab } from './stores.ts'

/** Display order and Ctrl-digit order for the four digest views. */
export const DIGEST_TAB_KEYS: readonly InboxTab[] = ['inbox', 'todos', 'projects', 'timeline']

/** Canonical chords shared by dispatch and accessibility hints. */
export const TAB_SHORTCUTS: Readonly<Record<InboxTab, string>> = {
  inbox: 'Ctrl+1',
  todos: 'Ctrl+2',
  projects: 'Ctrl+3',
  timeline: 'Ctrl+4',
}

/**
 * Resolve an exact, non-repeating Ctrl-digit press to a digest view.
 * @param event - Keyboard facts, including physical digit codes and modifiers.
 * @returns The requested tab, or undefined for every other chord.
 */
export function digestTabShortcut(event: ToggleShortcutKeyEvent): InboxTab | undefined {
  return DIGEST_TAB_KEYS.find(tab => matchesToggleShortcut(TAB_SHORTCUTS[tab], event))
}
