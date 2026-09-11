import type { CSSProperties } from 'react'
import type { SessionNode } from '../tree.ts'
import { SessionNodeItem, type SessionRowContext } from './Rows.tsx'
import css from './PinnedArea.module.css'

/**
 * Pinned sidebar region rendered above the workspace browser sections.
 * @param props.rows - visible pinned session rows in recency order.
 * @param props.row - shared row actions and locale seat.
 * @param props.count - fixed number of row slots.
 * @param props.emptyLabel - localized empty-state hint.
 * @param props.ariaLabel - localized accessible region name.
 * @returns the pinned region.
 */
export function PinnedArea({ rows, row, count, emptyLabel, ariaLabel }: {
  rows: readonly SessionNode[]
  row: SessionRowContext
  count: number
  emptyLabel: string
  ariaLabel: string
}) {
  return (
    <section className={css.area} aria-label={ariaLabel}>
      <div className={css.label}>{row.t('section.pinned')}</div>
      <div className={css.list} style={{ '--pinned-rows': count } as CSSProperties} role="tree">
        {rows.length === 0
          ? <div className={css.empty}>{emptyLabel}</div>
          : rows.map(node => (
            <SessionNodeItem
              key={node.id}
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
              flat
              pinned={row.isPinned(node.id)}
              onPin={row.onPin}
              multiSelected={row.isSelected(node.id)}
              multiLead={row.isLead(node.id)}
              statusIndicatorMode={row.statusIndicatorMode}
              t={row.t}
            />
          ))}
      </div>
    </section>
  )
}
