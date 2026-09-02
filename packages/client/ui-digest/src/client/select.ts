/**
 * Pure selection over the session list joined with the durable inbox marks:
 * which rows need attention and why, how the panel sections them, what the
 * per-question timeline and the todo list show, and the Markdown brief that
 * summarizes it. Kept React-free so the rules are testable without rendering.
 */
import type { SessionId, SessionSummary, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionDigestOutcome, SessionDigestView } from '@deepseek-ai/dsh-session-digest/client'
import type { InboxSessionState, InboxSnapshot, InboxTodo } from '@deepseek-ai/dsh-session-inbox/types'

/** Which rows the panel admits by time. */
export type InboxWindow = 'sinceReview' | 'today' | 'week' | 'all'

/**
 * Why a row is in the inbox, in the order the panel lists them. `needsYou`
 * outranks everything because the agent is idle until the user answers;
 * `failed` and `unread` are the work that finished while the user was away;
 * `seen` is opened but not yet dealt with; `running` is reported so the panel
 * never reads as the whole picture while omitting in-flight work.
 */
export type InboxCategory = 'needsYou' | 'failed' | 'unread' | 'seen' | 'running' | 'handled' | 'snoozed'

/** Section keys: every category the panel lists plus the pinned group in front. */
export type InboxSectionKey = 'pinned' | Exclude<InboxCategory, 'snoozed'>

/** One session as the inbox sees it. */
export interface InboxItem {
  sessionId: SessionId
  /** Session display title, the card's identity line. */
  title: string
  /** Owning workspace id, absent for ungrouped sessions. */
  workspaceId?: string
  /** Owning workspace title, or the ungrouped label. */
  workspaceTitle: string
  /** The newest human question; `null` for a session with none yet. */
  question: string | null
  questionTruncated: boolean
  /** `user/message` seq of the newest question, the address a todo uses. */
  questionSeq: number | null
  /** The closing assistant answer; `null` when the turn ended without one. */
  reply: string | null
  replyTruncated: boolean
  /** How the turn ended; `null` while open. */
  outcome: SessionDigestOutcome | null
  /** Last activity time, the sort key. */
  updatedAt: number
  changedFiles: readonly string[]
  changedFileCount: number
  /** The agent is blocked on an approval or question. */
  waiting: boolean
  running: boolean
  pinned: boolean
  handled: boolean
  /** A reply landed after the user's last seen mark. */
  unread: boolean
  snoozedUntil: number | null
  category: InboxCategory
}

/** One rendered section of items. */
export interface InboxSection {
  key: InboxSectionKey
  items: InboxItem[]
}

/** Per-workspace attention counts feeding the filter chips. */
export interface InboxWorkspaceCount {
  /** Workspace id, or `null` for ungrouped sessions. */
  workspaceId: string | null
  title: string
  /** Rows the user should act on: waiting, failed, or unread. */
  attention: number
  running: number
}

/** What the panel renders plus the counts the badge and header report. */
export interface InboxSelection {
  sections: InboxSection[]
  workspaces: InboxWorkspaceCount[]
  /** Waiting + failed + unread across every workspace, snoozed and handled excluded. */
  attentionCount: number
  waitingCount: number
  runningCount: number
  snoozedCount: number
  /** The lower time bound the window applied, `null` for `all`. */
  since: number | null
}

/** Inputs that vary per render but not per row. */
export interface InboxSelectOptions {
  now: number
  window: InboxWindow
  /** Restrict to one workspace id, `null` for ungrouped only, `undefined` for every workspace. */
  workspace: string | null | undefined
  showHandled: boolean
  ungroupedLabel: string
}

/** One question placed on the day it was asked. */
export interface TimelineEntry {
  sessionId: SessionId
  title: string
  workspaceTitle: string
  seq: number
  at: number
  text: string
  truncated: boolean
  outcome: SessionDigestOutcome | null
  changedFileCount: number
  /** Whether this is the session's newest question. */
  current: boolean
}

