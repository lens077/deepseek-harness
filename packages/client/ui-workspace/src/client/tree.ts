/**
 * Derives the workspace browser tree from Host Workspace order and membership.
 * Unassigned Sessions trail under Ungrouped; only the selected blank Session
 * remains visible.
 */
import {
  indexSubagentDescendants, type PendingInteractionStatus, type SessionId, type SessionListState,
  type SessionSearchResultItem, type SessionSummary, type SubagentDescendantSummary,
  type WorkspaceId, type WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Group key for Sessions outside every Workspace. */
export const UNGROUPED_KEY = ''

/** Display label for the ungrouped bucket row. */
export const UNGROUPED_LABEL = 'Ungrouped'

/** One session row in a group or the flat list. */
export interface SessionNode {
  id: SessionId
  /** Stored display title; the renderer substitutes the localized New Session label for blank rows. */
  title: string
  /** The provisional blank session (renderer shows the localized New Session title). */
  blank: boolean
  /** The runtime Session list reports an interaction awaiting this user. */
  pendingInteraction?: PendingInteractionStatus
  running: boolean
  /** Running descendants connected through uninterrupted subagent-origin lineage. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  updatedAt: number
  /**
   * Nested fork children (the workspace's `nestedUnder` placement), siblings
   * in flat-account order. Always empty in the flat list and in search rows —
   * those surfaces stay hierarchy-free.
   */
  children: readonly SessionNode[]
}

/** Session order selected by the Workspace browser. */
export type SessionOrderBy = 'manual' | 'updated'

/** One workspace group section: header row facts + visible top-level session rows. */
export interface GroupNode {
  /** Group key: the workspace id or {@link UNGROUPED_KEY}. */
  key: string
  /** Backing Workspace id; absent only for the ungrouped bucket. */
  workspaceId: WorkspaceId | undefined
  cwd: string | undefined
  /** Workspace creation time (epoch ms); absent only for the ungrouped bucket. */
  createdAt: number | undefined
  label: string
  /** Total visible sessions in the group. */
  sessionCount: number
  expanded: boolean
  /** The group contains the selected session (active folder tint; supplied here so the renderer never scans). */
  containsCurrent: boolean
  /** Visible top-level session rows, each carrying its nested-child branch (empty while the group is folded). */
  sessions: readonly SessionNode[]
}

/** One flat search row combining list metadata with an optional content match. */
export interface SearchResultNode {
  id: SessionId
  title: string
  workspace: string
  /** The runtime Session list reports an interaction awaiting this user. */
  pendingInteraction?: PendingInteractionStatus
  running: boolean
  /** Running descendants connected through uninterrupted subagent-origin lineage. */
  runningSubagentCount: number
  /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
  completed: boolean
  snippet?: string
}

/** Bounded merged search projection plus the refine-query hint bit. */
export interface SearchResultSet {
  items: readonly SearchResultNode[]
  hasMore: boolean
}

/** One archived row plus the Workspace context retained outside Session state. */
export interface ArchivedSessionNode {
  session: SessionNode
  workspace: string
}

/** Viewing state consumed by the derivation. */
export interface TreeView {
  expandedGroups: readonly string[]
  /** Browser-local order for Sessions without a backing Workspace account. */
  ungroupedOrder?: readonly string[]
}

interface Group {
  key: string
  workspaceId: WorkspaceId | undefined
  cwd: string | undefined
  createdAt: number | undefined
  label: string
  sessions: SessionSummary[]
  /** Nested display placement from the backing workspace ({} for Ungrouped). */
  nestedUnder: Readonly<Record<string, SessionId>>
}

/**
 * Directory display label: basename of the path (both separators accepted).
 * Ungrouped-bucket fallback for surfaces without a workspace title.
 * @param cwd - directory path, or undefined for the ungrouped bucket.
 * @returns basename, the raw cwd when it has no basename, or the ungrouped label.
 */
export function workspaceLabel(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return UNGROUPED_LABEL
  const base = cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop()
  return base !== undefined && base !== '' ? base : cwd
}

/** Resolve the first retained Workspace title for each accounted session. */
function workspaceLabelsBySession(workspaces: readonly WorkspaceView[]): Map<SessionId, string> {
  const labels = new Map<SessionId, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!labels.has(sessionId)) labels.set(sessionId, workspace.title)
    }
  }
  return labels
}

