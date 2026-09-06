/** Mobile Workspace drill-down using the desktop browser's Session projection. */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  IconChevronLeftOutline14, IconChevronRightOutline14, IconFolderOpenOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import { deriveGroups, UNGROUPED_KEY, type SessionNode } from '../tree.ts'
import css from './MobileWorkspaceBrowser.module.css'

function flattenSessions(nodes: readonly SessionNode[]): SessionNode[] {
  return nodes.flatMap(node => [node, ...flattenSessions(node.children ?? [])])
}

/**
 * Render a Workspace list followed by the selected Workspace's complete Session list.
 * @param props - Framework data hooks and the sidebar's mobile navigation callbacks.
 * @returns Mobile browsing controls; opening a Session returns control to the owner.
 */
export function MobileWorkspaceBrowser({
  useSessions, useWorkspaces, useSessionPendingInteraction, useStore, open, onSessionOpened, t,
}: WorkspaceBrowserProps) {
  const list = useSessions(state => state)
  const workspaces = useWorkspaces(state => state)
  const pending = useSessionPendingInteraction(state => state)
  const orders = useStore(state => state.sessionOrderByAccount)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const browser = useRef<HTMLDivElement>(null)
  const previousKey = useRef<string | null>(null)
  const groups = useMemo(() => deriveGroups(
    list,
    workspaces.items.map((workspace) => {
      const order = orders[workspace.workspaceId]
      if (order === undefined) return workspace
      const positions = new Map(order.map((id, index) => [id, index]))
      return {
        ...workspace,
        sessionIds: [...workspace.sessionIds].sort((a, b) =>
          (positions.get(a) ?? order.length) - (positions.get(b) ?? order.length)),
      }
    }),
    workspaces.archivedSessionIds,
    pending,
    {
      expandedGroups: selectedKey === null ? [] : [selectedKey],
      ...(orders[UNGROUPED_KEY] === undefined ? {} : { ungroupedOrder: orders[UNGROUPED_KEY] }),
    },
  ), [list, workspaces, pending, orders, selectedKey])
  const selected = groups.find(group => group.key === selectedKey)
  const activeKey = selected?.key ?? null
  const label = selected === undefined || selected.workspaceId === undefined
    ? t('group.ungrouped') : selected.label
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matches = (text: string) => text.toLocaleLowerCase().includes(normalizedQuery)
  const visibleGroups = groups.filter(group => matches(
    `${group.workspaceId === undefined ? t('group.ungrouped') : group.label} ${group.cwd ?? ''}`,
  ))
  const sessions = flattenSessions(selected?.sessions ?? []).filter(session =>
    matches(session.blank ? t('session.new') : session.title))

  useEffect(() => {
    if (selectedKey !== null && selected === undefined && workspaces.phase === 'ready') {
      setSelectedKey(null)
    }
  }, [selectedKey, selected, workspaces.phase])

  useEffect(() => {
    if (previousKey.current === activeKey) return
    const previous = previousKey.current
    previousKey.current = activeKey
    if (browser.current !== null) browser.current.scrollTop = 0
    if (activeKey !== null) heading.current?.focus()
    else {
      const buttons = browser.current?.querySelectorAll<HTMLButtonElement>('[data-workspace-key]')
      const target = Array.from(buttons ?? []).find(button => button.dataset.workspaceKey === previous)
      if (target !== undefined) target.focus()
      else heading.current?.focus()
    }
  }, [activeKey])

  return (
    <div ref={browser} className={css.root}>
      <header className={css.header}>
        {selected !== undefined && (
          <button
            type="button"
            className={css.back}
            onClick={() => { setSelectedKey(null); setQuery('') }}
            aria-label={t('mobile.back')}
          >
            <IconChevronLeftOutline14 />
            <span>{t('section.workspaces')}</span>
          </button>
        )}
        <h2 ref={heading} tabIndex={-1} className={css.title}>
          {selected === undefined ? t('section.workspaces') : label}
        </h2>
        {selected?.cwd !== undefined && <div className={css.path}>{selected.cwd}</div>}
        <input
          type="search"
          className={css.filter}
          aria-label={t('mobile.filter')}
          placeholder={t('mobile.filter')}
          value={query}
          onChange={(event) => { setQuery(event.target.value) }}
        />
      </header>
      {selected === undefined ? (
        <ul className={css.list} aria-label={t('section.workspaces')}>
          {visibleGroups.map(group => (
            <li key={group.key}>
              <button
                type="button"
                className={css.workspace}
                data-workspace-key={group.key}
                onClick={() => { setSelectedKey(group.key); setQuery('') }}
              >
                <IconFolderOpenOutline16 />
                <span className={css.identity}>
                  <span className={css.name}>{group.workspaceId === undefined ? t('group.ungrouped') : group.label}</span>
                  {group.cwd !== undefined && <span className={css.path}>{group.cwd}</span>}
                  <span className={css.count}>{t(group.sessionCount === 1 ? 'sessions.count.one' : 'sessions.count.other', { n: group.sessionCount })}</span>
                </span>
                <IconChevronRightOutline14 />
              </button>
            </li>
          ))}
          {visibleGroups.length === 0 && <li className={css.empty}>{t(normalizedQuery !== '' ? 'empty.noMatches' : workspaces.phase === 'ready' ? 'empty.none' : 'picker.loading')}</li>}
        </ul>
      ) : (
        <ul className={css.list} aria-label={t('section.sessions')}>
          {sessions.map(session => (
            <li key={session.id}>
              <button
                type="button"
                className={css.session}
                aria-current={list.current === session.id ? 'page' : undefined}
                onClick={() => {
                  open(session.id)
                  onSessionOpened?.()
                }}
              >
                <span className={css.name}>{session.blank ? t('session.new') : session.title}</span>
                {(session.pendingInteraction !== undefined || session.running || session.completed) && (
                  <span className={css.count}>{t(
                    session.pendingInteraction === 'approval' ? 'status.waitingApproval'
                      : session.pendingInteraction === 'plan-review' ? 'status.planReview'
                        : session.pendingInteraction === 'question' ? 'status.waitingAnswer'
                          : session.running ? 'status.running' : 'status.completed',
                  )}</span>
                )}
              </button>
            </li>
          ))}
          {sessions.length === 0 && <li className={css.empty}>{t(normalizedQuery !== '' ? 'empty.noMatches' : 'empty.none')}</li>}
        </ul>
      )}
    </div>
  )
}
