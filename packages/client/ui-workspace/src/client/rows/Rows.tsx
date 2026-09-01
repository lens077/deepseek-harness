/**
 * Workspace browser tree row components (figma Cell set 14:3080): pure presentational —
 * all data and callbacks arrive via props. Hover swaps (folder->chevron,
 * time->ellipsis, action buttons) are CSS-only. Row ... menus are visual-only
 * except workspace Rename/Delete and session Rename/Fork/Archive/Unarchive;
 * session and workspace hover cards are suppressed while a menu is open.
 */
import { useState } from 'react'
import clsx from 'clsx'
import {
  HoverCard, IconArchiveOutline20, IconBranchOutline16, IconEditOutline16,
  IconEllipsisOutline16, IconFolderClose16, IconFolderOpen16, IconFolderOpenOutline16, IconPlusOutline16,
  IconTrashOutline16, IconTriangleRightFill14, Menu, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import { abbreviateHomePath } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { ArchivedSessionNode, GroupNode, SearchResultNode, SessionNode } from '../tree.ts'
import { relativeTime } from '../tree.ts'
import css from './Rows.module.css'

/** The standard locale seat, prop-passed from the browser root. */
type RowTranslate = WorkspaceBrowserProps['t']

/** Row display title: blank rows show the localized New Session label. */
function displayTitle(node: SessionNode, t: RowTranslate): string {
  return node.blank ? t('session.new') : node.title
}

/** Localized compact relative time ("刚刚"/"5分钟" in zh, "now"/"5min" in en). */
function timeLabel(updatedAt: number, now: number, t: RowTranslate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

/** Hover-card variant: distances wrap in the ago template; the now bucket stays bare (no "now ago"). */
function hoverTimeLabel(updatedAt: number, now: number, t: RowTranslate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t('time.ago', { t: t(`time.${unit}`, { n }) })
}

/**
 * Absolute creation time through the dictionary's date template (the message
 * clock pattern): `toLocaleString` would follow the browser language, not the
 * app locale, and produce mixed-language text after a switch.
 */
function createdLabel(createdAt: number, t: RowTranslate): string {
  const d = new Date(createdAt)
  const pad2 = (v: number): string => String(v).padStart(2, '0')
  const date = t('date.ymd', { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })
  return t('hover.created', { time: `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` })
}

/** Hover-card body: workspace title, display directory path, absolute creation time. */
function WorkspaceHoverContent({ label, cwd, createdAt, t }: {
  label: string
  cwd: string | undefined
  createdAt: number
  t: RowTranslate
}) {
  return (
    <div className={css.hoverContent}>
      <div className={css.hoverTitle}>{label}</div>
      <div className={css.hoverPath}>{cwd}</div>
      <div className={css.hoverTime}>{createdLabel(createdAt, t)}</div>
    </div>
  )
}

/**
 * Row drag wiring supplied by the tree owner. `drop` reports the half of the
 * row where the pointer released so the owner can resolve an insert anchor.
 */
export interface RowDragProps {
  /** Start dragging this row. */
  start: () => void
  /** A compatible row drag is in flight. */
  active: boolean
  /** Current marker on this row: insert line above, below, or none. */
  marker: 'before' | 'after' | null
  /** Report the hovered half while a compatible drag passes over this row. */
  hover: (half: 'before' | 'after') => void
  drop: (half: 'before' | 'after') => void
  end: () => void
}

/** Drag lifecycle owned by a workspace row; its enclosing group owns hit testing. */
interface WorkspaceRowDragProps {
  start: () => void
  end: () => void
}

/**
 * The modifier state a row activation carries to its owner. Only the flags
 * matter here: the owner maps them onto the platform's selection semantics,
 * so rows stay free of platform knowledge.
 */
export interface RowActivationEvent {
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

/** Pointer coordinates used to anchor the selection-aware context menu. */
export interface RowContextMenuEvent {
  readonly clientX: number
  readonly clientY: number
}

/** Pointer-position half of a row (insert line above or below). */
function rowHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

/**
 * Project (workspace) header row: folder + title;
 * hover reveals the chevron and create button, and dwelling on a real
 * Workspace shows its hover card (the ungrouped bucket has none).
 * `containsCurrent` arrives on the node (derivation fact, no renderer scan).
 * @param props.group - derived group node.
 * @param props.onToggle - expand/collapse the group.
 * @param props.onCreate - start a frontend Session inside this Workspace.
 * @param props.drag - optional workspace-row drag wiring.
 * @param props.home - host account home for POSIX hover-path abbreviation.
 * @param props.t - the browser root's locale seat.
 * @returns the row element.
 */
export function ProjectRowItem({ group, onToggle, onCreate, actions, drag, home, t }: {
  group: GroupNode
  onToggle: () => void
  onCreate: () => void
  /** Real-Workspace actions; absent for the ungrouped bucket (no menu shown). */
  actions?: { rename: () => void; delete: () => void } | undefined
  /** Present only for real Workspace rows in the grouped view. */
  drag?: WorkspaceRowDragProps | undefined
  /** Host account home; POSIX home-rooted hover paths display as `~`. */
  home?: string | undefined
  t: RowTranslate
}) {
  const row = group
  // The ungrouped bucket has no workspace title: its label is dictionary copy.
  const label = row.workspaceId === undefined ? t('group.ungrouped') : row.label
  const active = group.expanded && group.containsCurrent
  const [menuOpen, setMenuOpen] = useState(false)
  const workspaceMenuItems = [
    { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
    { id: 'delete', label: t('delete.workspace'), icon: <IconTrashOutline16 />, danger: true },
  ]
  const ownRow = (
    <div
      className={clsx(css.projectRow, menuOpen && css.menuOpen)}
      role="treeitem"
      aria-expanded={row.expanded}
      onClick={onToggle}
      draggable={drag !== undefined}
      onDragStart={drag === undefined
        ? undefined
        : (e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', row.key)
          drag.start()
        }}
      onDragEnd={drag?.end}
    >
      <span className={clsx(css.slot, css.folder, active && css.folderActive)}>
        {row.expanded ? <IconFolderOpen16 /> : <IconFolderClose16 />}
      </span>
      <span className={clsx(css.slot, css.chevron)}>
        <IconTriangleRightFill14 className={clsx(css.arrow, row.expanded && css.arrowOpen)} />
      </span>
      <span className={css.projectText}>
        <span className={css.title}>{label}</span>
      </span>
      <span className={css.rowActions}>
        {actions !== undefined && (
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={workspaceMenuItems}
            onSelect={(id) => {
              setMenuOpen(false)
              // Unknown ids leave before the dispatch: a future menu row must
              // not inherit the destructive branch as an else fallback.
              /* v8 ignore next -- workspaceMenuItems carries exactly these two rows today. */
              if (id !== 'rename' && id !== 'delete') return
              if (id === 'rename') actions.rename()
              else actions.delete()
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('actions.workspace.aria', { name: label })}
                onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
              >
                <IconEllipsisOutline16 />
              </button>
            )}
          />
        )}
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('actions.newSession.aria', { name: label })}
          onClick={(e) => { e.stopPropagation(); onCreate() }}
        >
          <IconPlusOutline16 />
        </button>
      </span>
    </div>
  )
  // The ungrouped bucket has no backing Workspace: no card to show.
  if (row.createdAt === undefined) return ownRow
  return (
    <HoverCard
      anchor={ownRow}
      content={<WorkspaceHoverContent
        label={row.label}
        cwd={row.cwd === undefined ? undefined : abbreviateHomePath(row.cwd, home)}
        createdAt={row.createdAt}
        t={t}
      />}
      disabled={menuOpen}
      copyText={row.cwd}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}

/* v8 ignore next 3 -- closed-union backstop; only reached if the status is forged */
function assertNever(value: never): never {
  throw new Error(`unknown pending interaction: ${String(value)}`)
}

interface SessionStatus {
  state: StateDotState
  label: string
}

/**
 * Session status presentation; pending interaction is primary and live activity
 * outranks completion reminders.
 */
function sessionStatuses(
  node: Pick<SessionNode, 'pendingInteraction' | 'running' | 'runningSubagentCount' | 'completed'>,
  t: RowTranslate,
): readonly [SessionStatus, ...SessionStatus[]] {
  const subagents: SessionStatus | undefined = node.runningSubagentCount === 0
    ? undefined
    : {
      state: 'ongoing',
      label: t(
        node.runningSubagentCount === 1
          ? 'status.subagentsRunning.one'
          : 'status.subagentsRunning.other',
        { n: node.runningSubagentCount },
      ),
    }
  let pending: SessionStatus | undefined
  switch (node.pendingInteraction) {
    case 'approval':
      pending = { state: 'warning', label: t('status.waitingApproval') }
      break
    case 'plan-review':
      pending = { state: 'warning', label: t('status.planReview') }
      break
    case 'question':
      pending = { state: 'warning', label: t('status.waitingAnswer') }
      break
    case undefined: break
    /* v8 ignore next -- closed PendingInteractionStatus union */
    default: return assertNever(node.pendingInteraction)
  }
  if (pending !== undefined) return subagents === undefined ? [pending] : [pending, subagents]
  if (node.running) {
    const primary: SessionStatus = { state: 'ongoing', label: t('status.running') }
    return subagents === undefined ? [primary] : [primary, subagents]
  }
  if (subagents !== undefined) return [subagents]
  if (node.completed) return [{ state: 'done', label: t('status.completed') }]
  return [{ state: 'done', label: t('status.idle') }]
}

/** Primary status dot plus every status's screen-reader label, shared by the search and session rows. */
function SessionStatusDots({ statuses }: { statuses: readonly [SessionStatus, ...SessionStatus[]] }) {
  return (
    <>
      <StateDot state={statuses[0].state} />
      {statuses.map(status => (
        <span className={css.visuallyHidden} key={status.label}>{status.label}</span>
      ))}
    </>
  )
}

/** Hover-card body: full title, relative time, and every relevant live status. */
function SessionHoverContent({ node, now, t }: { node: SessionNode; now: number; t: RowTranslate }) {
  const statuses = sessionStatuses(node, t)
  return (
    <div className={css.hoverContent}>
      <div className={css.hoverTitle}>{displayTitle(node, t)}</div>
      {/* Same placeholder rule as the row's trailing cell: no timestamp
          before the first prompt. */}
      {!node.blank && <div className={css.hoverTime}>{hoverTimeLabel(node.updatedAt, now, t)}</div>}
      {statuses.map(status => (
        <div className={css.hoverStatus} key={status.label}>
          <StateDot state={status.state} />
          <span>{status.label}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * One flat search result: title, Workspace context, and optional content
 * excerpt. Search navigation opens the session only; it does not address an
 * event inside the conversation.
 * @param props.result - merged local/content search row.
 * @param props.currentId - selected session id.
 * @param props.onOpen - open the selected session, carrying gesture modifiers.
 * @param props.multiSelected - the row is in the multi-selection set.
 * @param props.multiLead - the row is the selection lead.
 * @param props.t - Workspace-browser translation seat.
 * @returns the result button.
 */
export function SearchResultItem({ result, currentId, onOpen, onContextMenu, multiSelected = false, multiLead = false, t }: {
  result: SearchResultNode
  currentId: string | undefined
  onOpen: (id: SearchResultNode['id'], event: RowActivationEvent) => void
  onContextMenu?: (id: SearchResultNode['id'], event: RowContextMenuEvent) => void
  /** The row belongs to the current multi-selection. */
  multiSelected?: boolean | undefined
  /** The row is the selection lead that arrow keys move and Shift extends to. */
  multiLead?: boolean | undefined
  t: RowTranslate
}) {
  const selected = result.id === currentId
  const statuses = sessionStatuses(result, t)
  const primaryStatus = statuses[0]
  return (
    <button
      type="button"
      className={clsx(
        css.searchResultRow, selected && css.selected,
        multiSelected && css.multiSelected, multiLead && css.multiLead,
      )}
      role="treeitem"
      aria-selected={multiSelected || selected}
      onClick={(e) => { onOpen(result.id, e) }}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu?.(result.id, e)
      }}
    >
      <span className={css.searchResultHeading}>
        <span className={css.slot}>
          {(primaryStatus.state !== 'done' || result.completed) && (
            <SessionStatusDots statuses={statuses} />
          )}
        </span>
        <span className={css.searchResultTitle}>{result.title}</span>
      </span>
      <span className={css.searchResultMeta}>
        <span className={css.searchResultWorkspace}>{result.workspace}</span>
        {result.snippet !== undefined && (
          <span className={css.searchResultSnippet}>{result.snippet}</span>
        )}
      </span>
    </button>
  )
}

/**
 * One archived Session row: retained Workspace context with unarchive and
 * permanent-delete actions, without open, reorder, rename, fork, or selection.
 * @param props.node - archived session projection.
 * @param props.now - epoch ms for relative-time formatting.
 * @param props.busy - the unarchive mutation is awaiting its state echo.
 * @param props.onUnarchive - remove this Session from the archive set.
 * @param props.onDelete - request permanent deletion for this Session.
 * @param props.t - the browser root's locale seat.
 * @returns the archived session row.
 */
export function ArchivedSessionItem({ node, now, busy, onUnarchive, onDelete, t }: {
  node: ArchivedSessionNode
  now: number
  busy: boolean
  onUnarchive: (id: SessionNode['id']) => void
  onDelete: (id: SessionNode['id']) => void
  t: RowTranslate
}) {
  const title = displayTitle(node.session, t)
  const statuses = sessionStatuses(node.session, t)
  const primaryStatus = statuses[0]
  const showStatus = primaryStatus.state !== 'done' || node.session.completed
  const [menuOpen, setMenuOpen] = useState(false)
  const ownRow = (
    <div
      className={clsx(css.searchResultRow, css.archivedSessionRow, menuOpen && css.menuOpen)}
      role="treeitem"
      aria-busy={busy || undefined}
    >
      <span className={css.searchResultHeading}>
        <span className={css.slot}>
          {showStatus && <SessionStatusDots statuses={statuses} />}
        </span>
        <span className={css.searchResultTitle}>{title}</span>
        {busy
          ? <span className={css.time}>{t('unarchive.pending')}</span>
          : <span className={css.time}>{timeLabel(node.session.updatedAt, now, t)}</span>}
        <span className={css.rowActions}>
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={[
              { id: 'unarchive', label: t('menu.unarchiveSession'), icon: <IconArchiveOutline20 size={16} /> },
              { id: 'delete', label: t('menu.deleteSession'), icon: <IconTrashOutline16 />, danger: true },
            ]}
            onSelect={(id) => {
              setMenuOpen(false)
              if (id === 'unarchive') onUnarchive(node.session.id)
              if (id === 'delete') onDelete(node.session.id)
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('actions.session.aria', { name: title })}
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation()
                  setMenuOpen(value => !value)
                }}
              >
                <IconEllipsisOutline16 />
              </button>
            )}
          />
        </span>
      </span>
      <span className={css.searchResultMeta}>
        <span className={css.searchResultWorkspace}>{node.workspace}</span>
      </span>
    </div>
  )
  return (
    <HoverCard
      anchor={ownRow}
      content={<SessionHoverContent node={node.session} now={now} t={t} />}
      disabled={menuOpen}
      copyText={node.session.blank ? undefined : node.session.title}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}

/**
 * One top-level 34px session row: status dot (pending user interaction outranks
 * own or descendant activity), title, relative time, and the row actions menu.
 * @param props.node - derived session node.
 * @param props.currentId - selected session id (row highlight).
 * @param props.now - epoch ms for relative-time formatting.
 * @param props.onOpen - open a session by id, carrying the gesture's modifiers.
 * @param props.onRename - open the session rename dialog (id + current title).
 * @param props.onFork - fork a session at its last completed turn into the picked display slot.
 * @param props.onDirectories - open the session-directory manager.
 * @param props.onArchive - archive a session by id.
 * @param props.drag - optional draggable-row wiring.
 * @param props.flat - omit the empty status slot in the hierarchy-free flat list.
 * @param props.branch - nested-children affordance (chevron + count) for rows with a child branch.
 * @param props.multiSelected - the row is in the multi-selection set.
 * @param props.multiLead - the row is the selection lead (arrow-key cursor).
 * @param props.t - the browser root's locale seat.
 * @returns the session row.
 */
export function SessionNodeItem({
  node, currentId, now, onOpen, onContextMenu, onRename, onFork, onDirectories, onArchive, onDelete,
  drag, flat = false, branch, multiSelected = false, multiLead = false, t,
}: {
  node: SessionNode
  currentId: string | undefined
  now: number
  /**
   * Activate the row. The event carries the modifier keys so the owner can
   * apply range or toggle selection; a plain click still opens the session.
   */
  onOpen: (id: SessionNode['id'], event: RowActivationEvent) => void
  /** Open the browser-owned selection action menu at the pointer. */
  onContextMenu?: (id: SessionNode['id'], event: RowContextMenuEvent) => void
  /** Open the browser-owned session rename dialog (row menu action). */
  onRename: (id: SessionNode['id'], currentTitle: string) => void
  /** Fork a session at its last completed turn into the picked display slot (row menu actions). */
  onFork: (id: SessionNode['id'], placement: 'sibling' | 'nested') => void
  /** Open the browser-owned directory manager; absent where no manager is composed in. */
  onDirectories?: ((id: SessionNode['id']) => void) | undefined
  /** Archive this session (row menu action; commits without a dialog). */
  onArchive: (id: SessionNode['id']) => void
  /** Request permanent deletion for this Session lineage. */
  onDelete: (id: SessionNode['id']) => void
  /** Present only on draggable rows (workspace-group sessions outside search). */
  drag?: RowDragProps | undefined
  /** The row is rendered without a parent Workspace header. */
  flat?: boolean | undefined
  /** Present only on rows with nested children: expansion state + toggle. */
  branch?: { expanded: boolean; toggle: () => void } | undefined
  /** The row belongs to the current multi-selection. */
  multiSelected?: boolean | undefined
  /** The row is the selection lead that arrow keys move and Shift extends to. */
  multiLead?: boolean | undefined
  t: RowTranslate
}) {
  const row = node
  const title = displayTitle(node, t)
  const selected = node.id === currentId
  const statuses = sessionStatuses(node, t)
  const primaryStatus = statuses[0]
  const showStatus = primaryStatus.state !== 'done' || row.completed
  const [menuOpen, setMenuOpen] = useState(false)
  // Archive hides the row through the registry-global archive set and never
  // touches the session log, so it is not styled as destructive and needs no
  // confirmation dialog.
  const sessionMenuItems = [
    ...row.blank ? [] : [
      { id: 'rename', label: t('rename'), icon: <IconEditOutline16 /> },
      { id: 'fork', label: t('menu.forkSibling'), icon: <IconBranchOutline16 /> },
      { id: 'fork-nested', label: t('menu.forkNested'), icon: <IconBranchOutline16 /> },
    ],
    ...onDirectories === undefined
      ? []
      : [{ id: 'directories', label: t('menu.sessionDirectories'), icon: <IconFolderOpenOutline16 /> }],
    ...row.blank ? [] : [
      // 20-native glyph in the menu's 16px icon slot (Menu.module.css .itemIcon).
      { id: 'archive', label: t('menu.archiveSession'), icon: <IconArchiveOutline20 size={16} /> },
      { id: 'delete', label: t('menu.deleteSession'), icon: <IconTrashOutline16 />, danger: true },
    ],
  ]
  // Figma session cell: pad 8, status slot 16, then a 4px title gap.
  const ownRow = (
    <div
      className={clsx(
        css.sessionRow, selected && css.selected, menuOpen && css.menuOpen,
        multiSelected && css.multiSelected, multiLead && css.multiLead,
        flat && !showStatus && css.flatSessionRowWithoutStatus,
        drag?.marker === 'before' && css.dropBefore, drag?.marker === 'after' && css.dropAfter,
      )}
      role="treeitem"
      // With multi-selection live, aria-selected reports the selection set;
      // otherwise it keeps reporting the opened session, which is the only
      // selection concept the row has.
      aria-selected={multiSelected || selected}
      onClick={(e) => { onOpen(node.id, e) }}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu?.(node.id, e)
      }}
      draggable={drag !== undefined}
      onDragStart={drag === undefined
        ? undefined
        : (e) => {
          // A modified press is a selection gesture: starting a reorder drag
          // from it would both move the row and lose the selection.
          if (e.ctrlKey || e.metaKey || e.shiftKey) {
            e.preventDefault()
            return
          }
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', node.id)
          drag.start()
        }}
      onDragEnd={drag?.end}
      onDragOver={drag === undefined
        ? undefined
        : (e) => {
          if (!drag.active) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          drag.hover(rowHalf(e))
        }}
      onDrop={drag === undefined
        ? undefined
        : (e) => {
          if (!drag.active) return
          e.preventDefault()
          drag.drop(rowHalf(e))
        }}
    >
      {/* A row with nested children carries its own expand affordance; the
          chevron replaces nothing — it leads the status slot. */}
      {branch !== undefined && (
        <button
          type="button"
          className={css.branchChevron}
          aria-expanded={branch.expanded}
          aria-label={t('branch.aria', { n: node.children.length })}
          onClick={(e) => { e.stopPropagation(); branch.toggle() }}
        >
          <IconTriangleRightFill14 className={clsx(css.branchGlyph, branch.expanded && css.branchGlyphOpen)} />
        </button>
      )}
      {/* Pending interaction and own or descendant activity outrank the
          finished-but-unviewed reminder, which returns after activity stops
          and is cleared by opening the session. */}
      {(!flat || showStatus) && (
        <span className={css.slot}>
          {showStatus && <SessionStatusDots statuses={statuses} />}
        </span>
      )}
      <span className={css.title}>{title}</span>
      {branch !== undefined && (
        <span className={css.branchCount}>{node.children.length}</span>
      )}
      {/* A blank New Session row is a provisional placeholder: nothing has
          happened in it yet, so a "now" timestamp and the content verbs
          (rename/fork/archive) would act on content that does not exist —
          only the session-level directory policy can be set before the
          first prompt. */}
      {!row.blank && <span className={css.time}>{timeLabel(row.updatedAt, now, t)}</span>}
      {(!row.blank || onDirectories !== undefined) && (
        <span className={css.rowActions}>
          <Menu
            open={menuOpen}
            onClose={() => { setMenuOpen(false) }}
            items={sessionMenuItems}
            onSelect={(id) => {
              setMenuOpen(false)
              if (id === 'rename') onRename(node.id, row.title)
              if (id === 'fork') onFork(node.id, 'sibling')
              if (id === 'fork-nested') onFork(node.id, 'nested')
              if (id === 'directories') onDirectories?.(node.id)
              if (id === 'archive') onArchive(node.id)
              if (id === 'delete') onDelete(node.id)
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('actions.session.aria', { name: title })}
                onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
              >
                <IconEllipsisOutline16 />
              </button>
            )}
          />
        </span>
      )}
    </div>
  )
  return (
    <HoverCard
      anchor={ownRow}
      content={<SessionHoverContent node={node} now={now} t={t} />}
      // A hover card over a row the user is ranging across is pure noise, so
      // any live multi-selection suppresses it.
      disabled={menuOpen || drag?.active === true || multiSelected}
      copyText={row.blank ? undefined : row.title}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  )
}

/** Shared row callbacks/context one branch passes unchanged to every row it renders. */
export interface SessionRowContext {
  currentId: string | undefined
  now: number
  onOpen: (id: SessionNode['id'], event: RowActivationEvent) => void
  onContextMenu: (id: SessionNode['id'], event: RowContextMenuEvent) => void
  onRename: (id: SessionNode['id'], currentTitle: string) => void
  onFork: (id: SessionNode['id'], placement: 'sibling' | 'nested') => void
  onDirectories?: ((id: SessionNode['id']) => void) | undefined
  onArchive: (id: SessionNode['id']) => void
  onDelete: (id: SessionNode['id']) => void
  isSelected: (id: SessionNode['id']) => boolean
  isLead: (id: SessionNode['id']) => boolean
  t: RowTranslate
}

/**
 * One session row plus its nested-child branch, recursively. Children render
 * inside an indented, guide-lined container; a folded parent renders its row
 * alone. Drag wiring applies to THIS row only and is never passed down, so
 * reordering stays a top-level flat-account operation.
 * @param props.node - the branch root.
 * @param props.row - shared row callbacks/context.
 * @param props.drag - optional drag wiring for the root row.
 * @param props.collapsedBranches - ids whose branches are currently folded.
 * @param props.onToggleBranch - fold/unfold one parent row's branch.
 * @returns the branch fragment.
 */
export function SessionBranch({ node, row, drag, collapsedBranches, onToggleBranch }: {
  node: SessionNode
  row: SessionRowContext
  drag?: RowDragProps | undefined
  collapsedBranches: readonly string[]
  onToggleBranch: (id: SessionNode['id']) => void
}) {
  const hasChildren = node.children.length > 0
  const expanded = !collapsedBranches.includes(node.id)
  return (
    <>
      <SessionNodeItem
        node={node}
        currentId={row.currentId}
        now={row.now}
        onOpen={row.onOpen}
        onContextMenu={row.onContextMenu}
        onRename={row.onRename}
        onFork={row.onFork}
        onDirectories={row.onDirectories}
        onArchive={row.onArchive}
        onDelete={row.onDelete}
        drag={drag}
        branch={hasChildren ? { expanded, toggle: () => { onToggleBranch(node.id) } } : undefined}
        multiSelected={row.isSelected(node.id)}
        multiLead={row.isLead(node.id)}
        t={row.t}
      />
      {hasChildren && expanded && (
        <div className={css.childBranch} role="group">
          {node.children.map(child => (
            <SessionBranch
              key={child.id}
              node={child}
              row={row}
              collapsedBranches={collapsedBranches}
              onToggleBranch={onToggleBranch}
            />
          ))}
        </div>
      )}
    </>
  )
}
