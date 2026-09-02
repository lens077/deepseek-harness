/** Shared row, digest, inbox, and translate fixtures for the ui-digest specs. */
import type { SessionId, SessionSummary, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionDigestView } from '@deepseek-ai/dsh-session-digest/client'
import type { InboxSessionState, InboxSnapshot, InboxTodo, InboxTodoId } from '@deepseek-ai/dsh-session-inbox/types'
import type { ProjectTodoFile, ProjectTodoItem, ProjectTodoProject, ProjectTodosSnapshot } from '@deepseek-ai/dsh-project-todos/types'
import type { DigestPanelProps } from '../src/client/contract/slots.ts'
import { zh } from '../src/client/locales.ts'

/** A fixed "now" every spec shares: 2026-09-16 10:00 local. */
export const NOW = new Date(2026, 8, 16, 10, 0, 0).getTime()
export const HOUR = 3_600_000
export const DAY = 24 * HOUR

/** Chinese-dictionary translate stub with `{name}` interpolation. */
export const t = ((key: string, params?: Record<string, unknown>) => {
  const raw = (zh as Record<string, string>)[key] ?? key
  return params === undefined
    ? raw
    : raw.replace(/\{(\w+)\}/g, (_m, name: string) => {
      const value = params[name]
      return typeof value === 'number' || typeof value === 'string' ? String(value) : ''
    })
}) as DigestPanelProps['t']

export const digest = (over: Partial<SessionDigestView> = {}): SessionDigestView => ({
  question: '修一下登录的 bug',
  questionTruncated: false,
  questionSeq: 1,
  questionAt: NOW - 2 * HOUR,
  reply: '已修复：token 刷新和跳转有竞态。',
  replyTruncated: false,
  outcome: 'completed',
  replySeq: 3,
  repliedAt: NOW - HOUR,
  changedFiles: [],
  changedFileCount: 0,
  history: [],
  ...over,
})

export const row = (id: string, over: Partial<SessionSummary> = {}): SessionSummary => ({
  id: id as SessionId,
  displayTitle: `title-${id}`,
  running: false,
  blank: false,
  updatedAt: NOW - HOUR,
  projectionValues: { sessionDigest: digest() },
  ...over,
})

export const workspace = (id: string, sessionIds: string[], title = `ws-${id}`): WorkspaceView => ({
  workspaceId: id,
  title,
  path: `/tmp/${id}`,
  sessionIds: sessionIds as SessionId[],
  nestedUnder: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as WorkspaceView)

export const mark = (id: string, over: Partial<InboxSessionState> = {}): InboxSessionState => ({
  sessionId: id as SessionId,
  lastSeenSeq: null,
  handledAt: null,
  snoozedUntil: null,
  pinned: false,
  updatedAt: NOW,
  ...over,
})

export const todo = (id: string, sessionId: string, over: Partial<InboxTodo> = {}): InboxTodo => ({
  id: id as InboxTodoId,
  sessionId: sessionId as SessionId,
  questionSeq: null,
  text: `todo-${id}`,
  status: 'open',
  createdAt: NOW - HOUR,
  updatedAt: NOW - HOUR,
  doneAt: null,
  ...over,
})

export const inbox = (over: Partial<InboxSnapshot> = {}): InboxSnapshot => ({
  reviewedAt: null,
  sessions: [],
  todos: [],
  ...over,
})

export const projectItem = (text: string, over: Partial<ProjectTodoItem> = {}): ProjectTodoItem => ({
  line: 1,
  text,
  status: 'open',
  checkbox: true,
  depth: 0,
  section: null,
  ...over,
})

export const projectFile = (path: string, items: ProjectTodoItem[], over: Partial<ProjectTodoFile> = {}): ProjectTodoFile => ({
  path,
  relativePath: path.split('/').slice(-1)[0] ?? path,
  mtime: NOW - HOUR,
  size: 100,
  items,
  open: items.filter(item => item.status === 'open').length,
  done: items.filter(item => item.status === 'done').length,
  truncated: false,
  ...over,
})

export const project = (path: string, files: ProjectTodoFile[], over: Partial<ProjectTodoProject> = {}): ProjectTodoProject => ({
  path,
  name: path.split('/').slice(-1)[0] ?? path,
  sources: ['root'],
  files,
  open: files.reduce((sum, file) => sum + file.open, 0),
  done: files.reduce((sum, file) => sum + file.done, 0),
  ...over,
})

export const projectsSnapshot = (over: Partial<ProjectTodosSnapshot> = {}): ProjectTodosSnapshot => ({
  scannedAt: NOW - HOUR,
  settings: { roots: ['/tmp/root'], files: ['TODO.md'], includeWorkspaces: true },
  candidates: 3,
  projects: [],
  warnings: [],
  ...over,
})
