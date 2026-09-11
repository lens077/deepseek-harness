/**
 * The sidebar's inbox entry: one row under New Session that toggles the
 * center-column panel and carries the state counts the user asked for —
 * sessions waiting for the user, finished unread (the panel's 已完成
 * section), running, and failed, in the order the digest settings page
 * sets, plus an optional grey count of finished sessions already seen — so
 * the picture is visible without opening anything. It renders the same two
 * states as the New Session control above it: a labelled row with one pill
 * per non-zero count while the column is wide; on the rail, one pill with
 * the sum, toned by the first state present.
 */
import { useEffect, useMemo } from 'react'
import clsx from 'clsx'
import { IconChecklistOutline14, IconGaugeOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DigestNavEntryProps } from './contract/slots.ts'
import type { NavBadgeState } from '../nav-settings.ts'
import { selectInbox } from './select.ts'
import css from './DigestNavEntry.module.css'

/** Pill tone per orderable state. */
const TONES: Record<NavBadgeState, string | undefined> = {
  waiting: css.badgeWaiting,
  unread: css.badgeUnread,
  running: css.badgeRunning,
  failed: css.badgeFailed,
}

/**
 * Whether the event is the panel's toggle chord. `code` addresses the digit
 * row's physical key so layouts that shift `1` still reach it, with `key` as
 * the fallback for layouts that report no code.
 * @param event - the keyboard event.
 * @returns whether the chord matches.
 */
function isToggleChord(event: KeyboardEvent): boolean {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
  return event.code === 'Digit1' || event.key === '1'
}

/**
 * Render the inbox toggle row.
 * @param props - composed slot props (owner wide flag + store share + inbox and settings hooks + locale).
 * @returns the entry element.
 */
export function DigestNavEntry({
  wide, mobileView, navigateMobile, useStore, actions, useSessions, useWorkspaces,
  useSessionPendingInteraction, useInbox, useNavSettings, t,
}: DigestNavEntryProps) {
  const open = useStore(s => s.open)
  const showBadges = useNavSettings(v => v.navBadges)
  const showFinished = useNavSettings(v => v.navFinishedBadge)
  const order = useNavSettings(v => v.navBadgeOrder)
  const rows = useSessions(s => s.ids.map(id => s.byId[id]).filter(row => row !== undefined))
  const workspaces = useWorkspaces(s => s.items)
  const archived = useWorkspaces(s => s.archivedSessionIds)
  const inbox = useInbox(v => v.snapshot)
  const pending = useSessionPendingInteraction(value => value)
  const ungroupedLabel = t('panel.ungrouped')
  const counts = useMemo(() => {
    const hidden = new Set(archived)
    // The window and filter do not affect the state counts, which are
    // computed over every row before admission.
    const selection = selectInbox(rows.filter(row => !hidden.has(row.id)), workspaces, inbox, {
      now: Date.now(), window: 'all', workspace: undefined, showHandled: false, ungroupedLabel,
      pendingSessionIds: new Set(pending.keys()),
    })
    return {
      waiting: selection.waitingCount,
      unread: selection.unreadCount,
      running: selection.runningCount,
      failed: selection.failedCount,
      finished: selection.seenCount,
    }
  }, [rows, workspaces, archived, inbox, pending, ungroupedLabel])
  const pills = showBadges
    ? [
      ...order.map(state => ({ key: state as string, count: counts[state], tone: TONES[state], text: t(`nav.${state}`, { count: counts[state] }) })),
      ...(showFinished ? [{ key: 'finished', count: counts.finished, tone: css.badgeFinished, text: t('nav.finished', { count: counts.finished }) }] : []),
    ].filter(pill => pill.count > 0)
    : []
  const label = [t('nav.label'), ...pills.map(pill => pill.text)].join(' · ')
  const total = pills.reduce((sum, pill) => sum + pill.count, 0)
  // The rail has room for one pill: the sum, in the tone of the first
  // state present.
  const rail = pills[0]

  // The entry is mounted for the whole session, wide or railed, so it owns the
  // keyboard path to its own action. The chord carries a modifier, so it stays
  // live inside the composer and the panel's own inputs — reaching the inbox
  // mid-sentence is the point — unlike the panel's single-letter triage ring.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isToggleChord(event)) return
      event.preventDefault()
      if (mobileView !== undefined) navigateMobile?.(mobileView === 'overview' ? 'conversation' : 'overview')
      else actions.toggle()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [actions, mobileView, navigateMobile])

  if (mobileView !== undefined) {
    const attention = counts.waiting + counts.unread
    // The small phone layout hides the labels, so the two entries must differ
    // by glyph alone: the overview takes the gauge, the pending list keeps
    // the checklist the sidebar entry uses.
    return (
      <>
        <button type="button" className={css.mobileEntry} aria-label={t('mobile.overview')} aria-current={mobileView === 'overview' ? 'page' : undefined}
          onClick={() => { navigateMobile?.('overview') }}>
          <IconGaugeOutline16 size={20} />
          <span className={css.mobileLabel}>{t('mobile.overview')}</span>
        </button>
        <button type="button" className={css.mobileEntry}
          aria-label={attention > 0 ? `${t('mobile.pending')} · ${t('panel.attention', { count: attention })}` : t('mobile.pending')}
          aria-current={mobileView === 'pending' ? 'page' : undefined}
          onClick={() => { navigateMobile?.('pending') }}>
          <span className={css.mobileIcon}>
            <IconChecklistOutline14 size={20} />
            {attention > 0 && <span className={css.mobileBadge}>{attention}</span>}
          </span>
          <span className={css.mobileLabel}>{t('mobile.pending')}</span>
        </button>
      </>
    )
  }

  return (
    // The tooltip states the shortcut in both column states: railed it also
    // names the entry, wide it carries the one fact the row cannot show.
    <Tooltip label={`${label} · ${t('nav.shortcut')}`} delayMs={500}>
      <button
        type="button"
        className={clsx(css.entry, !wide && css.rail, open && css.active)}
        aria-label={label}
        aria-pressed={open}
        onClick={() => { actions.toggle() }}
      >
        <IconChecklistOutline14 size={wide ? 14 : 18} />
        {wide && <span className={css.label}>{t('nav.label')}</span>}
        {wide && pills.length > 0 && (
          <span className={css.badges}>
            {pills.map(pill => (
              <span key={pill.key} className={clsx(css.badge, pill.tone)} data-state={pill.key}>
                {pill.count}
              </span>
            ))}
          </span>
        )}
        {!wide && rail !== undefined && (
          <span className={clsx(css.badge, css.badgeRail, rail.tone)} data-state={rail.key}>
            {total}
          </span>
        )}
      </button>
    </Tooltip>
  )
}
