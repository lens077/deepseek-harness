/**
 * The sidebar's inbox entry: one row under New Session that toggles the
 * center-column panel and carries the attention count — how many sessions
 * are waiting for the user, failed, or finished unread — so the count is
 * visible without opening anything. It renders the same two states as the New
 * Session control above it: a labelled row while the column is wide, a single
 * icon on the rail.
 */
import { useMemo } from 'react'
import clsx from 'clsx'
import { IconChecklistOutline14, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DigestNavEntryProps } from './contract/slots.ts'
import { selectInbox } from './select.ts'
import css from './DigestNavEntry.module.css'

/**
 * Render the inbox toggle row.
 * @param props - composed slot props (owner wide flag + store share + inbox hook + locale).
 * @returns the entry element.
 */
export function DigestNavEntry({ wide, useStore, actions, useSessions, useWorkspaces, useInbox, t }: DigestNavEntryProps) {
  const open = useStore(s => s.open)
  const rows = useSessions(s => s.ids.map(id => s.byId[id]).filter(row => row !== undefined))
  const workspaces = useWorkspaces(s => s.items)
  const archived = useWorkspaces(s => s.archivedSessionIds)
  const inbox = useInbox(v => v.snapshot)
  const ungroupedLabel = t('panel.ungrouped')
  const counts = useMemo(() => {
    const hidden = new Set(archived)
    // The window and filter do not affect the attention counts, which are
    // computed over every row before admission.
    const selection = selectInbox(rows.filter(row => !hidden.has(row.id)), workspaces, inbox, {
      now: Date.now(), window: 'all', workspace: undefined, showHandled: false, ungroupedLabel,
    })
    return { attention: selection.attentionCount, waiting: selection.waitingCount }
  }, [rows, workspaces, archived, inbox, ungroupedLabel])
  const label = counts.attention > 0
    ? `${t('nav.label')} · ${t('nav.badge', { attention: counts.attention })}`
    : t('nav.label')
  return (
    <Tooltip label={label} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={clsx(css.entry, !wide && css.rail, open && css.active)}
        aria-label={label}
        aria-pressed={open}
        onClick={() => { actions.toggle() }}
      >
        <IconChecklistOutline14 size={wide ? 14 : 18} />
        {wide && <span className={css.label}>{t('nav.label')}</span>}
        {counts.attention > 0 && (
          <span
            className={clsx(css.badge, counts.waiting > 0 && css.badgeUrgent, !wide && css.badgeRail)}
            data-attention={counts.attention}
          >
            {counts.attention}
          </span>
        )}
      </button>
    </Tooltip>
  )
}
