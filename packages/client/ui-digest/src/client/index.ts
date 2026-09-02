/**
 * Inbox plugin, browser half: a sidebar entry carrying the attention count
 * and toggling one center-column surface that lists what needs the user
 * across every workspace, the user's todos, and a per-question timeline.
 *
 * Both registrations share one store handle and one inbox controller created
 * here, which is the sanctioned way for a control in one column to drive a
 * surface in another — neither component imports the other. Both target
 * slots are declared by other plugins, so `apply` registers through
 * `slots.inject()` and re-registers if a declaring slot is restored.
 *
 * The plugin also owns the seen mark: whenever the current session's newest
 * reply lands on screen, its seq is recorded on the Host, which is what turns
 * "finished while I was away" into a durable fact instead of a green dot that
 * vanishes on refresh.
 *
 * @module @deepseek-ai/dsh-client-ui-digest
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-conversation's Context merges (ctx.conversation, chatReveal).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls ui-renderer's optional documentBadge Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls ui-workspace's optional sessionTodos seat.
import type { SessionTodos } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionDigestView } from '@deepseek-ai/dsh-session-digest/client'
import type { DigestNavEntryInjected, DigestPanelInjected } from './contract/slots.ts'
import { InboxController } from './controller.ts'
import { DigestNavEntry } from './DigestNavEntry.tsx'
import { DigestPanel } from './DigestPanel.tsx'
import { createDigestStore } from './stores.ts'
import { questionSeqOf, selectInbox } from './select.ts'
import { en, NS, zh, type DigestKey } from './locales.ts'

export type { DigestKey } from './locales.ts'
export type { DigestNavEntryInjected, DigestNavEntryProps, DigestPanelInjected, DigestPanelProps } from './contract/slots.ts'
export type { InboxActionResult, InboxRemote, InboxView } from './controller.ts'
export { createDigestStore } from './stores.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Inbox surface copy. */
    digest: DigestKey
  }
}

/** Services required by the inbox plugin. */
export const inject = ['slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.sessionInbox']

/** Longest question kept in an automatically worded todo. */
const TODO_QUESTION_CHARS = 120

/**
 * The seq a viewer of a session has necessarily seen: the newest reply, or
 * the newest question while no reply has landed.
 * @param digest - the session's digest value.
 * @returns the seq, or `null` when nothing has been asked.
 */
function landedSeq(digest: SessionDigestView | undefined): number | null {
  if (digest === undefined) return null
  return digest.replySeq ?? digest.questionSeq
}

