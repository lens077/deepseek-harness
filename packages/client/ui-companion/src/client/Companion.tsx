/** A docked companion that users can move into the viewport without changing its mood. */
import { useId, useLayoutEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { createCompanionStore } from './store.ts'
import type {} from './index.ts'
import awake from './assets/awake.webp'
import sleeping from './assets/sleeping.webp'
import css from './Companion.module.css'
import { useCompanionDrag } from './useCompanionDrag.ts'

/** Browser visibility is observed by the plugin, not by presentation components. */
export interface CompanionInjected {
  hooks: { pageVisible: ObservableSnapshot<boolean> }
}

/** Framework-derived props for the reserved sidebar action. */
export type CompanionProps = PropsRuntime<'sidebar.footer.action'>
  & PropsStore<ReturnType<typeof createCompanionStore>>
  & PropsLocale<'companion'>
  & InjectFace<CompanionInjected>

/** Render the character and its keyboard-accessible controls.
 * @param props - sidebar geometry, interaction store, visibility and localized copy.
 * @returns a compact character button or the expanded resting area.
 */
export function Companion({ wide, useStore, actions, usePageVisible, t }: CompanionProps) {
  const { mood, collapsed, paused, position } = useStore(state => state)
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
  const positionStyle = position === null ? undefined : {
    '--companion-x': `${position.x}px`, '--companion-y': `${position.y}px`,
  } as CSSProperties
  return (
    <section ref={root} className={css.root} data-companion data-compact={compact || undefined}
      data-floating={position !== null || undefined} data-dragging={dragging || undefined} style={positionStyle}
      data-paused={paused || !visible || compact || dragging || undefined} aria-label={t('name')}>
      <span id={dragHelp} className={css.dragHelp}>{t('dragHelp')}</span>
      <div className={css.stage}>
        <button ref={character} type="button" className={css.character}
          aria-label={label} aria-describedby={dragHelp} title={t('dragHelp')}
          {...dragHandlers}>
          <span className={css.art} data-testid="companion-art" data-mood={mood}>
            <img className={css.image} src={mood === 'sleeping' ? sleeping : awake}
              alt="" width={320} height={331} draggable={false} />
            {mood === 'sleeping' && <span className={css.sleepMark} aria-hidden="true">{t('sleepMark')}</span>}
          </span>
        </button>
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
    </section>
  )
}
