/**
 * Composed component props for this plugin's two registrations: the sidebar
 * entry that toggles the surface, and the center-column panel that renders it.
 * Both take the same store handle, which is how a button in one column drives
 * a surface in another without either knowing the other's component.
 */
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-layout's SlotMap merge (the 'center.overlay' entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.nav.entry' entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { InboxAddTodoRequest, InboxTodoId, InboxTodoStatus } from '@deepseek-ai/dsh-session-inbox/types'
import type { InboxActionResult, InboxView } from '../controller.ts'
import type { createDigestStore } from '../stores.ts'

/** Registrant-private reactive fact both entries read: the durable inbox (an object type so it satisfies the hooks record). */
export type InboxHooks = {
  /** The inbox view; the renderer binds it as `useInbox`. */
  inbox: HostObservable<InboxView>
}

/** Injected share of the sidebar entry: the inbox view for the badge. */
export interface DigestNavEntryInjected {
  hooks: InboxHooks
}

/** Registrant-private injected share of the panel: runtime actions and inbox mutations. */
export interface DigestPanelInjected {
  hooks: InboxHooks
  /** Load the inbox once; the panel calls it on open. */
  ensureInbox: () => Promise<InboxActionResult>
  /** Open one session after the panel closes, exposing the navigation result in the center column. */
  openSession: (id: SessionId) => void
  /** Open one session and scroll its transcript to the question at `seq`. */
  openQuestion: (id: SessionId, seq: number) => void
  /** Open one session with `text` placed in its composer, so the user continues where it stopped. */
  continueSession: (id: SessionId, text: string) => void
  /** Put text on the clipboard; resolves false when the browser refused. */
  copyText: (text: string) => Promise<boolean>
  setHandled: (id: SessionId, handled: boolean) => Promise<InboxActionResult>
  snooze: (id: SessionId, until: number | null) => Promise<InboxActionResult>
  setPinned: (id: SessionId, pinned: boolean) => Promise<InboxActionResult>
  markReviewed: () => Promise<InboxActionResult>
  addTodo: (request: InboxAddTodoRequest) => Promise<InboxActionResult>
  updateTodo: (id: InboxTodoId, patch: { text?: string; status?: InboxTodoStatus }) => Promise<InboxActionResult>
  removeTodo: (id: InboxTodoId) => Promise<InboxActionResult>
}

/** Full props of the sidebar entry: owner wide flag, the shared store, the inbox hook, and copy. */
export type DigestNavEntryProps =
  PropsRuntime<'sidebar.nav.entry'>
  & PropsStore<ReturnType<typeof createDigestStore>>
  & InjectFace<DigestNavEntryInjected>
  & PropsLocale<'digest'>

/** Full props of the panel: the shared store, the global session/workspace hooks, the inbox, and copy. */
export type DigestPanelProps =
  PropsRuntime<'center.overlay'>
  & PropsStore<ReturnType<typeof createDigestStore>>
  & InjectFace<DigestPanelInjected>
  & PropsLocale<'digest'>