/** One day of the timeline, newest day first, newest entry first. */
export interface TimelineDay {
  /** Local calendar day key `YYYY-MM-DD`. */
  key: string
  /** Local midnight of the day, for label formatting. */
  start: number
  entries: TimelineEntry[]
}

/** One todo joined with the session it points at. */
export interface TodoRow {
  todo: InboxTodo
  /** Session title, or `null` when the session is gone from the list. */
  title: string | null
  workspaceTitle: string | null
  /** The addressed question's text, when the digest still retains it. */
  questionText: string | null
}

/** Copy the brief needs, resolved by the caller from its dictionary. */
export interface BriefLabels {
  title: string
  since: string
  sections: Record<InboxSectionKey, string>
  outcomes: Record<SessionDigestOutcome | 'open', string>
  files: (count: number) => string
  todos: string
  none: string
}

const DAY_MS = 86_400_000

/**
 * Read one row's digest projection value.
 * @param summary - session list row.
 * @returns the digest value, or undefined when the host serves no key.
 */
function digestOf(summary: SessionSummary): SessionDigestView | undefined {
  return summary.projectionValues?.sessionDigest
}

/**
 * Whether a row may appear at all. Subagent-origin rows are excluded for the
 * same reason the sidebar hides them: they are reached through their parent,
 * and listing them would report one user task several times.
 * @param summary - session list row.
 * @returns whether the row describes user-facing work.
 */
function eligible(summary: SessionSummary): boolean {
  return !summary.blank && summary.origin !== 'subagent'
}

/** Workspace lookup by session plus a title per workspace id. */
interface WorkspaceIndex {
  of: Map<SessionId, string>
  title: Map<string, string>
}

function indexWorkspaces(workspaces: readonly WorkspaceView[]): WorkspaceIndex {
  const of = new Map<SessionId, string>()
  const title = new Map<string, string>()
  for (const workspace of workspaces) {
    title.set(workspace.workspaceId, workspace.title)
    for (const sessionId of workspace.sessionIds) of.set(sessionId, workspace.workspaceId)
  }
  return { of, title }
}

/** Resolve the workspace title for a session, or the ungrouped label. */
function workspaceTitleOf(index: WorkspaceIndex, workspaceId: string | undefined, ungroupedLabel: string): string {
  if (workspaceId === undefined) return ungroupedLabel
  return index.title.get(workspaceId) ?? ungroupedLabel
}

/**
 * Local midnight of the day containing `at`.
 * @param at - epoch ms.
 * @returns epoch ms of local midnight.
 */
export function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Local calendar key of the day containing `at`.
 * @param at - epoch ms.
 * @returns `YYYY-MM-DD` in local time.
 */
