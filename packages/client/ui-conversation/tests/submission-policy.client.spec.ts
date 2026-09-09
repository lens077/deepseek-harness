// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  ComposerSubmissionPolicy, DEFAULT_BUSY_ENTER_BEHAVIOR, resolveGesture, resolveSubmitMode,
} from '../src/client/input/submission-policy.ts'
import type { ConversationSettings } from '../src/submission-settings.ts'

function currentGesture(policy: ComposerSubmissionPolicy, event: Parameters<typeof resolveGesture>[1]) {
  return resolveGesture(policy.sendShortcut.getSnapshot(), event)
}

function currentMode(
  policy: ComposerSubmissionPolicy,
  running: boolean,
  gesture: Parameters<typeof resolveSubmitMode>[2],
  steeringAvailable: boolean,
) {
  return resolveSubmitMode(
    policy.busyEnter.getSnapshot(), running, gesture, steeringAvailable, policy.sendShortcut.getSnapshot(),
  )
}

describe('resolveSubmitMode', () => {
  it('queues outside steer-capable busy state and applies the preference to the enter gesture', () => {
    expect(resolveSubmitMode('queue', false, 'enter', true)).toBe('queue')
    expect(resolveSubmitMode('queue', false, 'accelerated', true)).toBe('queue')
    expect(resolveSubmitMode('queue', true, 'enter', true)).toBe('queue')
    expect(resolveSubmitMode('queue', true, 'accelerated', true)).toBe('steer')
    expect(resolveSubmitMode('queue', true, 'enter', false)).toBe('queue')
    expect(resolveSubmitMode('queue', true, 'accelerated', false)).toBe('queue')

    expect(resolveSubmitMode('steer', true, 'enter', true)).toBe('steer')
    expect(resolveSubmitMode('steer', true, 'accelerated', true)).toBe('queue')
    expect(resolveSubmitMode('steer', false, 'enter', true)).toBe('queue')
    expect(resolveSubmitMode('steer', false, 'accelerated', true)).toBe('queue')
    expect(resolveSubmitMode('steer', true, 'enter', false)).toBe('queue')
  })
})

