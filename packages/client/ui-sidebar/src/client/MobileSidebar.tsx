/** Phone navigation chrome; business surfaces remain slot contributions. */
import { useState } from 'react'
import { IconNewChatOutline16, IconProjectAddOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import css from './MobileSidebar.module.css'

/** Render fixed phone navigation around the full-width active surface. */
export function MobileSidebar({ mobileView, navigateMobile, renderSlot, startUngrouped, t }: SidebarRootComponentProps) {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const start = (): void => {
    setStarting(true)
    setError(null)
    void startUngrouped().then(() => {
      setStarting(false)
      navigateMobile?.('new')
    }, (reason: unknown) => {
      setStarting(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return (
    <>
      <header className={css.header}>
        <span className={css.title}>{t('brand.localBuild')}</span>
        <div className={css.settings}>{renderSlot('sidebar.settings', { wide: false })}</div>
      </header>
      <div className={css.workspaces} hidden={mobileView !== 'workspaces'}>
        {renderSlot('sidebar.workspaces', {
          wide: true,
          mobile: true,
          expandSidebar: () => {},
          onSessionOpened: () => { navigateMobile?.('conversation') },
        })}
      </div>
      {error !== null && <div className={css.error} role="alert">{t('mobile.newFailed', { message: error })}</div>}
      <nav className={css.navigation} aria-label={t('mobile.navigation')}>
        {renderSlot('sidebar.nav.entry', {
          wide: true,
          ...(mobileView === undefined ? {} : { mobileView }),
          ...(navigateMobile === undefined ? {} : { navigateMobile }),
        })}
        <button type="button" className={css.entry} aria-label={t('mobile.workspaces')} aria-current={mobileView === 'workspaces' ? 'page' : undefined}
          onClick={() => { navigateMobile?.('workspaces') }}>
          <IconProjectAddOutline16 size={20} />
          <span>{t('mobile.workspaces')}</span>
        </button>
        <button type="button" className={css.entry} aria-label={t('session.new')} aria-current={mobileView === 'new' ? 'page' : undefined}
          disabled={starting} aria-busy={starting} onClick={start}>
          <IconNewChatOutline16 size={20} />
          <span>{t('session.new')}</span>
        </button>
      </nav>
    </>
  )
}
