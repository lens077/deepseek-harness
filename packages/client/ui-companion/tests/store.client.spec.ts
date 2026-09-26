import { describe, expect, it } from 'vitest'
import { createCompanionStore } from '../src/client/store.ts'

describe('companion viewing state', () => {
  it('cycles from quiet company to greeting, rest, and awake', () => {
    const store = createCompanionStore().create()
    expect(store.getSnapshot()).toEqual({ mood: 'idle', collapsed: false, paused: false, position: null, usage: null })
    store.actions.interact()
    expect(store.getSnapshot().mood).toBe('greeting')
    store.actions.interact()
    expect(store.getSnapshot().mood).toBe('sleeping')
    store.actions.interact()
    expect(store.getSnapshot().mood).toBe('idle')
  })

  it('collapses without losing rest or motion preferences', () => {
    const store = createCompanionStore().create()
    store.actions.interact()
    store.actions.interact()
    store.actions.toggleMotion()
    store.actions.toggleCollapsed()
    expect(store.getSnapshot()).toEqual({ mood: 'sleeping', collapsed: true, paused: true, position: null, usage: null })
    store.actions.toggleCollapsed()
    store.actions.toggleMotion()
    expect(store.getSnapshot()).toEqual({ mood: 'sleeping', collapsed: false, paused: false, position: null, usage: null })
  })

  it('retains a dragged position across mood and size changes and can dock again', () => {
    const store = createCompanionStore().create()
    store.actions.move({ x: 300, y: 200 })
    store.actions.interact()
    store.actions.toggleCollapsed()
    expect(store.getSnapshot().position).toEqual({ x: 300, y: 200 })
    store.actions.dock()
    expect(store.getSnapshot().position).toBeNull()
    expect(store.getSnapshot().mood).toBe('greeting')
  })

  it('retains the requested usage audience across responsive remounts until dismissed', () => {
    const store = createCompanionStore().create()
    store.actions.openUsage('tree')
    store.actions.toggleCollapsed()
    expect(store.getSnapshot().usage).toBe('tree')
    store.actions.closeUsage()
    expect(store.getSnapshot().usage).toBeNull()
  })

  it('keeps independently mounted plugin instances separate', () => {
    const a = createCompanionStore().create()
    const b = createCompanionStore().create()
    a.actions.interact()
    expect(b.getSnapshot().mood).toBe('idle')
  })
})