export function dayKey(at: number): string {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Resolve the window's lower bound.
 * @param window - the selected window.
 * @param now - current time.
 * @param reviewedAt - the last review time; a never-reviewed inbox falls back to the last day.
 * @returns epoch ms, or `null` for no bound.
 */
export function windowSince(window: InboxWindow, now: number, reviewedAt: number | null): number | null {
  switch (window) {
    case 'sinceReview': return reviewedAt ?? now - DAY_MS
    case 'today': return startOfDay(now)
    case 'week': return startOfDay(now) - 6 * DAY_MS
    case 'all': return null
  }
}

/**
 * Classify one row.
 * @param summary - the list row.
 * @param digest - its digest value, possibly absent.
 * @param mark - the user's durable marks, possibly absent.
 * @param now - current time.
 * @returns the category and unread bit, or `null` when the row has nothing to report.
 */
function classify(
  summary: SessionSummary,
  digest: SessionDigestView | undefined,
  mark: InboxSessionState | undefined,
  now: number,
): { category: InboxCategory; unread: boolean } | null {
  if (summary.pendingInteraction !== undefined) return { category: 'needsYou', unread: false }
  if (summary.running) return { category: 'running', unread: false }
  if (digest?.question == null) return null
  const seenSeq = mark?.lastSeenSeq ?? -1
  const landedSeq = digest.replySeq ?? digest.questionSeq
  const unread = landedSeq !== null && landedSeq > seenSeq
  if (mark !== undefined && mark.snoozedUntil !== null && mark.snoozedUntil > now) {
    return { category: 'snoozed', unread }
  }
  if (mark?.handledAt != null) return { category: 'handled', unread }
  if (digest.outcome !== 'completed') return { category: 'failed', unread }
  return { category: unread ? 'unread' : 'seen', unread }
}

/** Build every item the list can describe, before any window or filter. */
function buildItems(
  sessions: readonly SessionSummary[],
  workspaces: readonly WorkspaceView[],
  inbox: InboxSnapshot,
  now: number,
  ungroupedLabel: string,
): InboxItem[] {
  const index = indexWorkspaces(workspaces)
  const marks = new Map<SessionId, InboxSessionState>()
  for (const mark of inbox.sessions) marks.set(mark.sessionId, mark)
  const items: InboxItem[] = []
  for (const summary of sessions) {
    if (!eligible(summary)) continue
    const digest = digestOf(summary)
    const mark = marks.get(summary.id)
    const classified = classify(summary, digest, mark, now)
    if (classified === null) continue
    const workspaceId = index.of.get(summary.id)
    items.push({
      sessionId: summary.id,
      title: summary.displayTitle,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      workspaceTitle: workspaceTitleOf(index, workspaceId, ungroupedLabel),
      question: digest?.question ?? null,
      questionTruncated: digest?.questionTruncated ?? false,
      questionSeq: digest?.questionSeq ?? null,
      reply: digest?.reply ?? null,
      replyTruncated: digest?.replyTruncated ?? false,
      outcome: digest?.outcome ?? null,
      updatedAt: summary.updatedAt,
      changedFiles: digest?.changedFiles ?? [],
      changedFileCount: digest?.changedFileCount ?? 0,
      waiting: summary.pendingInteraction !== undefined,
      running: summary.running,
      pinned: mark?.pinned ?? false,
      handled: mark?.handledAt != null,
      unread: classified.unread,
      snoozedUntil: mark?.snoozedUntil ?? null,
      category: classified.category,
    })
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt)
  return items
}

const SECTION_ORDER: readonly InboxSectionKey[] = ['pinned', 'needsYou', 'failed', 'unread', 'seen', 'running', 'handled']

/**
 * Select and section the inbox.
 *
 * Waiting, failed, unread, and pinned rows are admitted regardless of the
 * window: they are the reason the inbox exists, and hiding one behind a time
 * bound would let the agent wait unanswered. The window applies to `seen`,
 * `handled`, and `running` rows, which are context rather than a call to
 * action. Snoozed rows are counted and never listed.
 *
 * @param sessions - every session list row, in list order.
 * @param workspaces - current workspace entities, for titles and chips.
 * @param inbox - the durable marks.
 * @param options - time, window, workspace filter, and labels.
 * @returns sections, chip counts, and the badge counts.
 */
export function selectInbox(
  sessions: readonly SessionSummary[],
  workspaces: readonly WorkspaceView[],
  inbox: InboxSnapshot,
  options: InboxSelectOptions,
): InboxSelection {
  const items = buildItems(sessions, workspaces, inbox, options.now, options.ungroupedLabel)
  const since = windowSince(options.window, options.now, inbox.reviewedAt)

  const counts = new Map<string | null, InboxWorkspaceCount>()
  const countFor = (item: InboxItem): InboxWorkspaceCount => {
    const key = item.workspaceId ?? null
    let count = counts.get(key)
    if (count === undefined) {
      count = { workspaceId: key, title: item.workspaceTitle, attention: 0, running: 0 }
      counts.set(key, count)
    }
    return count
  }

  let attentionCount = 0
  let waitingCount = 0
  let runningCount = 0
  let snoozedCount = 0
  const admitted: InboxItem[] = []
  for (const item of items) {
    const count = countFor(item)
    if (item.category === 'snoozed') {
      snoozedCount += 1
      continue
    }
    if (item.category === 'running') {
      runningCount += 1
      count.running += 1
    }
    const actionable = item.category === 'needsYou' || item.category === 'failed' || item.category === 'unread'
    if (actionable) {
      attentionCount += 1
      count.attention += 1
      if (item.category === 'needsYou') waitingCount += 1
    }
    if (item.category === 'handled' && !options.showHandled) continue
    const inWindow = since === null || item.updatedAt >= since
    if (!actionable && !item.pinned && !inWindow) continue
    if (options.workspace !== undefined && (item.workspaceId ?? null) !== options.workspace) continue
    admitted.push(item)
  }

  const buckets = new Map<InboxSectionKey, InboxItem[]>()
  for (const item of admitted) {
    const key: InboxSectionKey = item.pinned && item.category !== 'running' ? 'pinned' : item.category as InboxSectionKey
    const bucket = buckets.get(key)
    if (bucket === undefined) buckets.set(key, [item])
    else bucket.push(item)
  }
  const sections: InboxSection[] = []
  for (const key of SECTION_ORDER) {
    const bucket = buckets.get(key)
    if (bucket !== undefined) sections.push({ key, items: bucket })
  }

  // Chips follow the workspace list so they match the sidebar; ungrouped trails.
  const orderedCounts: InboxWorkspaceCount[] = []
  for (const workspace of workspaces) {
    const count = counts.get(workspace.workspaceId)
    if (count !== undefined) orderedCounts.push(count)
  }
  const ungrouped = counts.get(null)
  if (ungrouped !== undefined) orderedCounts.push(ungrouped)

  return { sections, workspaces: orderedCounts, attentionCount, waitingCount, runningCount, snoozedCount, since }
}

/**
 * Place every retained question of every eligible session on the day it was
 * asked. A session worked on three days appears on three days, which is what
 * "what did I do on Tuesday" needs and what a per-session list cannot say.
 * @param sessions - every session list row.
 * @param workspaces - current workspace entities, for titles.
 * @param since - lower time bound, `null` for none.
 * @param ungroupedLabel - workspace title for ungrouped sessions.
 * @returns days, newest first.
 */
export function selectTimeline(
  sessions: readonly SessionSummary[],
  workspaces: readonly WorkspaceView[],
  since: number | null,
  ungroupedLabel: string,
): TimelineDay[] {
  const index = indexWorkspaces(workspaces)
  const entries: TimelineEntry[] = []
  for (const summary of sessions) {
    if (!eligible(summary)) continue
    const digest = digestOf(summary)
    if (digest === undefined) continue
    const base = {
      sessionId: summary.id,
      title: summary.displayTitle,
      workspaceTitle: workspaceTitleOf(index, index.of.get(summary.id), ungroupedLabel),
    }
    for (const past of digest.history) {
      if (since !== null && past.at < since) continue
      entries.push({
        ...base,
        seq: past.seq,
        at: past.at,
        text: past.text,
        truncated: past.truncated,
        outcome: past.outcome,
        changedFileCount: past.changedFileCount,
        current: false,
      })
    }
    if (digest.question !== null && digest.questionSeq !== null && digest.questionAt !== null
      && (since === null || digest.questionAt >= since)) {
      entries.push({
        ...base,
        seq: digest.questionSeq,
        at: digest.questionAt,
        text: digest.question,
        truncated: digest.questionTruncated,
        outcome: digest.outcome,
        changedFileCount: digest.changedFileCount,
        current: true,
      })
    }
  }
  entries.sort((a, b) => b.at - a.at)
  const days: TimelineDay[] = []
  for (const entry of entries) {
    const key = dayKey(entry.at)
    const last = days[days.length - 1]
    if (last !== undefined && last.key === key) last.entries.push(entry)
    else days.push({ key, start: startOfDay(entry.at), entries: [entry] })
  }
  return days
}

/**
 * Join todos with the sessions they address. Open todos come first, newest
 * first; done todos trail, newest done first.
 * @param inbox - the durable marks carrying the todos.
 * @param sessions - every session list row.
 * @param workspaces - current workspace entities, for titles.
 * @param ungroupedLabel - workspace title for ungrouped sessions.
 * @returns the joined rows.
 */
export function selectTodos(
  inbox: InboxSnapshot,
  sessions: readonly SessionSummary[],
  workspaces: readonly WorkspaceView[],
  ungroupedLabel: string,
): TodoRow[] {
  const index = indexWorkspaces(workspaces)
  const byId = new Map<SessionId, SessionSummary>()
  for (const summary of sessions) byId.set(summary.id, summary)
  const rows: TodoRow[] = inbox.todos.map((todo) => {
    const summary = byId.get(todo.sessionId)
    if (summary === undefined) return { todo, title: null, workspaceTitle: null, questionText: null }
    const digest = digestOf(summary)
    let questionText: string | null = null
    if (digest !== undefined) {
      if (todo.questionSeq === null || digest.questionSeq === todo.questionSeq) questionText = digest.question
      else questionText = digest.history.find(past => past.seq === todo.questionSeq)?.text ?? null
    }
    return {
      todo,
      title: summary.displayTitle,
      workspaceTitle: workspaceTitleOf(index, index.of.get(summary.id), ungroupedLabel),
      questionText,
    }
  })
  rows.sort((a, b) => todoRank(a.todo) - todoRank(b.todo) || todoTime(b.todo) - todoTime(a.todo))
  return rows
}

/** Open todos sort before done ones. */
function todoRank(todo: InboxTodo): number {
  return todo.status === 'open' ? 0 : 1
}

/** The time a todo sorts by: completion for done todos, creation otherwise. */
function todoTime(todo: InboxTodo): number {
  return todo.status === 'done' ? (todo.doneAt ?? todo.updatedAt) : todo.createdAt
}

/**
 * The newest question seq of one list row, the address a todo about the
 * current session takes.
 * @param summary - the row, or `undefined` when the session is not listed.
 * @returns the seq, or `null` when the row has no digest or no question.
 */
export function questionSeqOf(summary: SessionSummary | undefined): number | null {
  return summary?.projectionValues?.sessionDigest?.questionSeq ?? null
}

/**
 * Render the inbox as a Markdown brief the user can paste into a standup or a
 * note: one heading per section, one line per session with its workspace,
 * question, outcome, and changed-file count, then the open todos.
 * @param selection - the current inbox selection.
 * @param todos - the joined todo rows.
 * @param labels - localized copy.
 * @param formatTime - renders an epoch ms time.
 * @returns the Markdown text.
 */
export function renderBrief(
  selection: InboxSelection,
  todos: readonly TodoRow[],
  labels: BriefLabels,
  formatTime: (at: number) => string,
): string {
  const lines: string[] = [`# ${labels.title}`]
  if (selection.since !== null) lines.push('', `${labels.since}: ${formatTime(selection.since)}`)
  if (selection.sections.length === 0) lines.push('', labels.none)
  for (const section of selection.sections) {
    lines.push('', `## ${labels.sections[section.key]} (${section.items.length})`, '')
    for (const item of section.items) {
      const question = item.question === null ? '' : ` — ${item.question.replace(/\s+/gu, ' ')}${item.questionTruncated ? '…' : ''}`
      const outcome = item.running ? '' : ` (${labels.outcomes[item.outcome ?? 'open']})`
      const files = item.changedFileCount > 0 ? ` · ${labels.files(item.changedFileCount)}` : ''
      lines.push(`- [${item.workspaceTitle}] ${item.title}${question}${outcome}${files}`)
    }
  }
  const open = todos.filter(row => row.todo.status === 'open')
  if (open.length > 0) {
    lines.push('', `## ${labels.todos} (${open.length})`, '')
    for (const row of open) {
      const where = row.title === null ? '' : ` — ${row.title}`
      lines.push(`- [ ] ${row.todo.text}${where}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}
