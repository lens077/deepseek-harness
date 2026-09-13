import { useEffect, useRef, useState } from 'react'
import { IconChevronDownOutline14, Menu, Tooltip, type MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { APP_LABEL_KEY, NS, SIDEBAR_CHOICE, type OpenInAppKey } from './locales.ts'
import css from './OpenInAppAction.module.css'

/** Browser operations and state injected into the Session Header contribution. */
export interface OpenInAppActionInjected {
  hooks: {
    openInAppApps: ObservableSnapshot<readonly string[] | null>
    openInAppChoice: ObservableSnapshot<string>
  }
  launch: (appId: string, path: string) => Promise<void>
  /** Remember a catalog id or the Sidebar entry ({@link SIDEBAR_CHOICE}). */
  choose: (choice: string) => void
  /** Open the Sidebar file tree for the current session (the Sidebar entry's main action). */
  openSidebar: () => void
  iconUrl: (appId: string) => string
}

/** Full props for the Session-header open-in-app split button. */
export type OpenInAppActionProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<OpenInAppActionInjected>

/** App ids whose icon image already failed this page; a 404 icon is fetched once, not per menu open. */
const failedIcons = new Set<string>()

/**
 * One application's real bundle icon (host-served PNG) with an inline generic
 * app-square fallback while the host has none.
 * @param props - catalog id, host icon URL, and rendered size.
 * @returns the icon image or its fallback glyph.
 */
function AppIcon({ id, url, size }: { id: string; url: string; size: number }): React.JSX.Element {
  const [failed, setFailed] = useState(failedIcons.has(id))
  if (failed) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className={css.icon}
        aria-hidden
      >
        <rect x={3} y={3} width={18} height={18} rx={5} />
      </svg>
    )
  }
  return (
    <img
      src={url}
      width={size}
      height={size}
      className={css.icon}
      alt=""
      aria-hidden
      draggable={false}
      onError={() => {
        failedIcons.add(id)
        setFailed(true)
      }}
    />
  )
}

/**
 * The Sidebar entry's glyph: a window with its right column marked, drawn
 * inline like the app-square fallback so the two menus rows align.
 * @param props - rendered size.
 * @returns the glyph.
 */
function SidebarIcon({ size }: { size: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className={css.icon}
      aria-hidden
    >
      <rect x={3} y={4} width={18} height={16} rx={3} />
      <path d="M15 4v16" />
    </svg>
  )
}

/**
 * Quick launches settle well under this delay, so their busy dress never
 * paints — the visible dim-and-wait treatment is reserved for launches that
 * are actually taking a while, instead of flashing on every click.
 */
const BUSY_DRESS_DELAY_MS = 250

/**
 * Session-header split button: the main button opens the session's workspace
 * directory in the remembered application, the chevron opens the menu of
 * every application the host probed as installed plus the Sidebar preview
 * entry. The remembered entry also decides where Chat's file clicks go
 * (`chatFileOpener`), so picking here changes both. With the Sidebar
 * remembered, the main button opens the Sidebar file tree instead. It
 * renders nothing until the host reported at least one nameable application
 * and the session has a known workspace directory, so a host without the
 * capability never grows the control.
 * @param props - session runtime, injected controller face, and localized copy.
 * @returns the split button and its menu, or null when there is nothing to offer.
 */
export function OpenInAppAction(props: OpenInAppActionProps): React.JSX.Element | null {
  const { sessionId, useSessions, useOpenInAppApps, useOpenInAppChoice, t } = props
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const available = useOpenInAppApps(apps => apps)
  const choice = useOpenInAppChoice(id => id)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'busy' | 'error'>('idle')
  const inFlight = useRef(false)
  const busyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => {
    clearTimeout(busyTimer.current)
    clearTimeout(errorTimer.current)
  }, [])

  const apps = (available ?? [])
    .map(id => ({ id, labelKey: APP_LABEL_KEY[id] }))
    .filter((entry): entry is { id: string; labelKey: OpenInAppKey } => entry.labelKey !== undefined)
  const sidebar = choice === SIDEBAR_CHOICE
  const currentEntry = apps.find(entry => entry.id === choice) ?? apps[0]
  if (currentEntry === undefined || cwd === undefined || cwd === '') return null

  const current = sidebar ? SIDEBAR_CHOICE : currentEntry.id
  const title = sidebar
    ? t('open.sidebar.title')
    : phase === 'error' ? t('open.error') : t('open.title', { app: t(currentEntry.labelKey) })
  const tooltip = sidebar ? t('open.sidebar.tooltip') : phase === 'error' ? t('open.error') : t('open.tooltip')

  const launch = (appId: string): void => {
    if (inFlight.current) return
    inFlight.current = true
    // A pending error decay must not flip the button back to idle mid-launch.
    clearTimeout(errorTimer.current)
    clearTimeout(busyTimer.current)
    busyTimer.current = setTimeout(() => { setPhase('busy') }, BUSY_DRESS_DELAY_MS)
    props.launch(appId, cwd).then(() => {
      inFlight.current = false
      clearTimeout(busyTimer.current)
      setPhase('idle')
    }, () => {
      inFlight.current = false
      clearTimeout(busyTimer.current)
      setPhase('error')
      clearTimeout(errorTimer.current)
      errorTimer.current = setTimeout(() => { setPhase('idle') }, 2_000)
    })
  }

  const items: MenuItem[] = [
    ...apps.map(entry => ({
      id: entry.id,
      label: t(entry.labelKey),
      icon: <AppIcon id={entry.id} url={props.iconUrl(entry.id)} size={18} />,
    })),
    { id: SIDEBAR_CHOICE, label: t('menu.sidebar'), icon: <SidebarIcon size={18} /> },
  ]

  return (
    <Menu
      open={open}
      align="end"
      dense
      selection="fill"
      onClose={() => { setOpen(false) }}
      items={items}
      selectedId={current}
      onSelect={(id) => {
        setOpen(false)
        // A pick while a launch is in flight is ignored whole: persisting the
        // choice without launching would leave the button naming an app the
        // gesture never opened.
        if (inFlight.current) return
        props.choose(id)
        if (id === SIDEBAR_CHOICE) props.openSidebar()
        else launch(id)
      }}
      anchor={(
        <div className={css.split}>
          <Tooltip label={tooltip} side="bottom">
            <button
              type="button"
              className={css.main}
              data-state={phase}
              disabled={phase === 'busy'}
              aria-label={title}
              onClick={() => { if (sidebar) props.openSidebar(); else launch(current) }}
            >
              {sidebar
                ? <SidebarIcon size={15} />
                : <AppIcon id={current} url={props.iconUrl(current)} size={15} />}
            </button>
          </Tooltip>
          <button
            type="button"
            className={css.chevron}
            aria-expanded={open}
            aria-haspopup="menu"
            title={t('menu.toggle')}
            aria-label={t('menu.toggle')}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconChevronDownOutline14 size={11} />
          </button>
        </div>
      )}
    />
  )
}
