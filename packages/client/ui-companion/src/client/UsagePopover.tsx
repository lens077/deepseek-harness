/** Non-modal anchored preview: dismisses outside, keeps the application usable. */
import { useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './UsagePopover.module.css'

/** Place the usage preview beside its companion without clipping inside the sidebar.
 * @param props - local anchor, localized name, close callback, and slot content.
 * @returns a small non-modal dialog portal.
 */
export function UsagePopover({ anchor, label, onClose, children }: {
  anchor: RefObject<HTMLElement>
  label: string
  onClose: () => void
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const position = useAnchoredPosition({ open: true, anchorRef: anchor, panelRef: panel, side: 'top', gap: 8, margin: 12 })
  useEffect(() => {
    const frame = requestAnimationFrame(() => { panel.current?.querySelector<HTMLButtonElement>('button')?.focus() })
    const pointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !anchor.current?.contains(event.target)) onClose()
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', pointer)
    document.addEventListener('keydown', key)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', pointer)
      document.removeEventListener('keydown', key)
    }
  }, [anchor, onClose])
  return createPortal(<div ref={panel} className={css.panel} role="dialog" aria-label={label}
    data-usage-preview style={position ?? { visibility: 'hidden' }}>{children}</div>, document.body)
}
