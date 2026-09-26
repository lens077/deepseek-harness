// @vitest-environment jsdom
/**
 * Home/End caret motion: the pure line boundaries, the composer's
 * EditorState-level motion, the keymap gesture that drives it, and the
 * document listener that gives the GUI's other text fields the same gesture.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  bindSnapshotSelector, makeTranslate, stubSettingsScope,
} from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { createHeadlessEditor } from '@lexical/headless'
import { registerPlainText } from '@lexical/plain-text'
import { createEditor, type LexicalEditor, type NodeKey } from 'lexical'
import {
  $createLineBreakNode, $createParagraphNode, $createRangeSelection, $createTextNode, $getRoot,
  $setSelection,
} from 'lexical'
import {
  caretTargetOffset, lineEndOffset, lineStartOffset,
} from '../src/client/input/line-boundary.ts'
import { $moveComposerCaret } from '../src/client/input/editor/caret-motion.ts'
import { $selectDetectPoints, $selectDetectSpan } from '../src/client/input/editor/span-map.ts'
import { $projectComposer } from '../src/client/input/editor/projection.ts'
import { registerComposerKeymap } from '../src/client/input/editor/keymap.ts'
import { registerTextFieldHomeEnd } from '../src/client/input/text-field-home-end.ts'
import { ReferenceChipNode } from '../src/client/input/editor/chip-node.tsx'
import { HomeEndCaretPolicy } from '../src/client/settings/home-end-caret-policy.ts'
import { HomeEndCaretRow } from '../src/client/settings/HomeEndCaretRow.tsx'
import type { HomeEndCaretRowProps } from '../src/client/settings/HomeEndCaretRow.tsx'
import { en } from '../src/client/locales.ts'
import {
  ConversationSettingsSchema, DEFAULT_HOME_END_CARET, type ConversationSettings,
} from '../src/submission-settings.ts'

const useResource = (() => ({
  status: 'none' as const, value: undefined, failure: undefined, reload: () => {},
})) as GlobalStandardProps['useResource']

const SETTINGS: ConversationSettings = {
  busyEnter: 'queue',
  sendShortcut: 'enter',
  contentWidth: 'fill',
  homeEndInTextFields: true,
  questionNavigation: {
    previousShortcut: 'Ctrl+ArrowUp',
    nextShortcut: 'Ctrl+ArrowDown',
    focusPolicy: 'editable',
    expandButtonSide: 'right',
  },
}

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [],
    byId: {},
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  }))
}

function noPendingInteraction() {
  return bindSnapshotSelector(createSnapshotStore<SessionPendingInteractionSnapshot>(new Map()))
}

afterEach(() => {
  cleanup()
})

/** Ids per NodeKey the way the shell assigns them. */
function idAssigner(): (key: NodeKey) => number {
  const ids = new Map<NodeKey, number>()
  let seq = 0
  return (key) => {
    const existing = ids.get(key)
    if (existing !== undefined) return existing
    seq += 1
    ids.set(key, seq)
    return seq
  }
}

/** One paragraph holding `alpha`, a line break, then `beta` (detect: alpha\nbeta). */
function seedTwoLines(): LexicalEditor {
  const editor = createHeadlessEditor({
    namespace: 'home-end-spec',
    nodes: [ReferenceChipNode],
    onError: (error) => { throw error },
  })
  editor.update(() => {
    const p = $createParagraphNode()
    p.append($createTextNode('alpha'), $createLineBreakNode(), $createTextNode('beta'))
    $getRoot().append(p)
  }, { discrete: true })
  return editor
}

/** Apply one gesture from a caret (or range) and read back the selection. */
function gesture(
  editor: LexicalEditor,
  from: { start: number; end: number },
  ...args: Parameters<typeof $moveComposerCaret>
): { moved: boolean; selection: { start: number; end: number } | null } {
  let moved = false
  editor.update(() => {
    $selectDetectSpan(from)
    moved = $moveComposerCaret(...args)
  }, { discrete: true })
  let selection: { start: number; end: number } | null = null
  editor.read(() => { selection = $projectComposer(idAssigner()).selection })
  return { moved, selection }
}

describe('line boundaries', () => {
  it('reads the logical line around an offset', () => {
    const text = 'alpha\nbeta\n'
    expect(lineStartOffset(text, 0)).toBe(0)
    expect(lineStartOffset(text, 3)).toBe(0)
    expect(lineStartOffset(text, 7)).toBe(6)
    expect(lineEndOffset(text, 3)).toBe(5)
    expect(lineEndOffset(text, 7)).toBe(10)
    expect(lineEndOffset('alpha', 2)).toBe(5)
  })

  it('keeps Home at the start of an empty first line', () => {
    expect(lineStartOffset('\ntext', 0)).toBe(0)
    expect(caretTargetOffset('\ntext', 0, 'start', 'line')).toBe(0)
  })

  it('folds a gesture to its target offset', () => {
    const text = 'alpha\nbeta'
    expect(caretTargetOffset(text, 7, 'start', 'line')).toBe(6)
    expect(caretTargetOffset(text, 7, 'end', 'line')).toBe(10)
    expect(caretTargetOffset(text, 7, 'start', 'buffer')).toBe(0)
    expect(caretTargetOffset(text, 7, 'end', 'buffer')).toBe(10)
  })
})