/** Recency comparator: newest first, id as the deterministic tiebreak (ids are unique per group). */
function byRecency(a: SessionSummary, b: SessionSummary): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : 1
}

/**
 * Ordinary sessions are visible; among blank sessions, only the current one
 * is visible. Subagent children use their parent header catalog; archive
 * members stay out of every active-session derivation while their accounting
 * slots remain so the dedicated archived view can restore them in place.
 */
function sessionVisible(session: SessionSummary, current: SessionId | undefined, archived: ReadonlySet<SessionId>): boolean {
  return session.origin !== 'subagent'
    && !archived.has(session.id)
    && (!session.blank || session.id === current)
}

/**
 * A blank session is the selected Workspace's provisional New Session row;
 * its canonical title never enters search (blank rows are query-excluded)
 * and the renderer localizes its display label.
 */
function sessionTitle(session: SessionSummary): string {
  return session.blank ? 'New Session' : session.displayTitle
}

/**
 * Build one group. Header lineage stays out of presentation; nesting is the
 * workspace's explicit `nestedUnder` placement, projected in
 * {@link deriveGroups}.
 */
function buildGroup(
  key: string,
  workspaceId: WorkspaceId | undefined,
  cwd: string | undefined,
  createdAt: number | undefined,
  label: string,
  members: readonly SessionSummary[],
  order: 'account' | 'recency',
  nestedUnder: Readonly<Record<string, SessionId>>,
): Group {
  const sessions = [...members]
  // Real Workspace order comes from sessionIds. Ungrouped falls back to
  // recency until the browser supplies its persisted local order.
  if (order === 'recency') sessions.sort(byRecency)
  return { key, workspaceId, cwd, createdAt, label, sessions, nestedUnder }
}

/** Apply a stored Ungrouped order and append newly loose Sessions by recency. */
function orderedUngrouped(members: readonly SessionSummary[], stored: readonly string[]): SessionSummary[] {
  const byId = new Map(members.map(session => [session.id as string, session]))
  const included = new Set<string>()
  const ordered: SessionSummary[] = []
  for (const key of stored) {
    const session = byId.get(key)
    if (session === undefined || included.has(key)) continue
    ordered.push(session)
    included.add(key)
  }
  for (const session of [...members].sort(byRecency)) {
    if (included.has(session.id)) continue
    ordered.push(session)
  }
  return ordered
}

/**
 * Group Sessions by Host Workspace: one group per entity in stable Host
 * order, with members resolved from sessionIds in their stored order. Sessions
 * outside every Workspace trail in the browser-local Ungrouped order, which
 * falls back to recency before that order is initialized.
 */
function groupByWorkspace(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archived: ReadonlySet<SessionId>,
  ungroupedOrder: readonly string[] | undefined,
): Group[] {
  const groups: Group[] = []
  const accounted = new Set<SessionId>()
  for (const workspace of workspaces) {
    const members: SessionSummary[] = []
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id]
      if (summary === undefined) continue // account may lead the list pull; the row appears when the summary lands
      accounted.add(id)
      if (!sessionVisible(summary, list.current, archived)) continue
      members.push(summary)
    }
    groups.push(buildGroup(
      workspace.workspaceId, workspace.workspaceId, workspace.path,
      Date.parse(workspace.createdAt), workspace.title, members, 'account',
      // Wire defense: a view produced before the field existed nests nothing.
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- the wire type requires the field; a pre-field host's view does not
      workspace.nestedUnder ?? {},
    ))
  }
  const stray = list.ids
    .map(id => list.byId[id])
    .filter((s): s is SessionSummary =>
      s !== undefined && !accounted.has(s.id) && sessionVisible(s, list.current, archived))
  if (stray.length > 0) {
    groups.push(buildGroup(
      UNGROUPED_KEY,
      undefined,
      undefined,
      undefined,
      UNGROUPED_LABEL,
      ungroupedOrder === undefined ? stray : orderedUngrouped(stray, ungroupedOrder),
      ungroupedOrder === undefined ? 'recency' : 'account',
      {},
    ))
  }
  return groups
}

