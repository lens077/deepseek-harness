/** Content-sized workspace filters with temporary expansion and mouse drag scrolling. */
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DigestPanelProps } from './contract/slots.ts'
import type { InboxWorkspaceCount } from './select.ts'
import type { WorkspaceRows } from './workspace-layout.ts'
import css from './WorkspaceFilter.module.css'

/**
 * Render workspace chips without reserving unused rows.
 * @param props - counts, active filter, row preference, selection callback, and copy.
 * @returns the scrollable filters and an overflow disclosure.
 */
export function WorkspaceFilter({ workspaces, selected, rows, onSelect, t }: {
  workspaces: readonly InboxWorkspaceCount[]
  selected: string | null | undefined
  rows: WorkspaceRows
  onSelect: (workspace: string | null | undefined) => void
  t: DigestPanelProps['t']
}) {
  const id = useId()
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const [dragging, setDragging] = useState(false)
  const single = rows === 'single' && !expanded

  useEffect(() => { setExpanded(false) }, [rows])
  useEffect(() => {
    const element = viewport.current
    const inner = content.current
    if (element === null || inner === null || expanded) return
    const measure = (): void => {
      setOverflow(rows !== 'all' && (single
        ? element.scrollWidth > element.clientWidth + 1
        : element.scrollHeight > element.clientHeight + 1))
    }
    measure()
    // The resize event also covers engines without ResizeObserver.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(element)
    observer?.observe(inner)
    globalThis.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      globalThis.removeEventListener('resize', measure)
    }
  }, [expanded, rows, single, workspaces])

  const releaseDrag = (): void => {
    const current = drag.current
    drag.current = null
    setDragging(false)
    if (current !== null && viewport.current?.hasPointerCapture(current.id)) viewport.current.releasePointerCapture(current.id)
  }
  return (
    <div className={css.bar} data-workspace-filter="">
      <div
        id={id}
        ref={viewport}
        role="group"
        aria-label={t('workspaces.filter')}
        title={single && overflow ? t('workspaces.scrollHint') : undefined}
        className={clsx(css.viewport, single && css.single, !single && !expanded && rows !== 'all' && css.limited, dragging && css.dragging)}
        style={typeof rows === 'number' ? { '--digest-workspace-rows': rows } as CSSProperties : undefined}
        data-workspace-scroll=""
        onPointerDown={(event) => {
          suppressClick.current = false
          if (!single || !overflow || event.button !== 0 || event.pointerType !== 'mouse') return
          drag.current = { id: event.pointerId, x: event.clientX, left: event.currentTarget.scrollLeft, moved: false }
        }}
        onPointerMove={(event) => {
          const current = drag.current
          if (current === null || current.id !== event.pointerId) return
          if (event.buttons === 0) { suppressClick.current = false; releaseDrag(); return }
          const distance = event.clientX - current.x
          if (!current.moved && Math.abs(distance) < 5) return
          current.moved = true
          suppressClick.current = true
          setDragging(true)
          event.currentTarget.setPointerCapture(event.pointerId)
          event.currentTarget.scrollLeft = current.left - distance
          event.preventDefault()
        }}
        onPointerUp={releaseDrag}
        onPointerCancel={() => { suppressClick.current = false; releaseDrag() }}
        onLostPointerCapture={() => { drag.current = null; setDragging(false) }}
        onClickCapture={(event) => {
          if (!suppressClick.current) return
          suppressClick.current = false
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <div ref={content} className={css.chips}>
          <button type="button" className={clsx(css.chip, selected === undefined && css.active)}
            aria-pressed={selected === undefined} onClick={() => { onSelect(undefined) }}>
            {t('panel.allWorkspaces')}
          </button>
          {workspaces.map(workspace => (
            <button key={workspace.workspaceId ?? '__ungrouped__'} type="button"
              className={clsx(css.chip, selected === workspace.workspaceId && css.active)}
              aria-pressed={selected === workspace.workspaceId} title={workspace.title}
              onClick={() => { onSelect(workspace.workspaceId) }}>
              <span className={css.name}>{workspace.title}</span>
              {workspace.attention > 0 && <span className={css.attention}>{workspace.attention}</span>}
              {workspace.running > 0 && <span className={css.running}>{workspace.running}</span>}
            </button>
          ))}
        </div>
      </div>
      {rows !== 'all' && (expanded || overflow) && (
        <Button variant="ghost" className={css.expand} aria-controls={id} aria-expanded={expanded}
          onClick={() => { setExpanded(value => !value) }}>
          {t(expanded ? 'workspaces.collapse' : 'workspaces.showAll')}
        </Button>
      )}
    </div>
  )
}