describe('composer caret motion', () => {
  it('moves the caret to the line edges of the caret line', () => {
    const editor = seedTwoLines()
    expect(gesture(editor, { start: 7, end: 7 }, 'start', 'line', 'move'))
      .toEqual({ moved: true, selection: { start: 6, end: 6 } })
    expect(gesture(editor, { start: 7, end: 7 }, 'end', 'line', 'move'))
      .toEqual({ moved: true, selection: { start: 10, end: 10 } })
    expect(gesture(editor, { start: 2, end: 2 }, 'end', 'line', 'move'))
      .toEqual({ moved: true, selection: { start: 5, end: 5 } })
  })

  it('reaches the whole draft under the buffer scope', () => {
    const editor = seedTwoLines()
    expect(gesture(editor, { start: 7, end: 7 }, 'start', 'buffer', 'move'))
      .toEqual({ moved: true, selection: { start: 0, end: 0 } })
    expect(gesture(editor, { start: 2, end: 2 }, 'end', 'buffer', 'move'))
      .toEqual({ moved: true, selection: { start: 10, end: 10 } })
  })

  it('extends the selection from its fixed end', () => {
    const editor = seedTwoLines()
    expect(gesture(editor, { start: 7, end: 7 }, 'start', 'line', 'extend'))
      .toEqual({ moved: true, selection: { start: 6, end: 7 } })
    expect(gesture(editor, { start: 7, end: 9 }, 'end', 'buffer', 'extend'))
      .toEqual({ moved: true, selection: { start: 7, end: 10 } })
  })

  it('leaves the keystroke alone without a range selection', () => {
    const editor = seedTwoLines()
    let moved = true
    editor.update(() => {
      $setSelection(null)
      moved = $moveComposerCaret('start', 'line', 'move')
    }, { discrete: true })
    expect(moved).toBe(false)
  })

  it('leaves the keystroke alone when the selection points outside the layout', () => {
    const editor = seedTwoLines()
    let moved = true
    editor.update(() => {
      // A node outside the document walk: the layout has no offset for it.
      const orphan = $createTextNode('orphan')
      const stale = $createRangeSelection()
      stale.anchor.set(orphan.getKey(), 0, 'text')
      stale.focus.set(orphan.getKey(), 0, 'text')
      $setSelection(stale)
      moved = $moveComposerCaret('start', 'line', 'move')
      $setSelection(null)
    }, { discrete: true })
    expect(moved).toBe(false)
  })

  it('refuses detect offsets outside the document', () => {
    const editor = seedTwoLines()
    let mapped = true
    editor.update(() => { mapped = $selectDetectPoints(0, 99) }, { discrete: true })
    expect(mapped).toBe(false)
  })
})