function sessionNode(
  s: SessionSummary,
  descendants: ReadonlyMap<SessionId, SubagentDescendantSummary>,
  children: readonly SessionNode[] = [],
): SessionNode {
  return {
    id: s.id,
    title: sessionTitle(s),
    blank: s.blank,
    running: s.running,
    runningSubagentCount: descendants.get(s.id)?.runningCount ?? 0,
    completed: s.completed === true,
    updatedAt: s.updatedAt,
    children,
    ...(s.pendingInteraction === undefined ? {} : { pendingInteraction: s.pendingInteraction }),
  }
}

/**
 * Project one group's visible members into nested rows: a member whose
 * placement parent is visible in the same group renders inside that parent's
 * branch (siblings keep the flat order), every other member is a top-level
 * row. Wire defense: a malformed placement cycle cannot recurse — each member
 * materializes at most once, and members unreachable from any top-level row
 * fall back to top level.
 * @param members - visible group members in display order.
 * @param nestedUnder - the workspace's child → parent placement map.
 * @param descendants - running subagent-descendant index.
 * @returns top-level session nodes carrying their child branches.
 */
function nestGroupNodes(
  members: readonly SessionSummary[],
  nestedUnder: Readonly<Record<string, SessionId>>,
  descendants: ReadonlyMap<SessionId, SubagentDescendantSummary>,
): SessionNode[] {
  const visible = new Set<string>(members.map(member => member.id))
  const childrenOf = new Map<string, SessionSummary[]>()
  const top: SessionSummary[] = []
  for (const member of members) {
    const parent = nestedUnder[member.id]
    if (parent !== undefined && parent !== member.id && visible.has(parent)) {
      const siblings = childrenOf.get(parent) ?? []
      siblings.push(member)
      childrenOf.set(parent, siblings)
    } else {
      top.push(member)
    }
  }
  const materialized = new Set<string>()
  const toNode = (member: SessionSummary): SessionNode | undefined => {
    if (materialized.has(member.id)) return undefined
    materialized.add(member.id)
    const children = (childrenOf.get(member.id) ?? [])
      .map(toNode)
      .filter((node): node is SessionNode => node !== undefined)
    return sessionNode(member, descendants, children)
  }
  const nodes = top.map(toNode).filter((node): node is SessionNode => node !== undefined)
  for (const member of members) {
    if (materialized.has(member.id)) continue
    const node = toNode(member)
    if (node !== undefined) nodes.push(node)
  }
  return nodes
}

/**
 * Derive the workspace browser groups: sessions without a placement parent
 * are top-level rows, nested-fork children render inside their parent's
 * branch (workspace `nestedUnder` placement; an invisible parent promotes
 * its children to top level).
 *
 * Every group shows; sessions populate under expanded groups in the selected
 * local order. Blank sessions are excluded except for the selected
 * provisional New Session row; archived sessions are excluded everywhere.
 * Content search lives outside this derivation
 * (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot (`current` feeds containsCurrent).
 * @param workspaces - real workspaces in stable Host order.
 * @param archivedSessionIds - registry-global archive set.
 * @param view - local expansion arrays.
 * @returns group sections in render order.
 */
