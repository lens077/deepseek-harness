/**
 * The Digest panel settings page: whether the sidebar entry shows the state
 * badges, whether a grey finished badge joins them, and the order the state
 * badges take. The order list is reordered by dragging a row onto another,
 * or by the move buttons for keyboard users; every edit writes the whole
 * order so the document always holds a permutation.
 */
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { DigestSettingsSectionProps } from './contract/slots.ts'
import { NAV_BADGE_STATES, type NavBadgeState } from '../nav-settings.ts'
import css from './ProjectSettingsSection.module.css'

/**
 * Move one element of a list to another index.
 * @param list - the source order.
 * @param from - index of the moved element.
 * @param to - index it lands on.
 * @returns the reordered copy.
 */
function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item as T)
  return next
}

/**
 * Render the digest panel settings page.
 * @param props - composed slot props (settings view hook, writers, copy).
 * @returns the page element.
 */
export function DigestSettingsSection(props: DigestSettingsSectionProps) {
  const { useNavSettings, setNavBadges, setNavFinishedBadge, setNavBadgeOrder, t } = props
  const view = useNavSettings(value => value)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<NavBadgeState | null>(null)
  const [over, setOver] = useState<NavBadgeState | null>(null)
  useEffect(() => {
    if (error === null) return
    const timer = globalThis.setTimeout(() => { setError(null) }, 4_000)
    return () => { globalThis.clearTimeout(timer) }
  }, [error])
  const disabled = view.status !== 'ready' || !view.writable
  const failed = (cause: unknown): void => {
    setError(t('settings.saveFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
  }
  const order = view.navBadgeOrder
  const commit = (next: readonly NavBadgeState[]): void => {
    void setNavBadgeOrder(next).catch(failed)
  }
  const drop = (target: NavBadgeState): void => {
    const from = dragging === null ? -1 : order.indexOf(dragging)
    const to = order.indexOf(target)
    setDragging(null)
    setOver(null)
    if (from < 0 || to < 0 || from === to) return
    commit(move(order, from, to))
  }
  const isDefault = order.every((state, index) => state === NAV_BADGE_STATES[index])

  return (
    <div className={css.section}>
      <h3 className={css.title}>{t('digestSettings.title')}</h3>
      <p className={css.desc}>{t('digestSettings.description')}</p>
      {view.status === 'loading' && <p className={css.desc}>{t('settings.loading')}</p>}
      {view.status !== 'loading' && disabled && <p className={css.warn}>{t('settings.unavailable')}</p>}
      {error !== null && <p className={css.error} role="alert">{error}</p>}

      <div className={css.field}>
        <label className={css.check}>
          <input
            type="checkbox"
            checked={view.navBadges}
            disabled={disabled}
            onChange={(event) => { void setNavBadges(event.target.checked).catch(failed) }}
          />
          <span>
            <span className={css.label}>{t('digestSettings.navBadges')}</span>
            <span className={css.hint}>{t('digestSettings.navBadges.hint')}</span>
          </span>
        </label>
      </div>

      <div className={css.field}>
        <label className={css.check}>
          <input
            type="checkbox"
            checked={view.navFinishedBadge}
            disabled={disabled || !view.navBadges}
            onChange={(event) => { void setNavFinishedBadge(event.target.checked).catch(failed) }}
          />
          <span>
            <span className={css.label}>{t('digestSettings.navFinishedBadge')}</span>
            <span className={css.hint}>{t('digestSettings.navFinishedBadge.hint')}</span>
          </span>
        </label>
      </div>

      <div className={css.field}>
        <div className={css.label}>{t('digestSettings.order')}</div>
        <p className={css.hint}>{t('digestSettings.order.hint')}</p>
        <ol className={css.list} aria-label={t('digestSettings.order')}>
          {order.map((state, index) => (
            <li
              key={state}
              className={clsx(
                css.listRow,
                css.sortRow,
                over === state && dragging !== state && css.sortOver,
                dragging === state && css.sortDragging,
              )}
              data-state={state}
              draggable={!disabled}
              onDragStart={(event) => {
                if (disabled) return
                event.dataTransfer.effectAllowed = 'move'
                setDragging(state)
              }}
              onDragOver={(event) => {
                if (dragging === null) return
                event.preventDefault()
                if (over !== state) setOver(state)
              }}
              onDragLeave={() => { if (over === state) setOver(null) }}
              onDrop={(event) => {
                event.preventDefault()
                drop(state)
              }}
              onDragEnd={() => {
                setDragging(null)
                setOver(null)
              }}
            >
              <span className={css.sortHandle} aria-hidden="true">⋮⋮</span>
              <span className={css.listText}>{t(`digestSettings.state.${state}`)}</span>
              <button
                type="button"
                className={css.action}
                disabled={disabled || index === 0}
                aria-label={`${t('digestSettings.order.moveUp')}: ${t(`digestSettings.state.${state}`)}`}
                onClick={() => { commit(move(order, index, index - 1)) }}
              >
                ↑
              </button>
              <button
                type="button"
                className={css.action}
                disabled={disabled || index === order.length - 1}
                aria-label={`${t('digestSettings.order.moveDown')}: ${t(`digestSettings.state.${state}`)}`}
                onClick={() => { commit(move(order, index, index + 1)) }}
              >
                ↓
              </button>
            </li>
          ))}
        </ol>
        <div className={css.addRow}>
          <button
            type="button"
            className={css.action}
            disabled={disabled || isDefault}
            onClick={() => { commit([...NAV_BADGE_STATES]) }}
          >
            {t('digestSettings.order.reset')}
          </button>
        </div>
      </div>
    </div>
  )
}
