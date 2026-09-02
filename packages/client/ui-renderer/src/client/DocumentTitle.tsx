import { useEffect } from 'react'

const DEFAULT_CLIENT_TITLE = 'DSH Local Build'

/**
 * Run state a reader can act on from a background tab: work is still going, or
 * work they left running has finished. Anything else needs the window.
 */
export type DocumentTitleStatus = 'running' | 'done'

/**
 * Leading mark per status. The tab strip shows a few characters of the title
 * and nothing else, so the signal has to survive being cut to its first glyph.
 */
const STATUS_MARK: Record<DocumentTitleStatus, string> = { running: '● ', done: '✓ ' }

/** Props for the browser title projection. */
export interface DocumentTitleProps {
  /** Durable title of the selected session, or undefined for the product title. */
  title?: string
  /** Ambient run state prefixed to the title; absent leaves the plain title. */
  status?: DocumentTitleStatus
  /** Number of things needing the user, shown as `(N)` before everything else; 0 shows nothing. */
  badge?: number
}

/**
 * The browser-title count seat: one number any plugin may set, observed by
 * the title projection. Zero means no count is shown.
 */
export interface DocumentBadge {
  /** Report the current count. */
  set: (count: number) => void
  getSnapshot: () => number
  subscribe: (listener: () => void) => () => void
}

/**
 * Create the badge seat.
 * @returns a badge whose snapshot is the last count set.
 */
export function createDocumentBadge(): DocumentBadge {
  let value = 0
  const listeners = new Set<() => void>()
  return {
    set: (count) => {
      if (count === value) return
      value = count
      for (const listener of listeners) listener()
    },
    getSnapshot: () => value,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/**
 * Project the selected durable session title, whether anything is running,
 * and the attention count into the browser title, restoring the build-selected product title when
 * unmounted.
 * @param props - Selected session title and ambient run state.
 * @returns No rendered content.
 */
export function DocumentTitle({ title, status, badge }: DocumentTitleProps): null {
  const productTitle = process.env.DSH_CLIENT_TITLE ?? DEFAULT_CLIENT_TITLE
  useEffect(() => {
    const count = badge === undefined || badge <= 0 ? '' : `(${badge}) `
    const mark = status === undefined ? '' : STATUS_MARK[status]
    document.title = title === undefined ? `${count}${mark}${productTitle}` : `${count}${mark}${title} — ${productTitle}`
    return () => { document.title = productTitle }
  }, [badge, productTitle, status, title])
  return null
}
