/**
 * The three task-flow drawings over one snapshot: the card graph (`cards`),
 * the pill rail (`rail`), and the lane board (`lanes`). Each drawing is a
 * pure function of the snapshot, the clock, and the translator.
 */
import { useMemo } from 'react'
import clsx from 'clsx'
import type { FlowVariant } from '../settings.ts'
import type { FlowLane, FlowNode, FlowSnapshot, FlowStatus } from './flow-contract.ts'
import { columnsOf, DOCK_METRICS, layoutFlow, type FlowLayoutMetrics } from './flow-layout.ts'
import { isTerminal } from './flow-model.ts'
import {
  formatDuration, laneAnchorLabel, laneKind, laneKindLabel, laneProgress, nodeDetail, nodeTitle, spanOf, statusLabel,
  type TaskFlowTranslate,
} from './format.ts'
import css from './FlowGraph.module.css'

/** Props shared by every drawing. */
export interface FlowGraphProps {
  snapshot: FlowSnapshot
  variant: FlowVariant
  /** Clock for open spans. */
  now: number
  t: TaskFlowTranslate
  /** Open one delegated-agent call in the Trajectory inspector. */
  onInspect?: ((callId: string) => void) | undefined
  /** Card metrics for the `cards` variant. */
  metrics?: FlowLayoutMetrics | undefined
}

function StatusGlyph({ status }: { status: FlowStatus }) {
  return (
    <span className={clsx(css.glyph, css[status])} aria-hidden="true">
      {status === 'running'
        ? <span className={css.spinner} />
        : isTerminal(status) ? <span className={css.square} /> : status === 'done' ? '✓' : status === 'risk' ? '⚠' : <span className={css.dot} />}
    </span>
  )
}

function elapsed(t: TaskFlowTranslate, node: FlowNode, now: number): string | undefined {
  const span = spanOf(node.startTime, node.endTime, now)
  return span === undefined || node.kind === 'prompt' || node.kind === 'terminal' ? undefined : formatDuration(t, span)
}

function inspectable(node: FlowNode, onInspect: FlowGraphProps['onInspect']): (() => void) | undefined {
  const callId = node.callId
  return onInspect !== undefined && callId !== undefined ? () => { onInspect(callId) } : undefined
}

function ordinalOf(t: TaskFlowTranslate, lane: FlowLane): string {
  return t('lane.ordinal', { ordinal: lane.ordinal })
}

/** Prompt caption: the main line names the task, an interjection shows its status, a sequel its kind or retry. */
function promptMeta(t: TaskFlowTranslate, node: FlowNode, lane: FlowLane | undefined, lanes: readonly FlowLane[]): string {
  if (lane === undefined || lane.kind === 'interjection') return statusLabel(t, node.status)
  return lane.kind === 'main' ? t('node.prompt') : laneKind(t, lane, lanes)
}

/* ---------- cards ---------- */