describe('composer keymap Home/End', () => {
  function mount(resolveGesture: (event: { key: string }) => 'enter' | null = () => null) {
    const editor = createEditor({ namespace: 'home-end-keymap', onError: (e) => { throw e } })
    const root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.appendChild(root)
    editor.setRootElement(root)
    registerPlainText(editor)
    const submit = vi.fn()
    registerComposerKeymap(editor, {
      arbitrate: () => 'pass',
      space: () => false,
      dismissPopup: () => {},
      resolveGesture,
      canSubmit: () => true,
      submit,
      intakeFiles: () => {},
      pasteText: () => {},
    })
    editor.update(() => {
      const p = $createParagraphNode()
      p.append($createTextNode('alpha'), $createLineBreakNode(), $createTextNode('beta'))
      $getRoot().append(p)
    }, { discrete: true })
    const caret = (): { start: number; end: number } | null => {
      let selection: { start: number; end: number } | null = null
      editor.read(() => { selection = $projectComposer(idAssigner()).selection })
      return selection
    }
    const place = (offset: number): void => {
      editor.update(() => { $selectDetectSpan({ start: offset, end: offset }) }, { discrete: true })
    }
    return { editor, root, submit, caret, place }
  }

  it('claims Home and End for the caret instead of the page', () => {
    const { root, caret, place } = mount()
    place(7)
    expect(fireEvent.keyDown(root, { key: 'Home' })).toBe(false) // preventDefault fired
    expect(caret()).toEqual({ start: 6, end: 6 })
    expect(fireEvent.keyDown(root, { key: 'End' })).toBe(false)
    expect(caret()).toEqual({ start: 10, end: 10 })
  })

  it('widens to the draft with Ctrl/Meta and extends with Shift', () => {
    const { root, caret, place } = mount()
    place(7)
    fireEvent.keyDown(root, { key: 'Home', metaKey: true })
    expect(caret()).toEqual({ start: 0, end: 0 })
    place(7)
    fireEvent.keyDown(root, { key: 'End', ctrlKey: true, shiftKey: true })
    expect(caret()).toEqual({ start: 7, end: 10 })
  })

  it('passes Alt+Home through to the browser', () => {
    const { root, caret, place } = mount()
    place(7)
    expect(fireEvent.keyDown(root, { key: 'Home', altKey: true })).toBe(true)
    expect(caret()).toEqual({ start: 7, end: 7 })
  })

  it('passes keys that are neither Home nor End', () => {
    const { root, caret, place } = mount()
    place(7)
    expect(fireEvent.keyDown(root, { key: 'F5' })).toBe(true)
    expect(caret()).toEqual({ start: 7, end: 7 })
  })

  it('passes the press on when the editor holds no caret', () => {
    const { editor, root } = mount()
    editor.update(() => { $setSelection(null) }, { discrete: true })
    expect(fireEvent.keyDown(root, { key: 'End' })).toBe(true)
  })

  it('yields to a send shortcut bound to the same key', () => {
    const { root, submit, caret, place } = mount(event => event.key === 'End' ? 'enter' : null)
    place(7)
    fireEvent.keyDown(root, { key: 'End' })
    expect(submit).toHaveBeenCalledWith('enter')
    expect(caret()).toEqual({ start: 7, end: 7 })
  })
})

describe('text-field Home/End listener', () => {
  function field(value: string, attrs: Partial<HTMLInputElement> = {}): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'text'
    input.value = value
    Object.assign(input, attrs)
    document.body.appendChild(input)
    return input
  }

  it('moves the caret to the line edges of a textarea', () => {
    const dispose = registerTextFieldHomeEnd(() => true)
    const area = document.createElement('textarea')
    area.value = 'alpha\nbeta'
    document.body.appendChild(area)
    area.setSelectionRange(7, 7)
    expect(fireEvent.keyDown(area, { key: 'Home' })).toBe(false)
    expect([area.selectionStart, area.selectionEnd]).toEqual([6, 6])
    fireEvent.keyDown(area, { key: 'End' })
    expect([area.selectionStart, area.selectionEnd]).toEqual([10, 10])
    fireEvent.keyDown(area, { key: 'Home', ctrlKey: true })
    expect([area.selectionStart, area.selectionEnd]).toEqual([0, 0])
    fireEvent.keyDown(area, { key: 'End', metaKey: true })
    expect([area.selectionStart, area.selectionEnd]).toEqual([10, 10])
    dispose()
    area.remove()
  })

  it('extends the selection and keeps its direction', () => {
    const dispose = registerTextFieldHomeEnd(() => true)
    const input = field('alpha beta')
    input.setSelectionRange(4, 4)
    fireEvent.keyDown(input, { key: 'End', shiftKey: true })
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([4, 10, 'forward'])
    fireEvent.keyDown(input, { key: 'Home', shiftKey: true })
    expect([input.selectionStart, input.selectionEnd, input.selectionDirection]).toEqual([0, 4, 'backward'])
    // The fixed end stays put while the moving end walks back out.
    fireEvent.keyDown(input, { key: 'End', shiftKey: true })
    expect([input.selectionStart, input.selectionEnd]).toEqual([4, 10])
    dispose()
    input.remove()
  })

  it('stands aside for the preference, other keys, Alt, and handled presses', () => {
    const enabled = { value: false }
    const dispose = registerTextFieldHomeEnd(() => enabled.value)
    const input = field('alpha beta')
    input.setSelectionRange(4, 4)
    fireEvent.keyDown(input, { key: 'Home' })
    expect(input.selectionStart).toBe(4)
    enabled.value = true
    fireEvent.keyDown(input, { key: 'PageUp' })
    expect(input.selectionStart).toBe(4)
    fireEvent.keyDown(input, { key: 'Home', altKey: true })
    expect(input.selectionStart).toBe(4)
    const claimed = (event: Event): void => { event.preventDefault() }
    input.addEventListener('keydown', claimed)
    fireEvent.keyDown(input, { key: 'Home' })
    expect(input.selectionStart).toBe(4)
    input.removeEventListener('keydown', claimed)
    dispose()
    input.remove()
  })

  it('skips fields that carry no movable caret', () => {
    const dispose = registerTextFieldHomeEnd(() => true)
    const readOnly = field('alpha beta', { readOnly: true })
    readOnly.setSelectionRange(4, 4)
    fireEvent.keyDown(readOnly, { key: 'Home' })
    expect(readOnly.selectionStart).toBe(4)
    const disabled = field('alpha beta', { disabled: true })
    fireEvent.keyDown(disabled, { key: 'Home' })
    const number = document.createElement('input')
    number.type = 'number'
    document.body.appendChild(number)
    expect(fireEvent.keyDown(number, { key: 'Home' })).toBe(true)
    const area = document.createElement('textarea')
    area.value = 'alpha'
    area.readOnly = true
    document.body.appendChild(area)
    area.setSelectionRange(2, 2)
    fireEvent.keyDown(area, { key: 'Home' })
    expect(area.selectionStart).toBe(2)
    const disabledArea = document.createElement('textarea')
    disabledArea.value = 'alpha'
    disabledArea.disabled = true
    document.body.appendChild(disabledArea)
    disabledArea.setSelectionRange(2, 2)
    fireEvent.keyDown(disabledArea, { key: 'Home' })
    expect(disabledArea.selectionStart).toBe(2)
    const div = document.createElement('div')
    document.body.appendChild(div)
    expect(fireEvent.keyDown(div, { key: 'Home' })).toBe(true)
    dispose()
    for (const el of [readOnly, disabled, number, area, disabledArea, div]) el.remove()
  })

  it('stops listening once disposed', () => {
    const dispose = registerTextFieldHomeEnd(() => true)
    const input = field('alpha beta')
    input.setSelectionRange(4, 4)
    dispose()
    fireEvent.keyDown(input, { key: 'Home' })
    expect(input.selectionStart).toBe(4)
    input.remove()
  })
})

