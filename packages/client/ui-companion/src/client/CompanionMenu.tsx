/** Persistent entry for the compact usage preview, separate from drag gestures. */
import { useLayoutEffect, useRef } from 'react'
import { IconDatabaseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CompanionUsageScope } from './index.ts'
import css from './Companion.module.css'

type CompanionMenuProps = PropsLocale<'companion'> & {
  usageOpen: boolean
  onUsage: (scope: CompanionUsageScope) => void
}

/** Open today's summary and restore this persistent focus anchor on dismissal.
 * @param props - current disclosure state, open callback, and localized copy.
 * @returns the usage-preview button.
 */
export function CompanionMenu({ usageOpen, onUsage, t }: CompanionMenuProps) {
  const trigger = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(usageOpen)
  useLayoutEffect(() => {
    if (wasOpen.current && !usageOpen) trigger.current?.focus()
    wasOpen.current = usageOpen
  }, [usageOpen])
  return <span className={css.menu}>
    <button ref={trigger} data-usage-trigger className={css.menuButton} type="button" aria-label={t('menu')}
      title={t('menu')} aria-haspopup="dialog" aria-expanded={usageOpen}
      onClick={() => { onUsage('today') }}>
      <IconDatabaseOutline16 />
    </button>
  </span>
}