function FlowCards({ snapshot, now, t, onInspect, metrics = DOCK_METRICS }: Omit<FlowGraphProps, 'variant'>) {
  const layout = useMemo(() => layoutFlow(snapshot, metrics), [snapshot, metrics])
  const laneById = useMemo(() => new Map(snapshot.lanes.map(lane => [lane.id, lane])), [snapshot])
  return (
    <div className={clsx(css.graph, css.cards)} style={{ width: layout.width, height: layout.height }} data-flow-variant="cards">
      <svg className={css.edges} width={layout.width} height={layout.height}>
        {layout.edges.map(edge => (
          <path
            key={edge.id}
            className={clsx(css.edge, edge.dashed && css.dashed)}
            d={edge.dashed
              ? `M${edge.x1},${edge.y1} L${edge.x1},${edge.y2} L${edge.x2},${edge.y2}`
              : `M${edge.x1},${edge.y1} C${(edge.x1 + edge.x2) / 2},${edge.y1} ${(edge.x1 + edge.x2) / 2},${edge.y2} ${edge.x2},${edge.y2}`}
          />
        ))}
      </svg>
      {layout.rows.map(row => (
        <span key={row.lane.id} className={css.rowLabel} style={{ top: row.y - 15 }}>
          {row.lane.kind === 'main' ? t('lane.main') : laneKindLabel(t, row.lane, snapshot.lanes)}
        </span>
      ))}
      {layout.nodes.map((card) => {
        const node = card.node
        const lane = laneById.get(node.laneId)
        const detail = nodeDetail(t, node)
        const time = elapsed(t, node, now)
        const inspect = inspectable(node, onInspect)
        const Tag = inspect === undefined ? 'div' : 'button'
        return (
          <Tag
            key={card.id}
            type={inspect === undefined ? undefined : 'button'}
            className={clsx(css.card, css[node.status], css[node.kind], inspect !== undefined && css.clickable)}
            style={{ left: card.x, top: card.y, width: card.width, height: card.height }}
            onClick={inspect}
            title={inspect === undefined ? undefined : t('action.inspect')}
            data-flow-node={node.id}
          >
            <span className={css.cardTitle}>
              <span>{nodeTitle(t, node)}</span>
              {node.kind === 'prompt' && lane !== undefined && <span className={css.tag}>{ordinalOf(t, lane)}</span>}
            </span>
            <span className={css.cardMeta}>
              <span className={clsx(css.statusText, css[node.status])}>
                <StatusGlyph status={node.status} />
                {node.kind === 'prompt' ? promptMeta(t, node, lane, snapshot.lanes) : node.kind === 'terminal' ? null : statusLabel(t, node.status)}
              </span>
              <span>{time ?? detail}</span>
            </span>
          </Tag>
        )
      })}
    </div>
  )
}

/* ---------- rail ---------- */

function Chip({ node, lane, lanes, now, t, onInspect }: {
  node: FlowNode
  lane: FlowLane | undefined
  lanes: readonly FlowLane[]
  now: number
  t: TaskFlowTranslate
  onInspect: FlowGraphProps['onInspect']
}) {
  const inspect = inspectable(node, onInspect)
  const Tag = inspect === undefined ? 'span' : 'button'
  const time = elapsed(t, node, now)
  const detail = nodeDetail(t, node)
  const retry = node.kind === 'prompt' && lane?.retryOfLaneId !== undefined ? laneKind(t, lane, lanes) : undefined
  const meta = [time, node.kind === 'terminal' ? undefined : detail, retry].filter(value => value !== undefined).join(' · ')
  return (
    <Tag
      type={inspect === undefined ? undefined : 'button'}
      className={clsx(css.chip, css[node.status], inspect !== undefined && css.clickable)}
      onClick={inspect}
      title={inspect === undefined ? undefined : t('action.inspect')}
      data-flow-node={node.id}
    >
      {node.kind === 'prompt' && lane !== undefined ? <span className={css.ordinal}>{ordinalOf(t, lane)}</span> : <StatusGlyph status={node.status} />}
      <span className={css.chipText}>{nodeTitle(t, node)}</span>
      {meta !== '' && <span className={css.chipMeta}>{meta}</span>}
    </Tag>
  )
}

