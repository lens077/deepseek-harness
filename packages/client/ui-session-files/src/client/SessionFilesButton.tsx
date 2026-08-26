// SessionFilesButton: the tab row's leading control. It reports how many files
// this session changed and toggles the rail; while the agent runs the count
// gives way to a spinner, because a changing count is the thing the reader is
// watching and a number that moves under them reads as noise.

import clsx from 'clsx'
import { IconListPenOutline16, IconLoadingOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionFilesRailState } from './rail-store.ts'
import { sessionFilesOf } from './session-files.ts'
import type { NS } from './locales.ts'
import css from './SessionFilesButton.module.css'

/** Rail preference and its one write, injected by the plugin body. */
export interface SessionFilesButtonInjected {
  hooks: { rail: ObservableSnapshot<SessionFilesRailState> }
  /** Flip the rail open or closed. */
  toggle: () => void
}

/** Full props for the tab row's leading file control. */
export type SessionFilesButtonProps =
  PropsRuntime<'conversation.session.tabs.leading'>
  & PropsLocale<typeof NS>
  & InjectFace<SessionFilesButtonInjected>

/**
 * Render the rail's toggle.
 * @param props - session runtime, rail preference, the toggle, and localized copy.
 * @returns the tab row's leading control.
 */
export function SessionFilesButton({ useSession, useRail, toggle, t }: SessionFilesButtonProps) {
  const open = useRail(state => state.open)
  const changed = useSession(snapshot => sessionFilesOf(snapshot).changed.length)
  const running = useSession(snapshot => snapshot.running)

  return (
    <button
      type="button"
      className={clsx(css.button, open && css.open)}
      aria-pressed={open}
      aria-label={open ? t('button.close') : t('button.open')}
      onClick={toggle}
    >
      <IconListPenOutline16 size={14} />
      <span>{t('button.label')}</span>
      {running
        ? <IconLoadingOutline16 size={12} className={css.spinner} />
        : changed > 0 && (
          <span className={css.badge} title={t('button.count', { count: String(changed) })}>
            {changed}
          </span>
        )}
    </button>
  )
}