describe('ComposerSubmissionPolicy', () => {
  it('defaults to Queue and publishes preference changes', () => {
    const policy = new ComposerSubmissionPolicy()
    expect(policy.busyEnter.getSnapshot()).toBe(DEFAULT_BUSY_ENTER_BEHAVIOR)

    const changed = vi.fn()
    policy.busyEnter.subscribe(changed)
    policy.setBusyEnter('steer')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
  })

  it('requires the configured send gesture and keeps accelerated sending available', () => {
    const policy = new ComposerSubmissionPolicy()
    expect(policy.sendShortcut.getSnapshot()).toBe('enter')
    expect(currentGesture(policy, { key: 'Enter' })).toBe('enter')
    expect(currentGesture(policy, { key: 'Enter', ctrlKey: true })).toBe('accelerated')
    expect(currentGesture(policy, { key: 'Enter', metaKey: true })).toBe('accelerated')
    const changed = vi.fn()
    policy.sendShortcut.subscribe(changed)
    policy.setSendShortcut('mod-enter')
    expect(currentGesture(policy, { key: 'Enter' })).toBeNull()
    expect(currentGesture(policy, { key: 'Enter', ctrlKey: true })).toBe('accelerated')
    expect(currentGesture(policy, { key: 'Enter', metaKey: true })).toBe('accelerated')
    expect(changed).toHaveBeenCalledOnce()
    policy.setSendShortcut('mod-enter')
    expect(changed).toHaveBeenCalledOnce()
    policy.setSendShortcut('enter')
    expect(currentGesture(policy, { key: 'Enter' })).toBe('enter')
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it.each(['queue', 'steer'] as const)('uses the preferred %s delivery for mod-enter sending', (behavior) => {
    const policy = new ComposerSubmissionPolicy()
    policy.setBusyEnter(behavior)
    policy.setSendShortcut('mod-enter')
    expect(currentMode(policy, true, 'accelerated', true)).toBe(behavior)
    expect(currentMode(policy, false, 'accelerated', true)).toBe('queue')
    expect(currentMode(policy, true, 'accelerated', false)).toBe('queue')
    policy.setSendShortcut('enter')
    expect(currentMode(policy, true, 'accelerated', true)).toBe(behavior === 'queue' ? 'steer' : 'queue')
  })

  it('switches live between exact custom chords and presets', () => {
    const policy = new ComposerSubmissionPolicy()
    policy.setSendShortcut('Ctrl+Shift+Enter')
    expect(currentGesture(policy, { key: 'Enter' })).toBeNull()
    expect(currentGesture(policy, { key: 'Enter', ctrlKey: true })).toBeNull()
    expect(currentGesture(policy, { key: 'Enter', ctrlKey: true, shiftKey: true })).toBe('custom')
    expect(currentGesture(policy, { key: 'Enter', metaKey: true, shiftKey: true })).toBeNull()
    policy.setSendShortcut('Meta+Enter')
    expect(currentGesture(policy, { key: 'Enter', metaKey: true })).toBe('custom')
    expect(currentGesture(policy, { key: 'Enter', ctrlKey: true })).toBeNull()
    policy.setSendShortcut('Ctrl+Alt+S')
    expect(currentGesture(policy, { key: 'ß', code: 'KeyS', ctrlKey: true, altKey: true })).toBe('custom')
    expect(currentGesture(policy, { key: 's', ctrlKey: true, altKey: true, repeat: true })).toBeNull()
    policy.setSendShortcut('enter')
    expect(currentGesture(policy, { key: 'Enter' })).toBe('enter')
  })

  it.each(['queue', 'steer'] as const)('uses preferred %s for custom gestures, with idle and subagent fallback', (behavior) => {
    const policy = new ComposerSubmissionPolicy()
    policy.setSendShortcut('Ctrl+Alt+S')
    policy.setBusyEnter(behavior)
    expect(currentMode(policy, true, 'custom', true)).toBe(behavior)
    expect(currentMode(policy, false, 'custom', true)).toBe('queue')
    expect(currentMode(policy, true, 'custom', false)).toBe('queue')
  })

  it('writes an explicit change through the scope after publishing it locally', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const observed: string[] = []
    let liveBehavior = (): string => 'unconstructed'
    const scope: typeof host.scope = {
      ...host.scope,
      set: (field, value) => {
        observed.push(`${field}=${String(value)}:${liveBehavior()}`)
        return host.scope.set(field, value)
      },
    }
    const policy = new ComposerSubmissionPolicy(scope)
    liveBehavior = () => policy.busyEnter.getSnapshot()
    policy.setBusyEnter('steer')
    expect(observed).toEqual(['busyEnter=steer:steer'])
    expect(host.set).toHaveBeenCalledWith('busyEnter', 'steer')
    expect(host.set).toHaveBeenCalledOnce()
    liveBehavior = () => policy.sendShortcut.getSnapshot()
    policy.setSendShortcut('mod-enter')
    expect(observed).toEqual(['busyEnter=steer:steer', 'sendShortcut=mod-enter:mod-enter'])
    expect(host.set).toHaveBeenLastCalledWith('sendShortcut', 'mod-enter')
    expect(host.set).toHaveBeenCalledTimes(2)
    policy.setSendShortcut('Ctrl+Alt+S')
    expect(host.set).toHaveBeenLastCalledWith('sendShortcut', 'Ctrl+Alt+S')
    expect(observed.at(-1)).toBe('sendShortcut=Ctrl+Alt+S:Ctrl+Alt+S')
  })

  it('adopts a Host preference without writing it back and leaves an identical write untouched', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    host.publish({ status: 'ready', value: { busyEnter: 'steer', sendShortcut: 'mod-enter', contentWidth: 'fill', questionNavigation: { previousShortcut: 'Ctrl+ArrowUp', nextShortcut: 'Ctrl+ArrowDown', focusPolicy: 'editable', expandButtonSide: 'right' } }, revision: 1, writable: true })
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
    expect(policy.sendShortcut.getSnapshot()).toBe('mod-enter')
    policy.setBusyEnter('steer')
    policy.setSendShortcut('mod-enter')
    expect(host.set).not.toHaveBeenCalled()
    host.publish({ value: { busyEnter: 'steer', sendShortcut: 'mod-enter', contentWidth: 'fill', questionNavigation: { previousShortcut: 'Ctrl+ArrowUp', nextShortcut: 'Ctrl+ArrowDown', focusPolicy: 'editable', expandButtonSide: 'right' } }, revision: 2 })
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
  })

  it('adopts a section already standing at construction', () => {
    const host = stubSettingsScope<ConversationSettings>()
    host.publish({ status: 'ready', value: { busyEnter: 'steer', sendShortcut: 'mod-enter', contentWidth: 'fill', questionNavigation: { previousShortcut: 'Ctrl+ArrowUp', nextShortcut: 'Ctrl+ArrowDown', focusPolicy: 'editable', expandButtonSide: 'right' } }, revision: 1, writable: true })
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
    expect(policy.sendShortcut.getSnapshot()).toBe('mod-enter')
    expect(host.set).not.toHaveBeenCalled()
  })
})
