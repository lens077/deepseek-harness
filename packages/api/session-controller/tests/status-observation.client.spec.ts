import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionProjectionBaseline } from '../src/types.ts'
import { SessionManager } from '../src/client/sessions/manager.ts'
import { ClientSessions } from '../src/client/sessions/service.ts'
import { FakeApiClient, fakeRemote, ok } from './fake-api.client.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    statusObservationProbe: { readonly replySeq: number }
  }
}

const ID = 'status-observation' as SessionId
const summary = { sessionId: ID, updatedAt: 1, running: false, blank: false }
const baseline = (replySeq: number): SessionProjectionBaseline => ({
  asOfSeq: replySeq + 1,
  values: { statusObservationProbe: { replySeq } },
})

describe('status and projection observation', () => {
  it('publishes idle together with its projection when the control update is delayed', async () => {
    const manager = new SessionManager(fakeRemote(new FakeApiClient()))
    const observations: { running: boolean; completed: boolean; replySeq: number | undefined }[] = []
    const stop = manager.subscribe(() => {
      const row = manager.getListSnapshot().items.find(item => item.sessionId === ID)
      if (row !== undefined) observations.push({
        running: row.running, completed: row.completed,
        replySeq: row.projectionValues?.statusObservationProbe?.replySeq,
      })
    })
    try {
      manager.handleSessionAdded({ ...summary, projections: baseline(9) })
      manager.handleSessionStatus(ID, true, baseline(9))
      await Promise.resolve()
      observations.length = 0
      manager.handleSessionStatus(ID, false, baseline(19))
      await Promise.resolve()
      expect(observations).toEqual([{ running: false, completed: true, replySeq: 19 }])
      manager.handleControlFrame({
        type: 'projection', sessionId: ID, key: 'statusObservationProbe',
        value: { replySeq: 9 }, seq: 10,
      })
      expect(manager.getListSnapshot().items[0]?.projectionValues?.statusObservationProbe?.replySeq).toBe(19)
    } finally {
      stop()
      await manager.dispose()
    }
  })

  it('preserves a newer control projection when a status snapshot arrives afterward', async () => {
    const manager = new SessionManager(fakeRemote(new FakeApiClient()))
    try {
      manager.handleSessionAdded({ ...summary, projections: baseline(9) })
      manager.handleSessionStatus(ID, true, baseline(9))
      manager.handleControlFrame({
        type: 'projection', sessionId: ID, key: 'statusObservationProbe',
        value: { replySeq: 29 }, seq: 30,
      })
      manager.handleSessionStatus(ID, false, baseline(19))
      expect(manager.getListSnapshot().items[0]).toMatchObject({
        running: false, completed: true,
        projectionValues: { statusObservationProbe: { replySeq: 29 } },
      })
    } finally {
      await manager.dispose()
    }
  })

  it('keeps the status snapshot across a later stale list refresh', async () => {
    const api = new FakeApiClient()
    api.onList = () => Promise.resolve(ok({ items: [{ ...summary, projections: baseline(9) }] }))
    const manager = new SessionManager(fakeRemote(api))
    try {
      await manager.refreshList()
      manager.handleSessionStatus(ID, true, baseline(9))
      manager.handleSessionStatus(ID, false, baseline(19))
      await manager.refreshList()
      expect(manager.getListSnapshot().items[0]).toMatchObject({
        running: false, completed: true,
        projectionValues: { statusObservationProbe: { replySeq: 19 } },
      })
    } finally {
      await manager.dispose()
    }
  })

  it('acknowledges a reply already seen in another browser when its idle snapshot arrives', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    api.onList = () => Promise.resolve(ok({ items: [{ ...summary, projections: baseline(9) }] }))
    const sessions = new ClientSessions(ctx, fakeRemote(api))
    const lastSeenSeq = 19
    const observations: number[] = []
    const stop = sessions.list.subscribe(() => {
      const row = sessions.list.getSnapshot().byId[ID]
      const seq = row?.projectionValues?.statusObservationProbe?.replySeq
      if (row?.completed !== true || row.running || seq === undefined) return
      observations.push(seq)
      if (seq <= lastSeenSeq) sessions.acknowledgeCompletion(ID)
    })
    try {
      await sessions.refresh()
      sessions.handleSessionStatus(ID, true, baseline(9))
      await Promise.resolve()
      sessions.handleSessionStatus(ID, false, baseline(19))
      await Promise.resolve()
      await Promise.resolve()
      expect(observations).toEqual([19])
      expect(sessions.list.getSnapshot().byId[ID]?.completed).toBeUndefined()
    } finally {
      stop()
      await ctx.fiber.dispose()
    }
  })

  it('keeps a new completion unread when a list subscriber acknowledges only the prior reply', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    api.onList = () => Promise.resolve(ok({ items: [{ ...summary, projections: baseline(9) }] }))
    const sessions = new ClientSessions(ctx, fakeRemote(api))
    let lastSeenSeq = 9
    const stop = sessions.list.subscribe(() => {
      const row = sessions.list.getSnapshot().byId[ID]
      const seq = row?.projectionValues?.statusObservationProbe?.replySeq
      if (row?.completed === true && !row.running && seq !== undefined && seq <= lastSeenSeq) {
        sessions.acknowledgeCompletion(ID)
      }
    })
    try {
      await sessions.refresh()
      sessions.handleSessionStatus(ID, true, baseline(9))
      await Promise.resolve()
      sessions.handleSessionStatus(ID, false, baseline(19))
      await Promise.resolve()
      await Promise.resolve()
      expect(sessions.list.getSnapshot().byId[ID]).toMatchObject({
        running: false, completed: true,
        projectionValues: { statusObservationProbe: { replySeq: 19 } },
      })
      lastSeenSeq = 19
      sessions.handleControlFrame({
        type: 'projection', sessionId: ID, key: 'statusObservationProbe',
        value: { replySeq: 19 }, seq: 21,
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(sessions.list.getSnapshot().byId[ID]?.completed).toBeUndefined()
    } finally {
      stop()
      await ctx.fiber.dispose()
    }
  })
})