describe('text-field caret preference', () => {
  it('defaults to moving the caret and accepts the durable value', () => {
    expect(ConversationSettingsSchema({} as ConversationSettings).homeEndInTextFields).toBe(true)
    expect(ConversationSettingsSchema(
      { homeEndInTextFields: false } as ConversationSettings,
    ).homeEndInTextFields).toBe(false)
  })

  it('publishes and persists a change, and leaves an identical write untouched', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new HomeEndCaretPolicy(host.scope)
    expect(policy.enabled.getSnapshot()).toBe(DEFAULT_HOME_END_CARET)
    policy.set(true) // already the live value: no durable write
    expect(host.set).not.toHaveBeenCalled()
    const changed = vi.fn()
    policy.enabled.subscribe(changed)
    policy.set(false)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(host.set).toHaveBeenCalledWith('homeEndInTextFields', false)
  })

  it('adopts the Host preference without writing it back', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new HomeEndCaretPolicy(host.scope)
    policy.set(false)
    host.publish({ status: 'ready', value: SETTINGS, revision: 1, writable: true })
    expect(policy.enabled.getSnapshot()).toBe(true)
    host.publish({ status: 'ready', value: SETTINGS, revision: 2, writable: true })
    expect(policy.enabled.getSnapshot()).toBe(true)
  })

  it('adopts a section already standing at construction and stays process-local without a scope', () => {
    const host = stubSettingsScope<ConversationSettings>()
    host.publish({
      status: 'ready',
      value: { ...SETTINGS, homeEndInTextFields: false },
      revision: 1,
      writable: true,
    })
    expect(new HomeEndCaretPolicy(host.scope).enabled.getSnapshot()).toBe(false)
    const local = new HomeEndCaretPolicy()
    local.set(false)
    expect(local.enabled.getSnapshot()).toBe(false)
  })
})

describe('HomeEndCaretRow', () => {
  function mountRow() {
    const policy = new HomeEndCaretPolicy()
    const setHomeEndCaret = vi.fn((enabled: boolean) => { policy.set(enabled) })
    const props: HomeEndCaretRowProps = {
      useSessions: emptySessions(),
      useSessionPendingInteraction: noPendingInteraction(),
      useResource,
      useWorkspaces: emptyWorkspaces(),
      useHomeEndCaret: bindSnapshotSelector(policy.enabled),
      setHomeEndCaret,
      t: makeTranslate(en),
    }
    render(<HomeEndCaretRow {...props} />)
    return { policy, setHomeEndCaret }
  }

  it('shows the caret behavior by default with the explanatory copy', () => {
    mountRow()
    expect(screen.getByText('Home / End in other text fields')).toBeDefined()
    expect(screen.getByRole('button', { name: /Move the caret/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('hands the browser default back and closes on an outside pointerdown', () => {
    const b = mountRow()
    fireEvent.click(screen.getByRole('button', { name: /Move the caret/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Browser default (scroll the page)' }))
    expect(b.setHomeEndCaret).toHaveBeenCalledWith(false)
    expect(b.policy.enabled.getSnapshot()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /Browser default/ }))
    expect(screen.getByRole('menuitem', { name: 'Move the caret' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Move the caret' })).toBeNull()
  })
})
