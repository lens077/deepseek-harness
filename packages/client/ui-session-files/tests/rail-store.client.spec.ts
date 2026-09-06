// @vitest-environment jsdom
// The rail preference: its open-on-first-use default, the toggle, the width
// clamp, and the localStorage round trip that makes a closed rail stay closed.

import { afterEach, describe, expect, it } from 'vitest'
import {
  clampRailWidth, RAIL_DEFAULT, RAIL_MAX, RAIL_MIN, RAIL_PERSIST_KEY, SessionFilesRailController,
} from '../src/client/rail-store.ts'

afterEach(() => { localStorage.clear() })

describe('clampRailWidth', () => {
  it('holds the contract range and rounds to whole pixels', () => {
    expect(clampRailWidth(RAIL_MIN - 100)).toBe(RAIL_MIN)
    expect(clampRailWidth(RAIL_MAX + 100)).toBe(RAIL_MAX)
    expect(clampRailWidth(320.4)).toBe(320)
  })
})

describe('SessionFilesRailController', () => {
  it('opens on first use at the default width', () => {
    const controller = new SessionFilesRailController('spec.fresh')
    expect(controller.store.getSnapshot()).toEqual({ open: true, width: RAIL_DEFAULT })
  })

  it('toggles and clamps a dragged width', () => {
    const controller = new SessionFilesRailController('spec.writes')
    controller.toggle()
    expect(controller.store.getSnapshot().open).toBe(false)
    controller.toggle()
    expect(controller.store.getSnapshot().open).toBe(true)
    controller.setWidth(RAIL_MAX + 200)
    expect(controller.store.getSnapshot().width).toBe(RAIL_MAX)
  })

  it('carries a closed rail and its width across instances through localStorage', () => {
    const first = new SessionFilesRailController('spec.persist')
    first.toggle()
    first.setWidth(420)
    const second = new SessionFilesRailController('spec.persist')
    expect(second.store.getSnapshot()).toEqual({ open: false, width: 420 })
  })

  it('names one default storage key', () => {
    expect(RAIL_PERSIST_KEY).toBe('dsh.session-files.rail')
  })
})
