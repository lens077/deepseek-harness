/**
 * TaskFlowView: the `Flow` Conversation view. It draws the selected canvas
 * variant on a pan/zoom stage with a toolbar for progress, stop, style, and
 * returning to Chat. Agent nodes open their call in the Trajectory view.
 */
import {
  useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent,
} from 'react'
import clsx from 'clsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconStopFill16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FlowVariant } from '../settings.ts'
import { FlowGraph } from './FlowGraph.tsx'
import type { FlowLayoutMetrics } from './flow-layout.ts'
import { countsFact, elapsedFact } from './format.ts'
import type { FlowStyle } from './style-policy.ts'
import { useClock, VariantMenu } from './TaskFlowDock.tsx'
import css from './TaskFlowView.module.css'

/** Injected business face of the canvas view. */
export interface TaskFlowViewInjected {
  hooks: {
    /** Live variant preferences, bound as useFlowStyle. */
    flowStyle: SnapshotStore<FlowStyle>
  }
  /** Cancel the Session's running turn while keeping its queue. */
  stop: () => void
  /** Change the canvas variant. */
  setCanvasVariant: (variant: FlowVariant) => void
}

/** Full props of the canvas view entry. */
export type TaskFlowViewProps = ConvViewProps & InjectFace<TaskFlowViewInjected> & PropsLocale<'taskFlow'>

/** Larger card metrics for the canvas. */
const CANVAS_METRICS: FlowLayoutMetrics = {
  nodeWidth: 200, nodeHeight: 68, gapX: 56, gapY: 14, rowGap: 48, padding: 40,
}

const MIN_SCALE = 0.4
const MAX_SCALE = 2.5
const FIT_SCALE = 1.2

interface Transform {
  readonly scale: number
  readonly x: number
  readonly y: number
}

const FIT: Transform = { scale: FIT_SCALE, x: 40, y: 40 }

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/**
 * Render the canvas view.
 * @param props - composed view props.
 * @returns the pan/zoom canvas.
 */
export function TaskFlowView({
  useSession, useTaskFlow, useFlowStyle, stop, setCanvasVariant, openView, completeViewRequest, viewRequest, t,
}: TaskFlowViewProps) {
  const snapshot = useTaskFlow(value => value)
  const running = useSession(session => session.running)
  const variant = useFlowStyle(style => style.canvas)
  const fontSize = useFlowStyle(style => style.fontSize)
  const now = useClock(snapshot.summary.running)
  const [transform, setTransform] = useState<Transform>(FIT)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  /** Scale the whole drawing into the viewport with a margin, never above the fit ceiling. */
  const fit = useCallback(() => {
    const viewport = viewportRef.current
    const stage = stageRef.current
    if (viewport === null || stage === null) {
      setTransform(FIT)
      return
    }
    const width = stage.scrollWidth
    const height = stage.scrollHeight
    if (width === 0 || height === 0) {
      setTransform(FIT)
      return
    }
    const margin = 2 * FIT.x
    const scale = clampScale(Math.min(FIT_SCALE, (viewport.clientWidth - margin) / width, (viewport.clientHeight - margin) / height))
    setTransform({ scale, x: FIT.x, y: FIT.y })
  }, [])
  // The strip's open-canvas request carries no focus; acknowledge it once shown.
  const pendingRequest = viewRequest?.view === 'task-flow'
  useEffect(() => {
    if (pendingRequest) completeViewRequest()
  }, [pendingRequest, completeViewRequest])

  const zoomBy = useCallback((factor: number) => {
    setTransform(current => ({ ...current, scale: clampScale(current.scale * factor) }))
  }, [])
  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1)
  }, [zoomBy])
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button') !== null) return
    drag.current = { startX: event.clientX, startY: event.clientY, originX: transform.x, originY: transform.y }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }, [transform.x, transform.y])
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current
    if (active === null) return
    setTransform(current => ({
      ...current,
      x: active.originX + event.clientX - active.startX,
      y: active.originY + event.clientY - active.startY,
    }))
  }, [])
  const onPointerUp = useCallback(() => {
    drag.current = null
    setDragging(false)
  }, [])

  const elapsed = elapsedFact(t, snapshot, now)
  const onInspect = (callId: string): void => { openView('trajectory', callId) }

  return (
    <div className={css.view} style={{ '--dsh-task-flow-font-size': `${fontSize}px` } as CSSProperties} data-task-flow-view>
      {snapshot.lanes.length === 0
        ? <div className={css.empty}>{t('canvas.empty')}</div>
        : (
          <div
            ref={viewportRef}
            className={clsx(css.viewport, dragging && css.dragging)}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div
              ref={stageRef}
              className={clsx(css.stage, variant === 'lanes' && css.laneBoard)}
              style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
            >
              <FlowGraph snapshot={snapshot} variant={variant} now={now} t={t} onInspect={onInspect} metrics={CANVAS_METRICS} />
            </div>
          </div>
        )}
      <div className={css.toolbar}>
        <span className={css.fact}>
          {countsFact(t, snapshot.summary.lanes)}
          {elapsed === undefined ? null : ` · ${elapsed}`}
        </span>
        <VariantMenu value={variant} onSelect={setCanvasVariant} t={t} />
        {running && (
          <button type="button" className={clsx(css.btn, css.stop)} onClick={stop}>
            <IconStopFill16 size={12} />
            {t('action.stop')}
          </button>
        )}
        <button type="button" className={css.btn} onClick={() => { openView('chat', '') }}>{t('action.back')}</button>
      </div>
      <div className={css.zoom}>
        <button type="button" className={css.btn} aria-label={t('action.zoomOut')} onClick={() => { zoomBy(1 / 1.1) }}>−</button>
        <button type="button" className={css.btn} onClick={() => { setTransform(FIT) }}>
          {t('canvas.zoom', { percent: Math.round(transform.scale * 100) })}
        </button>
        <button type="button" className={css.btn} aria-label={t('action.zoomIn')} onClick={() => { zoomBy(1.1) }}>＋</button>
        <button type="button" className={css.btn} onClick={fit}>{t('action.fit')}</button>
      </div>
      <div className={css.hint}>{t('canvas.hint')}</div>
    </div>
  )
}