/** The rail track: the main line and every sequel, chained in order; interjections hang below as branch rows. */
function FlowRail({ snapshot, now, t, onInspect }: Omit<FlowGraphProps, 'variant'>) {
  const { lanes, nodes } = snapshot
  const track = lanes
    .filter(lane => lane.kind !== 'interjection')
    .flatMap(lane => columnsOf(lane, nodes).map(column => ({ lane, column })))
  const branches = lanes.filter(lane => lane.kind === 'interjection')
  return (
    <div className={clsx(css.graph, css.rail)} data-flow-variant="rail">
      <div className={css.track}>
        {track.map(({ lane, column }, index) => (
          <span key={column[0].id} className={css.track}>
            {index > 0 && <span className={css.link} />}
            {column.length === 1
              ? <Chip node={column[0]} lane={lane} lanes={lanes} now={now} t={t} onInspect={onInspect} />
              : (
                <span className={css.parallel}>
                  {column.map(node => <Chip key={node.id} node={node} lane={lane} lanes={lanes} now={now} t={t} onInspect={onInspect} />)}
                </span>
              )}
          </span>
        ))}
      </div>
      {branches.map((lane) => {
        const anchor = laneAnchorLabel(t, lane, nodes)
        const [head, ...rest] = lane.nodeIds.flatMap(id => nodes.get(id) ?? [])
        if (head === undefined) return null
        const tail = rest.filter(node => node.kind !== 'agent')
        return (
          <div key={lane.id} className={css.branchRow} data-flow-lane={lane.id}>
            <span className={css.hook} />
            {anchor !== undefined && <span className={css.from}>{anchor} ↳</span>}
            <Chip node={{ ...head, status: lane.status }} lane={lane} lanes={lanes} now={now} t={t} onInspect={onInspect} />
            {tail.map(node => (
              <span key={node.id} className={css.track}>
                <span className={css.link} />
                <Chip node={node} lane={lane} lanes={lanes} now={now} t={t} onInspect={onInspect} />
              </span>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/* ---------- lanes ---------- */

function Block({ node, now, t, onInspect }: { node: FlowNode; now: number; t: TaskFlowTranslate; onInspect: FlowGraphProps['onInspect'] }) {
  const inspect = inspectable(node, onInspect)
  const Tag = inspect === undefined ? 'span' : 'button'
  const time = elapsed(t, node, now)
  return (
    <Tag
      type={inspect === undefined ? undefined : 'button'}
      className={clsx(css.block, css[node.status], inspect !== undefined && css.clickable)}
      onClick={inspect}
      title={inspect === undefined ? undefined : t('action.inspect')}
      data-flow-node={node.id}
    >
      <StatusGlyph status={node.status} />
      <span className={css.chipText}>{nodeTitle(t, node)}</span>
      {time !== undefined && <span className={css.chipMeta}>· {time}</span>}
    </Tag>
  )
}

function FlowLanes({ snapshot, now, t, onInspect }: Omit<FlowGraphProps, 'variant'>) {
  return (
    <div className={clsx(css.graph, css.lanes)} data-flow-variant="lanes">
      {snapshot.lanes.map((lane) => {
        const all = columnsOf(lane, snapshot.nodes)
        const prompt = all[0]?.[0].kind === 'prompt' ? all[0][0] : undefined
        const columns = prompt === undefined ? all : all.slice(1)
        const { done, total } = laneProgress(lane, snapshot.nodes)
        const span = (lane.endTime ?? now) - lane.startTime
        const anchor = laneAnchorLabel(t, lane, snapshot.nodes)
        return (
          <div key={lane.id} className={clsx(css.lane, lane.kind === 'main' && css.main)} data-flow-lane={lane.id}>
            <div className={css.laneName}>
              <span className={css.ordinal}>{ordinalOf(t, lane)}</span>
              <span>{laneKind(t, lane, snapshot.lanes)}</span>
              <span className={css.laneSub}>{anchor ?? lane.label}</span>
            </div>
            <div className={css.blocks}>
              {columns.map((column, index) => (
                <span key={column[0].id} className={css.blocks}>
                  {index > 0 && <span className={css.arrow}>▶</span>}
                  {column.length === 1
                    ? <Block node={column[0]} now={now} t={t} onInspect={onInspect} />
                    : (
                      <span className={css.group}>
                        {column.map(node => <Block key={node.id} node={node} now={now} t={t} onInspect={onInspect} />)}
                      </span>
                    )}
                </span>
              ))}
              {columns.length === 0 && prompt !== undefined && (
                <Block node={{ ...prompt, status: lane.status }} now={now} t={t} onInspect={onInspect} />
              )}
            </div>
            <div className={css.laneStat}>
              {total > 0
                ? <><b>{t('progress', { done, total })}</b>{` · ${formatDuration(t, span)}`}<div className={css.bar}><i style={{ width: `${Math.round(done / total * 100)}%` }} /></div></>
                : <span className={clsx(css.statusText, css[lane.status])}>{lane.status === 'done' && lane.kind !== 'main' ? t('status.resolved') : statusLabel(t, lane.status)}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Draw one task flow in the selected variant.
 * @param props - snapshot, variant, clock, translator, and optional inspector.
 * @returns the drawing, or the empty caption when no lane exists.
 */
export function FlowGraph(props: FlowGraphProps) {
  if (props.snapshot.lanes.length === 0) {
    return <div className={clsx(css.graph, css.empty)}>{props.t('canvas.empty')}</div>
  }
  switch (props.variant) {
    case 'cards': return <FlowCards {...props} />
    case 'rail': return <FlowRail {...props} />
    case 'lanes': return <FlowLanes {...props} />
  }
}