export function deriveGroups(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
  view: TreeView,
): GroupNode[] {
  const archived = new Set(archivedSessionIds)
  const expandedGroups = new Set(view.expandedGroups)
  const descendants = indexSubagentDescendants(list.byId)
  const currentGroup = list.current === undefined
    ? undefined
    : (workspaces.find(w => w.sessionIds.includes(list.current as SessionId))?.workspaceId as string | undefined)
        ?? UNGROUPED_KEY
  const groups: GroupNode[] = []
  for (const g of groupByWorkspace(list, workspaces, archived, view.ungroupedOrder)) {
    const expanded = expandedGroups.has(g.key)
    groups.push({
      key: g.key,
      workspaceId: g.workspaceId,
      cwd: g.cwd,
      createdAt: g.createdAt,
      label: g.label,
      sessionCount: g.sessions.length,
      expanded,
      containsCurrent: g.key === currentGroup,
      sessions: expanded ? nestGroupNodes(g.sessions, g.nestedUnder, descendants) : [],
    })
  }
  return groups
}

/**
 * Derive the flat session list ("In one list" mode): every session — fork
 * children included — as a top-level row, strictly newest-first. No grouping,
 * no parent/child adjacency. Content search lives outside this derivation
 * (see {@link deriveSearchResults}).
 * @param list - sessions list snapshot.
 * @param archivedSessionIds - registry-global archive set.
 * @returns flat rows in render order.
 */
export function deriveFlat(
  list: SessionListState,
  archivedSessionIds: readonly SessionId[],
): SessionNode[] {
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)
  const rows: SessionSummary[] = []
  for (const id of list.ids) {
    const s = list.byId[id]
    if (s === undefined || !sessionVisible(s, list.current, archived)) continue
    rows.push(s)
  }
  rows.sort(byRecency)
  return rows.map(session => sessionNode(session, descendants))
}

/**
 * Derive the archived-session view in durable archive-set order. Missing
 * summaries wait for the Session baseline; subagent children stay on their
 * parent-owned surfaces. Blank rows remain recoverable from the archive.
 * @param list - sessions list snapshot.
 * @param workspaces - retained Workspace accounting and display labels.
 * @param archivedSessionIds - registry-global archive set in Host order.
 * @returns archived rows with their retained Workspace context.
 */
export function deriveArchived(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[],
): ArchivedSessionNode[] {
  const descendants = indexSubagentDescendants(list.byId)
  const labels = workspaceLabelsBySession(workspaces)
  const included = new Set<SessionId>()
  const rows: ArchivedSessionNode[] = []
  for (const id of archivedSessionIds) {
    const summary = list.byId[id]
    if (summary === undefined || summary.origin === 'subagent' || included.has(id)) continue
    included.add(id)
    rows.push({
      session: sessionNode(summary, descendants),
      workspace: labels.get(id) ?? workspaceLabel(summary.cwd),
    })
  }
  return rows
}

/** Where one session sits inside a group's rows: its top-level row and the branch rows above it. */
export interface SessionPlace {
  /** Index of the top-level row that holds the session (the session itself, or its outermost ancestor). */
  index: number
  /** Nested-fork ancestors from the top-level row down to the direct parent; empty for a top-level session. */
  ancestors: readonly SessionId[]
}

/**
 * Locate a session among a group's rows, descending nested-fork branches.
 * Every hiding mechanism the tree has (the overflow cut, a folded branch) is
 * addressed by one of the two fields, so a reveal needs nothing else.
 * @param rows - the group's top-level rows in render order.
 * @param id - the session to find.
 * @returns its place, or `undefined` when no row in the group is the session.
 */
