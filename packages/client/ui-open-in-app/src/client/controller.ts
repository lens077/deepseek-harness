/** Browser availability/choice state and the launch carrier for the split button. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  OPEN_IN_APP_APPS_ROUTE, OPEN_IN_APP_OPEN_ROUTE,
  type OpenInAppAppsPayload, type OpenInAppOpenFailure, type OpenInAppOpenPayload,
} from '@deepseek-ai/dsh-host-open-in-app/shared'
import { SIDEBAR_CHOICE } from './locales.ts'

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

/** Resolve the browser's Host base with the connection carrier's null-origin fallback. */
function hostBase(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

/**
 * Why a launch was refused, for the caller to word: the app was never
 * offered by this host (`not-installed`), the host has no launcher at all
 * (`unavailable`), or the host tried and failed (`launch-failed`).
 */
export type OpenInAppLaunchErrorCode = 'not-installed' | 'unavailable' | 'launch-failed'

/** Launch refusal carrying its stable reason and the app it concerned. */
export class OpenInAppLaunchError extends Error {
  /**
   * @param code - stable refusal reason.
   * @param appId - catalog id the launch concerned (empty for `unavailable`).
   * @param detail - host diagnostic, when one arrived.
   */
  constructor(readonly code: OpenInAppLaunchErrorCode, readonly appId: string, detail?: string) {
    super(detail ?? `open-in-app: ${code}`)
    this.name = 'OpenInAppLaunchError'
  }
}

/**
 * Where a file click goes: an installed catalog id, or the Sidebar. The
 * remembered choice wins when the host still offers it; a remembered app the
 * host no longer offers is reported as such (never silently replaced, so an
 * uninstalled editor produces a warning instead of a surprise); no choice
 * means the first offered app, which the catalog orders as the platform file
 * manager (Finder, File Explorer) — present on every desktop host.
 */
export type OpenInAppFileTarget =
  | { readonly kind: 'sidebar' }
  | { readonly kind: 'app'; readonly appId: string }
  | { readonly kind: 'not-installed'; readonly appId: string }
  | { readonly kind: 'unavailable' }
  /** The host has not answered the availability read yet. */
  | { readonly kind: 'pending' }

/**
 * Owns the once-per-page availability read, the persisted last choice, and
 * the launch POST. Availability and choice publish through uSES-safe sources
 * so every Session header shares one truth.
 */
export class OpenInAppController {
  /** Installed app ids in host menu order; null until the host answered. */
  readonly apps: SnapshotStore<readonly string[] | null> = createSnapshotStore<readonly string[] | null>(null)
  /**
   * Last chosen entry — a catalog id or {@link SIDEBAR_CHOICE} — or empty
   * before the first choice, shared across sessions and browser restarts.
   */
  readonly choice: SnapshotStore<string> = createSnapshotStore<string>('', {
    persist: { name: 'dsh.open-in-app.choice' },
  })

  private loading: Promise<void> | undefined

  /**
   * @param fetcher - HTTP carrier for the apps read and the launch POST.
   */
  constructor(private readonly fetcher: Fetch = (input, init) => fetch(input, init)) {}

  /**
   * Read availability once per controller life; concurrent calls share the read.
   * A failed read publishes an empty list, which renders no button at all.
   * @returns after availability is published.
   */
  load(): Promise<void> {
    this.loading ??= this.run()
    return this.loading
  }

  /**
   * Remember one picked entry.
   * @param choice - catalog id from the availability list, or {@link SIDEBAR_CHOICE}.
   */
  choose(choice: string): void {
    this.choice.set(choice)
  }

  /**
   * Resolve where a file click goes right now, from the published
   * availability and choice (see {@link OpenInAppFileTarget}). Before the
   * host answered the target is `pending`; {@link openFile} waits for the
   * answer itself, so a caller may hand it the click regardless.
   * @returns the current file target.
   */
  fileTarget(): OpenInAppFileTarget {
    const choice = this.choice.getSnapshot()
    if (choice === SIDEBAR_CHOICE) return { kind: 'sidebar' }
    const apps = this.apps.getSnapshot()
    if (apps === null) return { kind: 'pending' }
    if (choice !== '') {
      return apps.includes(choice) ? { kind: 'app', appId: choice } : { kind: 'not-installed', appId: choice }
    }
    const first = apps[0]
    return first === undefined ? { kind: 'unavailable' } : { kind: 'app', appId: first }
  }

  /**
   * Open one file in the current file target's application.
   * @param path - absolute Host path of the file.
   * @returns after the host acknowledged the launch.
   * @throws {OpenInAppLaunchError} when the target is not an installed app
   *   or the host could not launch it; a Sidebar target is the caller's to
   *   handle and is refused as `unavailable`.
   */
  async openFile(path: string): Promise<void> {
    await this.load()
    const target = this.fileTarget()
    switch (target.kind) {
      case 'app': return this.launch(target.appId, path)
      case 'not-installed': throw new OpenInAppLaunchError('not-installed', target.appId)
      case 'sidebar':
      case 'unavailable': throw new OpenInAppLaunchError('unavailable', '')
      /* v8 ignore next 2 -- `load()` settled above, so availability is published. */
      case 'pending': throw new OpenInAppLaunchError('unavailable', '')
    }
  }

  /**
   * Launch one installed app on a workspace directory or file.
   * @param appId - catalog id from the availability list.
   * @param path - absolute directory or file path.
   * @returns after the host acknowledged the launch.
   * @throws {OpenInAppLaunchError} `launch-failed` with the host's diagnostic
   *   when the host refused or the launch failed.
   */
  async launch(appId: string, path: string): Promise<void> {
    const body: OpenInAppOpenPayload = { app: appId, path }
    const response = await this.fetcher(new URL(OPEN_IN_APP_OPEN_ROUTE, hostBase()), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.ok) return
    let detail = `open failed: HTTP ${String(response.status)}`
    try {
      const failure = await response.json() as Partial<OpenInAppOpenFailure>
      if (typeof failure.message === 'string' && failure.message !== '') detail = failure.message
    } catch {
      // Swallows a non-JSON failure body: the status line above is the detail.
    }
    throw new OpenInAppLaunchError('launch-failed', appId, detail)
  }

  private async run(): Promise<void> {
    let apps: readonly string[] = []
    try {
      const response = await this.fetcher(new URL(OPEN_IN_APP_APPS_ROUTE, hostBase()), {
        headers: { accept: 'application/json' },
      })
      if (response.ok) {
        const payload = await response.json() as OpenInAppAppsPayload
        if (Array.isArray(payload.apps)) apps = payload.apps.filter(id => typeof id === 'string')
      }
    } catch {
      // Swallows network failures: an unreachable host reads as no apps, and
      // the header simply shows no button rather than a broken one.
    }
    this.apps.set(apps)
  }
}
