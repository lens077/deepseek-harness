/**
 * The session-inbox domain declaration: the reviewed-at singleton plus the
 * per-Session mark table and the todo table. The zod schemas validate rows at
 * the durable boundary; every field is client-visible, so the stored rows and
 * the wire values share one vocabulary.
 * @module @deepseek-ai/dsh-session-inbox/src/spec
 */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { InboxTodoId } from './types.ts'

const sessionId = z.string().transform(SessionId)
const todoId = z.string().transform(value => value as InboxTodoId)

/** Durable marks on one Session; the key is the Session id. */
export const inboxSessionRowSchema = z.object({
  lastSeenSeq: z.number().int().nullable(),
  handledAt: z.number().nullable(),
  snoozedUntil: z.number().nullable(),
  pinned: z.boolean(),
  updatedAt: z.number(),
}).strict()

/** One stored Session mark row. */
export type InboxSessionRow = z.infer<typeof inboxSessionRowSchema>

/** One stored todo; the key repeats `id` so a row is self-describing. */
export const inboxTodoRowSchema = z.object({
  id: todoId,
  sessionId,
  questionSeq: z.number().int().nullable(),
  text: z.string(),
  status: z.union([z.literal('open'), z.literal('done')]),
  createdAt: z.number(),
  updatedAt: z.number(),
  doneAt: z.number().nullable(),
}).strict()

/** One stored todo row. */
export type InboxTodoRow = z.infer<typeof inboxTodoRowSchema>

/** Durable singleton: when the user last reviewed the inbox. */
export const inboxGlobalSchema = z.object({
  reviewedAt: z.number().nullable(),
}).strict()

/** The stored singleton value. */
export type InboxGlobal = z.infer<typeof inboxGlobalSchema>

/** The session-inbox domain spec opened by the service. */
export const sessionInboxDomainSpec = defineDomain({
  name: 'session_inbox',
  version: 1,
  global: {
    schema: inboxGlobalSchema,
    initial: { reviewedAt: null },
  },
  tables: {
    sessions: domainTable<SessionId, InboxSessionRow>(inboxSessionRowSchema),
    todos: domainTable<InboxTodoId, InboxTodoRow>(inboxTodoRowSchema),
  },
})
