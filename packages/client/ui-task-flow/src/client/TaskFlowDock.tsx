/**
 * TaskFlowDock: the resident task-flow strip above the composer. The header
 * always shows lane counts, elapsed time, the lane whose turn is open, and the
 * latest interjection; the body draws the selected variant and collapses per Session.
 */
import { useEffect, useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconFullscreenOutline16, IconStopFill16, Menu, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { FLOW_VARIANTS, type FlowVariant } from '../settings.ts'
import { FlowGraph } from './FlowGraph.tsx'
import type { FlowSnapshot } from './flow-contract.ts'
import { countsFact, currentFact, elapsedFact, laneKindLabel, statusLabel, type TaskFlowTranslate } from './format.ts'
import type { FlowStyle } from './style-policy.ts'
import type { createTaskFlowDockStore } from './stores.ts'
import css from './TaskFlowDock.module.css'

/** Injected business face of the strip. */
export interface TaskFlowDockInjected {
  hooks: {
    /** Live variant preferences, bound as useFlowStyle. */
    flowStyle: SnapshotStore<FlowStyle>
    /** Phone-only resident strip preference, bound as useMobileDock. */
    mobileDock: SnapshotStore<boolean>
  }
  /** Cancel the Session's running turn while keeping its queue. */
  stop: () => void
  /** Switch the Conversation to the task-flow canvas view. */
  openCanvas: () => void
  /** Open one delegated-agent call in the Trajectory view. */
  inspect: (callId: string) => void
  /** Change the strip variant. */
  setDockVariant: (variant: FlowVariant) => void
}

/** Full props of the dock entry: InputZone owner share, session standard kit, store, injected face, and the locale seat. */
export type TaskFlowDockProps =
  PropsRuntime<'conversation.input.dock'>
  & PropsStore<ReturnType<typeof createTaskFlowDockStore>>
  & InjectFace<TaskFlowDockInjected>
  & PropsLocale<'taskFlow'>

/** Variant option keys in menu order. */
const VARIANT_LABELS = {
  cards: 'variant.cards',
  rail: 'variant.rail',
  lanes: 'variant.lanes',
} as const

/**
 * Tick once per second while a span is open.
 * @param active - whether any span is open.
 * @returns the current time, frozen while inactive.
 */
export function useClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [active])
  return now
}

/** Variant picker shared by the strip header and the canvas toolbar. */
export function VariantMenu({ value, onSelect, t }: {
  value: FlowVariant
  onSelect: (variant: FlowVariant) => void
  t: TaskFlowTranslate
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={FLOW_VARIANTS.map(variant => ({ id: variant, label: t(VARIANT_LABELS[variant]) }))}
      selectedId={value}
      onSelect={(id) => {
        setOpen(false)
        onSelect(id as FlowVariant)
      }}
      align="end"
      portal
      anchor={(
        <button
          type="button"
          className={css.btn}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('action.style')}
          onClick={() => { setOpen(value => !value) }}
        >
          {t(VARIANT_LABELS[value])}
          <IconChevronDownOutline14 />
        </button>
      )}
    />
  )
}

/**
 * Header facts shared by the strip and the canvas toolbar: lane counts, elapsed
 * time, the lane whose turn is open, and the latest interjection other than it.
 * The current fact keeps a readable minimum width; the interjection fact shrinks first.
 * @param props - snapshot, clock, and translator.
 * @returns the fact spans.
 */
export function HeaderFacts({ snapshot, now, t }: { snapshot: FlowSnapshot; now: number; t: TaskFlowTranslate }) {
  const { summary } = snapshot
  const elapsed = elapsedFact(t, snapshot, now)
  const current = currentFact(t, snapshot)
  const branch = summary.latestBranchLaneId === undefined
    ? undefined
    : snapshot.lanes.find(lane => lane.id === summary.latestBranchLaneId)
  return (
    <>
      <span className={css.fact}>{countsFact(t, summary.lanes)}</span>
      {elapsed !== undefined && (
        <>
          <span className={css.sep}>·</span>
          <span className={css.fact}>{elapsed}</span>
        </>
      )}
      {current !== undefined && (
        <>
          <span className={css.sep}>·</span>
          <span className={clsx(css.fact, css.current)}>{current}</span>
        </>
      )}
      {branch !== undefined && (
        <>
          <span className={css.sep}>·</span>
          <span className={clsx(css.fact, css.branch)}>
            <span className={css.clip}>{t('latestBranch', { lane: `${laneKindLabel(t, branch, snapshot.lanes)} ${branch.label}` })}</span>
            <span className={clsx(css.statusText, css[branch.status])}>
              {branch.status === 'done' ? t('status.resolved') : statusLabel(t, branch.status)}
            </span>
          </span>
        </>
      )}
    </>
  )
}

/**
 * Render the resident strip; Sessions without a task flow render nothing.
 * @param props - composed dock props.
 * @returns the strip, or null.
 */
export function TaskFlowDock({
  session, useTaskFlow, useFlowStyle, useMobileDock, useStore, actions, stop, openCanvas, inspect, setDockVariant, t,
}: TaskFlowDockProps) {
  const snapshot = useTaskFlow(value => value)
  const variant = useFlowStyle(style => style.dock)
  const fontSize = useFlowStyle(style => style.fontSize)
  const mobileDock = useMobileDock(value => value)
  const expanded = useStore(state => state.expanded)
  const now = useClock(snapshot.summary.running)
  if (snapshot.lanes.length === 0) return null
  return (
    <div className={css.dock} style={{ '--dsh-task-flow-font-size': `${fontSize}px` } as CSSProperties} data-task-flow-dock data-mobile-enabled={mobileDock || undefined}>
      <div className={css.panel}>
        <div className={css.head}>
          <Tooltip label={expanded ? t('action.collapse') : t('action.expand')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={clsx(css.btn, css.icon, css.toggle)}
              aria-label={expanded ? t('action.collapse') : t('action.expand')}
              aria-expanded={expanded}
              onClick={() => { actions.setExpanded(!expanded) }}
            >
              {expanded ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
            </button>
          </Tooltip>
          <span className={css.title}>
            {snapshot.summary.running ? <span className={css.spinner} aria-hidden="true" /> : null}
            {t('title')}
          </span>
          <div className={css.facts}><HeaderFacts snapshot={snapshot} now={now} t={t} /></div>
          <div className={css.actions}>
            <VariantMenu value={variant} onSelect={setDockVariant} t={t} />
            <button type="button" className={clsx(css.btn, css.accent)} onClick={openCanvas}>
              <IconFullscreenOutline16 size={12} />
              {t('action.openCanvas')}
            </button>
            {session.running && (
              <button type="button" className={clsx(css.btn, css.stop)} onClick={stop}>
                <IconStopFill16 size={12} />
                {t('action.stop')}
              </button>
            )}
          </div>
        </div>
        {expanded && (
          <div className={css.body} role="region" aria-label={t('graph.label')} tabIndex={0}>
            <FlowGraph snapshot={snapshot} variant={variant} now={now} t={t} onInspect={inspect} />
          </div>
        )}
      </div>
    </div>
  )
}
