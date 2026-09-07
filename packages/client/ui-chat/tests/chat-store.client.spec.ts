import { describe, expect, it } from 'vitest'
import { createChatStore } from '../src/client/stores.ts'

describe('createChatStore', () => {
  it('starts with no reveal request and no expanded Turn process', () => {
    const store = createChatStore().create()
    expect(store.store.getSnapshot()).toEqual({ turnProcesses: [], reveal: null })
  })

  it('creates independent instances', () => {
    const handle = createChatStore()
    const first = handle.create()
    const second = handle.create()
    first.actions.requestReveal(1)
    expect(second.store.getSnapshot().reveal).toBeNull()
  })

  it('records repeated reveal requests and clears the consumed one', () => {
    const store = createChatStore().create()
    store.actions.requestReveal(7)
    expect(store.store.getSnapshot().reveal).toEqual({ seq: 7, nonce: 1 })
    store.actions.requestReveal(7)
    expect(store.store.getSnapshot().reveal).toEqual({ seq: 7, nonce: 2 })
    store.actions.clearReveal()
    expect(store.store.getSnapshot().reveal).toBeNull()
  })

  it('stores only manually expanded Turn-process answers', () => {
    const store = createChatStore().create()
    store.actions.setTurnProcessOpen(2, 3, true)
    expect(store.store.getSnapshot().turnProcesses).toEqual([{ turn: 2, answerStep: 3 }])

    store.actions.setTurnProcessOpen(2, 4, true)
    expect(store.store.getSnapshot().turnProcesses).toEqual([{ turn: 2, answerStep: 4 }])

    store.actions.setTurnProcessOpen(2, 4, false)
    expect(store.store.getSnapshot().turnProcesses).toEqual([])
  })

  it('closes only the requested Turn-process entry', () => {
    const store = createChatStore().create()
    store.actions.setTurnProcessOpen(2, 3, true)
    store.actions.setTurnProcessOpen(3, 4, true)

    store.actions.setTurnProcessOpen(2, 3, false)
    store.actions.setTurnProcessOpen(9, 10, false)

    expect(store.store.getSnapshot().turnProcesses).toEqual([{ turn: 3, answerStep: 4 }])
  })
})
