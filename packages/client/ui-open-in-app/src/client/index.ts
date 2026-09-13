/**
 * Browser half of open-in-app: one Session-header split button opening the
 * session's workspace directory (the summary's `cwd`) in the remembered
 * installed application, and the `chatFileOpener` service that sends Chat's
 * file clicks to the same remembered application. Availability arrives once
 * per page from the host apps route; the last choice persists in the browser
 * through the controller's persisted snapshot store. The menu also offers
 * the Sidebar preview: choosing it keeps file clicks inside the product and
 * turns the header button into the Sidebar file-tree opener.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ChatFileOpener } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { OPEN_IN_APP_ICON_PREFIX } from '@deepseek-ai/dsh-host-open-in-app/shared'
import { OpenInAppController, OpenInAppLaunchError } from './controller.ts'
import { OpenInAppAction, type OpenInAppActionInjected } from './OpenInAppAction.tsx'
import { APP_LABEL_KEY, en, NS, zh, type OpenInAppKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session-header "open workspace in application" copy. */
    'open-in-app': OpenInAppKey
  }
}

export type { OpenInAppActionInjected, OpenInAppActionProps } from './OpenInAppAction.tsx'

/** The Sidebar file-tree kind the Sidebar choice opens from the header button. */
const SIDEBAR_FILES_KIND = 'files'

/** Required services for locale registration, the header-slot contribution, and the file opener. */
export const inject = ['sessions', 'slots', 'locale']

/**
 * Client plugin body: register the dictionaries, the header split button,
 * and the Chat file opener.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new OpenInAppController()
  void controller.load()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'open-in-app: dictionaries')
  const t = ctx.locale.bind(NS)
  const appLabel = (appId: string): string => {
    const key = APP_LABEL_KEY[appId]
    return key === undefined ? appId : t(key)
  }

  // Chat's file clicks: the Sidebar and "no launcher at all" leave Chat on
  // its own Sidebar path; every other target — including a remembered app
  // this host no longer offers — takes the click, so the user sees why it
  // did not open rather than a silent fallback.
  const fileOpener: ChatFileOpener = {
    active: () => {
      const kind = controller.fileTarget().kind
      return kind !== 'sidebar' && kind !== 'unavailable'
    },
    open: async (path) => {
      try {
        await controller.openFile(path)
      } catch (error: unknown) {
        if (!(error instanceof OpenInAppLaunchError)) throw error
        switch (error.code) {
          case 'not-installed': throw new Error(t('file.notInstalled', { app: appLabel(error.appId) }))
          case 'launch-failed': throw new Error(t('file.failed', { app: appLabel(error.appId) }))
          case 'unavailable': throw new Error(t('file.unavailable'))
        }
      }
    },
  }
  ctx.provide('chatFileOpener', fileOpener)

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'open-in-app',
    order: -10,
    locale: NS,
    inject: (): OpenInAppActionInjected => ({
      hooks: {
        openInAppApps: controller.apps,
        openInAppChoice: controller.choice,
      },
      launch: (appId, path) => controller.launch(appId, path),
      choose: (choice) => { controller.choose(choice) },
      openSidebar: () => { ctx.get('sidebarRight')?.openTab(SIDEBAR_FILES_KIND) },
      iconUrl: appId => `${OPEN_IN_APP_ICON_PREFIX}/${appId}`,
    }),
  }, OpenInAppAction))
}
