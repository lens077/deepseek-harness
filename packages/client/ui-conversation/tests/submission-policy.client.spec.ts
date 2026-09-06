// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  ComposerSubmissionPolicy, DEFAULT_BUSY_ENTER_BEHAVIOR,
} from '../src/client/input/submission-policy.ts'
import type { ConversationSettings } from '../src/submission-settings.ts'

describe('ComposerSubmissionPolicy', () => {
  it('defaults to Queue and only applies the preference while running', () => {
    const policy = new ComposerSubmissionPolicy()
    expect(policy.busyEnter.getSnapshot()).toBe(DEFAULT_BUSY_ENTER_BEHAVIOR)
    expect(policy.resolve(false, 'enter', true)).toBe('queue')
    expect(policy.resolve(false, 'accelerated', true)).toBe('queue')
    expect(policy.resolve(true, 'enter', true)).toBe('queue')
    expect(policy.resolve(true, 'accelerated', true)).toBe('steer')
    expect(policy.resolve(true, 'enter', false)).toBe('queue')
    expect(policy.resolve(true, 'accelerated', false)).toBe('queue')

    const changed = vi.fn()
    policy.busyEnter.subscribe(changed)
    policy.setBusyEnter('steer')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(policy.resolve(true, 'enter', true)).toBe('steer')
    expect(policy.resolve(true, 'accelerated', true)).toBe('queue')
    expect(policy.resolve(false, 'enter', true)).toBe('queue')
    expect(policy.resolve(false, 'accelerated', true)).toBe('queue')
  })

  it('requires the configured send gesture and keeps accelerated sending available', () => {
    const policy = new ComposerSubmissionPolicy()
    expect(policy.sendShortcut.getSnapshot()).toBe('enter')
    expect(policy.resolveGesture({ key: 'Enter' })).toBe('enter')
    expect(policy.resolveGesture({ key: 'Enter', ctrlKey: true })).toBe('accelerated')
    expect(policy.resolveGesture({ key: 'Enter', metaKey: true })).toBe('accelerated')
    const changed = vi.fn()
    policy.sendShortcut.subscribe(changed)
    policy.setSendShortcut('mod-enter')
    expect(policy.resolveGesture({ key: 'Enter' })).toBeNull()
    expect(policy.resolveGesture({ key: 'Enter', ctrlKey: true })).toBe('accelerated')
    expect(policy.resolveGesture({ key: 'Enter', metaKey: true })).toBe('accelerated')
    expect(changed).toHaveBeenCalledOnce()
    policy.setSendShortcut('mod-enter')
    expect(changed).toHaveBeenCalledOnce()
    policy.setSendShortcut('enter')
    expect(policy.resolveGesture({ key: 'Enter' })).toBe('enter')
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it.each(['queue', 'steer'] as const)('uses the preferred %s delivery for mod-enter sending', (behavior) => {
    const policy = new ComposerSubmissionPolicy()
    policy.setBusyEnter(behavior)
    policy.setSendShortcut('mod-enter')
    expect(policy.resolve(true, 'accelerated', true)).toBe(behavior)
    expect(policy.resolve(false, 'accelerated', true)).toBe('queue')
    expect(policy.resolve(true, 'accelerated', false)).toBe('queue')
    policy.setSendShortcut('enter')
    expect(policy.resolve(true, 'accelerated', true)).toBe(behavior === 'queue' ? 'steer' : 'queue')
  })

  it('switches live between exact custom chords and presets', () => {
    const policy = new ComposerSubmissionPolicy()
    policy.setSendShortcut('Ctrl+Shift+Enter')
    expect(policy.resolveGesture({ key: 'Enter' })).toBeNull()
    expect(policy.resolveGesture({ key: 'Enter', ctrlKey: true })).toBeNull()
    expect(policy.resolveGesture({ key: 'Enter', ctrlKey: true, shiftKey: true })).toBe('custom')
    expect(policy.resolveGesture({ key: 'Enter', metaKey: true, shiftKey: true })).toBeNull()
    policy.setSendShortcut('Meta+Enter')
    expect(policy.resolveGesture({ key: 'Enter', metaKey: true })).toBe('custom')
    expect(policy.resolveGesture({ key: 'Enter', ctrlKey: true })).toBeNull()
    policy.setSendShortcut('Ctrl+Alt+S')
    expect(policy.resolveGesture({ key: 'ß', code: 'KeyS', ctrlKey: true, altKey: true })).toBe('custom')
    expect(policy.resolveGesture({ key: 's', ctrlKey: true, altKey: true, repeat: true })).toBeNull()
    policy.setSendShortcut('enter')
    expect(policy.resolveGesture({ key: 'Enter' })).toBe('enter')
  })

  it.each(['queue', 'steer'] as const)('uses preferred %s for custom gestures, with idle and subagent fallback', (behavior) => {
    const policy = new ComposerSubmissionPolicy()
    policy.setSendShortcut('Ctrl+Alt+S')
    policy.setBusyEnter(behavior)
    expect(policy.resolve(true, 'custom', true)).toBe(behavior)
    expect(policy.resolve(false, 'custom', true)).toBe('queue')
    expect(policy.resolve(true, 'custom', false)).toBe('queue')
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
    host.publish({ status: 'ready', value: { busyEnter: 'steer', sendShortcut: 'mod-enter', questionNavigation: { previousShortcut: 'Ctrl+ArrowUp', nextShortcut: 'Ctrl+ArrowDown', focusPolicy: 'editable', expandButtonSide: 'right' } }, revision: 1, writable: true })
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
    expect(policy.sendShortcut.getSnapshot()).toBe('mod-enter')
    policy.setBusyEnter('steer')
    policy.setSendShortcut('mod-enter')
    expect(host.set).not.toHaveBeenCalled()
    host.publish({ value: { busyEnter: 'steer', sendShortcut: 'mod-enter', questionNavigation: { previousShortcut: 'Ctrl+ArrowUp', nextShortcut: 'Ctrl+ArrowDown', focusPolicy: 'editable', expandButtonSide: 'right' } }, revision: 2 })
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
  })

  it('adopts a section already standing at construction', () => {
    const host = stubSettingsScope<ConversationSettings>()
    host.publish({ status: 'ready', value: { busyEnter: 'steer', sendShortcut: 'mod-enter', questionNavigation: { previousShortcut: 'Ctrl+ArrowUp', nextShortcut: 'Ctrl+ArrowDown', focusPolicy: 'editable', expandButtonSide: 'right' } }, revision: 1, writable: true })
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
    expect(policy.sendShortcut.getSnapshot()).toBe('mod-enter')
    expect(host.set).not.toHaveBeenCalled()
  })
})
