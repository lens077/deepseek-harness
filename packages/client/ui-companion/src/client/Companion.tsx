/** A docked companion that users can move into the viewport without changing its mood. */
import { useId, useLayoutEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { createCompanionStore } from './store.ts'
import type { CompanionUsageScope } from './index.ts'
import { CompanionMenu } from './CompanionMenu.tsx'
import { UsagePopover } from './UsagePopover.tsx'
import css from './Companion.module.css'
import { useCompanionDrag } from './useCompanionDrag.ts'

/** Browser visibility is observed by the plugin, not by presentation components. */
export interface CompanionInjected {
  hooks: { pageVisible: ObservableSnapshot<boolean> }
  artwork: { awake: string; sleeping: string }
}

/** Framework-derived props for the reserved sidebar action. */
export type CompanionProps = PropsRuntime<'sidebar.footer.action'>
  & PropsStore<ReturnType<typeof createCompanionStore>>
  & PropsLocale<'companion'>
  & InjectFace<CompanionInjected>
  & PropsRenderSlots<'companion.usage.panel'>

/** Render the character and its keyboard-accessible controls.
 * @param props - sidebar geometry, interaction store, visibility and localized copy.
 * @returns a compact character button or the expanded resting area.
 */
export function Companion({ wide, useStore, actions, usePageVisible, renderSlot, artwork, t }: CompanionProps) {
  const closeUsage = actions.closeUsage
  const { mood, collapsed, paused, position, usage } = useStore(state => state)
  const dragHelp = useId()
  const visible = usePageVisible(value => value)
  const compact = !wide || collapsed
  const label = wide && collapsed ? t('expand') : t(`action.${mood}`)
  const character = useRef<HTMLButtonElement>(null)
  const focusAfterToggle = useRef(false)
  useLayoutEffect(() => {
    if (!focusAfterToggle.current) return
    focusAfterToggle.current = false
    character.current?.focus()
  }, [collapsed])
  const toggleCollapsed = () => {
    focusAfterToggle.current = true
    actions.toggleCollapsed()
  }
  const dock = () => {
    actions.dock()
    character.current?.focus()
  }
  const { root, dragging, ...dragHandlers } = useCompanionDrag(
    position, actions.move, dock, wide && collapsed ? toggleCollapsed : actions.interact,
  )
  const changeUsage = (scope: CompanionUsageScope) => {
    if (scope === 'all' || scope === 'session' || scope === 'tree') {
      root.current?.querySelector<HTMLButtonElement>('[data-usage-trigger]')?.focus()
    }
    actions.openUsage(scope)
  }
  const positionStyle = position === null ? undefined : {
    '--companion-x': `${position.x}px`, '--companion-y': `${position.y}px`,
  } as CSSProperties
  const usagePanel = usage === null ? null : renderSlot('companion.usage.panel', {
    initialScope: usage, onScope: changeUsage, onClose: closeUsage,
  }, {
    fallback: <div className={css.unavailable}>
      <p role="status">{t('usage.unavailable')}</p>
      <Button onClick={closeUsage}>{t('close')}</Button>
    </div>,
  })
  return (
    <section ref={root} className={css.root} data-companion data-compact={compact || undefined}
      data-floating={position !== null || undefined} data-dragging={dragging || undefined} style={positionStyle}
      data-paused={paused || !visible || compact || dragging || undefined} aria-label={t('name')}>
      <span id={dragHelp} className={css.dragHelp}>{t('dragHelp')}</span>
      <div className={css.stage}>
        <button ref={character} type="button" className={css.character}
          aria-label={label} aria-describedby={dragHelp} title={t('dragHelp')}
          {...dragHandlers} onPointerDown={(event) => { closeUsage(); dragHandlers.onPointerDown(event) }}>
          <span className={css.art} data-testid="companion-art" data-mood={mood}>
            <img className={css.image} src={mood === 'sleeping' ? artwork.sleeping : artwork.awake}
              alt="" width={320} height={331} draggable={false} />
            {mood === 'sleeping' && <span className={css.sleepMark} aria-hidden="true">{t('sleepMark')}</span>}
          </span>
        </button>
        <CompanionMenu usageOpen={usage !== null} onUsage={actions.openUsage} t={t} />
      </div>
      {!compact && <>
        <p className={css.hint} role="status" aria-live="polite">{t(`hint.${mood}`)}</p>
        <div className={css.controls}>
          <Button size="sm" onClick={actions.toggleMotion}>
            {t(paused ? 'resume' : 'pause')}
          </Button>
          <Button size="sm" onClick={toggleCollapsed}>{t('collapse')}</Button>
        </div>
      </>}
      {position !== null && <Button size="sm" className={css.dock} onClick={dock} aria-label={t('dock.aria')}>
        {t('dock')}
      </Button>}
      {usage === 'today' || usage === 'week' || usage === 'month'
        ? <UsagePopover anchor={root} label={t('menu')} onClose={closeUsage}>{usagePanel}</UsagePopover>
        : usagePanel}
    </section>
  )
}
