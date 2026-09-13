/** Focus containment and background isolation for the usage drawer's Modal. */
import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Isolate a mounted drawer, contain Tab/focus, and restore the opening control.
 * @param trigger - the control that opened this drawer.
 * @returns a ref for a descendant of the shared Modal's dialog element.
 */
export function useUsageDialog(trigger: RefObject<HTMLButtonElement>): RefObject<HTMLDivElement> {
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const dialog = content.current?.closest<HTMLElement>('[role="dialog"]')
    const portal = dialog?.parentElement
    if (dialog === undefined || dialog === null || portal === undefined || portal === null) return
    const previousFocus = trigger.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const backgrounds = [...document.body.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node !== portal)
      .map(node => ({ node, inert: node.inert, hidden: node.getAttribute('aria-hidden') }))
    for (const { node } of backgrounds) {
      node.inert = true
      node.setAttribute('aria-hidden', 'true')
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = (): HTMLElement[] => [...dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    )].filter(node => !node.hidden && !node.closest('[hidden], [inert]'))
    const focusFirst = (): void => { (focusable()[0] ?? dialog).focus() }
    dialog.tabIndex = -1
    focusFirst()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const targets = focusable()
      const first = targets[0]
      const last = targets.at(-1)
      if (first === undefined || last === undefined) {
        event.preventDefault()
        dialog.focus()
      } else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    const onFocus = (event: FocusEvent): void => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusFirst()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocus)
      for (const { node, inert, hidden } of backgrounds) {
        node.inert = inert
        if (hidden === null) node.removeAttribute('aria-hidden')
        else node.setAttribute('aria-hidden', hidden)
      }
      document.body.style.overflow = overflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [trigger])
  return content
}