/**
 * Client plugin body: one store handle, one inbox controller, one sidebar
 * entry, one center-column panel, the seen-mark subscription, and the
 * document badge.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-digest: dictionaries')

  const store = createDigestStore()
  const controller = new InboxController(ctx.remote.sessionInbox)
  ctx.effect(() => () => { controller.dispose() }, 'ui-digest: inbox controller')

  // The Host publishes the complete snapshot after every change, from this
  // browser or another; a reconnect re-reads because pushes may have been missed.
  ctx.effect(() => ctx.remote.$on('session-inbox/changed', (snapshot) => { controller.receive(snapshot) }), 'ui-digest: inbox push')
  ctx.on('connection/reset', () => { void controller.refresh() })
  void controller.ensure()

  // Seen mark: the current session's newest landed seq is what the user has
  // on screen. The controller skips the call when the mark already covers it.
  ctx.effect(() => ctx.sessions.list.subscribe(() => {
    const list = ctx.sessions.list.getSnapshot()
    const id = list.current
    if (id === undefined) return
    const seq = landedSeq(list.byId[id]?.projectionValues?.sessionDigest)
    if (seq === null || controller.getSnapshot().status !== 'ready') return
    void controller.markSeen(id, seq)
  }), 'ui-digest: seen mark')

  // Document badge: the attention count for the browser tab title. The
  // renderer owns the title and offers the badge seat; this plugin only
  // reports the number, and only once that seat exists.
  ctx.inject(['documentBadge'], (badgeCtx) => {
    const recount = (): void => {
      const list = ctx.sessions.list.getSnapshot()
      const workspaces = ctx.workspaces.list.getSnapshot()
      const hidden = new Set(workspaces.archivedSessionIds)
      const rows = list.ids.flatMap((id) => {
        const row = list.byId[id]
        return row === undefined || hidden.has(row.id) ? [] : [row]
      })
      badgeCtx.documentBadge.set(selectInbox(rows, workspaces.items, controller.getSnapshot().snapshot, {
        now: Date.now(), window: 'all', workspace: undefined, showHandled: false, ungroupedLabel: '',
      }).attentionCount)
    }
    badgeCtx.effect(() => ctx.sessions.list.subscribe(recount), 'ui-digest: badge from sessions')
    badgeCtx.effect(() => ctx.workspaces.list.subscribe(recount), 'ui-digest: badge from workspaces')
    badgeCtx.effect(() => controller.subscribe(recount), 'ui-digest: badge from inbox')
    badgeCtx.effect(() => () => { badgeCtx.documentBadge.set(0) }, 'ui-digest: badge reset')
    recount()
  })

  // The panel's bound store actions, captured when its inject factory runs,
  // so a todo added from the session browser can open the list.
  let viewActions: BoundActions<ReturnType<typeof createDigestStore>> | undefined

  // The session browser's menus add todos through this seat; the wording
  // follows what the inbox card would write, and the panel opens on the list.
  const translate = ctx.locale.bind(NS)
  ctx.provide('sessionTodos', {
    add: (sessionIds) => {
      const list = ctx.sessions.list.getSnapshot()
      const requests = sessionIds.map((sessionId) => {
        const row = list.byId[sessionId]
        const question = (row?.projectionValues?.sessionDigest?.question ?? row?.displayTitle ?? sessionId).replace(/\s+/gu, ' ').trim()
        return controller.addTodo({
          sessionId,
          questionSeq: questionSeqOf(row),
          text: translate('todo.auto', {
            question: question.length > TODO_QUESTION_CHARS ? `${question.slice(0, TODO_QUESTION_CHARS)}…` : question,
          }),
        })
      })
      void Promise.all(requests).then((results) => {
        if (results.some(result => result.ok)) viewActions?.open('todos')
      })
    },
  } satisfies SessionTodos)

  const openQuestion = (id: SessionId, seq: number): void => {
    ctx.sessions.open(id)
    ctx.get('chatReveal')?.reveal(id, seq)
  }
  const continueSession = (id: SessionId, text: string): void => {
    ctx.sessions.open(id)
    const scope = ctx.sessions.scope(id)
    const conversation = ctx.get('conversation')
    if (scope === undefined || conversation === undefined) return
    conversation.input.for(scope).setDraft(text)
  }

  ctx.slots.inject('sidebar.nav.entry', () => ctx.slots.register({
    name: 'sidebar.nav.entry',
    id: 'digest',
    order: 0,
    locale: NS,
    store,
    inject: (): DigestNavEntryInjected => ({ hooks: { inbox: controller } }),
  }, DigestNavEntry))

  ctx.slots.inject('center.overlay', () => ctx.slots.register({
    name: 'center.overlay',
    id: 'digest',
    order: 0,
    locale: NS,
    store,
    inject: (actions): DigestPanelInjected => {
      viewActions = actions
      return {
        hooks: { inbox: controller },
        ensureInbox: () => controller.ensure(),
        openSession: (id) => { ctx.sessions.open(id) },
        openQuestion,
        continueSession,
        copyText: text => writeClipboard(text),
        setHandled: (id, handled) => controller.setHandled(id, handled),
        snooze: (id, until) => controller.snooze(id, until),
        setPinned: (id, pinned) => controller.setPinned(id, pinned),
        markReviewed: () => controller.markReviewed(),
        addTodo: request => controller.addTodo(request),
        updateTodo: (id, patch) => controller.updateTodo(id, patch),
        removeTodo: id => controller.removeTodo(id),
      }
    },
  }, DigestPanel))
}