export function locateSession(rows: readonly SessionNode[], id: SessionId): SessionPlace | undefined {
  const descend = (node: SessionNode, ancestors: readonly SessionId[]): readonly SessionId[] | undefined => {
    if (node.id === id) return ancestors
    for (const child of node.children) {
      const found = descend(child, [...ancestors, node.id])
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const [index, node] of rows.entries()) {
    const ancestors = descend(node, [])
    if (ancestors !== undefined) return { index, ancestors }
  }
  return undefined
}

/** Relative-time bucket of a session row's trailing label. */
export type RelativeTimeUnit = 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years'

/** Structured relative time: the bucket plus its magnitude (0 for 'now'). */
export interface RelativeTime {
  unit: RelativeTimeUnit
  n: number
}

/**
 * Merge immediate title/Workspace substring matches with ranked Host content
 * matches. Local rows lead newest-first, content-only rows retain backend
 * order, and duplicate sessions receive the backend snippet in place.
 * @param list - session metadata authority.
 * @param workspaces - Workspace membership and display labels.
 * @param query - caller text; surrounding whitespace is ignored.
 * @param archivedSessionIds - registry-global archive set (members never match).
 * @param content - ranked Host content-search page.
 * @param limit - protocol-owned maximum merged row count.
 * @returns bounded deduplicated flat rows and a refine-query hint bit.
 */
export function deriveSearchResults(
  list: SessionListState,
  workspaces: readonly WorkspaceView[],
  query: string,
  archivedSessionIds: readonly SessionId[],
  content: { items: readonly SessionSearchResultItem[]; hasMore: boolean },
  limit: number,
): SearchResultSet {
  const q = query.trim().toLowerCase()
  if (q === '') return { items: [], hasMore: false }
  const archived = new Set(archivedSessionIds)
  const descendants = indexSubagentDescendants(list.byId)

  const workspaceBySession = workspaceLabelsBySession(workspaces)
  const labelOf = (summary: SessionSummary): string =>
    workspaceBySession.get(summary.id) ?? workspaceLabel(summary.cwd)
  const contentBySession = new Map<SessionId, SessionSearchResultItem>()
  for (const item of content.items) {
    if (!contentBySession.has(item.sessionId)) contentBySession.set(item.sessionId, item)
  }

  const local: SessionSummary[] = []
  for (const id of list.ids) {
    const summary = list.byId[id]
    // Blank placeholders never match a query (their canonical title displays
    // localized, so matching it would tie search to one language).
    if (summary === undefined || summary.blank || !sessionVisible(summary, list.current, archived)) continue
    if (
      sessionTitle(summary).toLowerCase().includes(q)
      || labelOf(summary).toLowerCase().includes(q)
    ) {
      local.push(summary)
    }
  }
  local.sort(byRecency)

  const ordered: SessionSummary[] = []
  const included = new Set<SessionId>()
  const include = (summary: SessionSummary): void => {
    if (included.has(summary.id)) return
    included.add(summary.id)
    ordered.push(summary)
  }
  for (const summary of local) include(summary)
  for (const item of content.items) {
    const summary = list.byId[item.sessionId]
    if (summary !== undefined && !summary.blank && sessionVisible(summary, list.current, archived)) include(summary)
  }

  return {
    items: ordered.slice(0, limit).map((summary) => {
      const match = contentBySession.get(summary.id)
      return {
        id: summary.id,
        title: sessionTitle(summary),
        workspace: labelOf(summary),
        running: summary.running,
        runningSubagentCount: descendants.get(summary.id)?.runningCount ?? 0,
        ...(summary.pendingInteraction === undefined
          ? {}
          : { pendingInteraction: summary.pendingInteraction }),
        completed: summary.completed === true,
        ...match === undefined ? {} : { snippet: match.snippet },
      }
    }),
    hasMore: content.hasMore || ordered.length > limit,
  }
}

/**
 * Compact relative time for session rows, as a structured bucket the
 * renderer localizes ("now"/"5min"/"3h"/"2d"/"4mo"/"1y" in en).
 * @param updatedAt - epoch ms of the session's last activity.
 * @param now - current epoch ms (injected for pure rendering).
 * @returns the row's trailing time bucket and magnitude.
 */
export function relativeTime(updatedAt: number, now: number): RelativeTime {
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  const diff = Math.max(0, now - updatedAt)
  if (diff < MIN) return { unit: 'now', n: 0 }
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MIN) }
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) }
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) }
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) }
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) }
}
