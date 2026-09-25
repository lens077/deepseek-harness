/** Pointer capture keeps dragging attached to the character; viewport resize keeps it reachable. */
import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent, RefObject } from 'react'
import type { CompanionPosition } from './store.ts'

interface DragBinding {
  root: RefObject<HTMLElement>
  dragging: boolean
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void
  onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => void
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

/** Bind drag gestures without turning the pointer-up click into a mood change.
 * @param position - saved viewport position, or null while docked.
 * @param move - publish a viewport-clamped position.
 * @param dock - restore the navigation position.
 * @param activate - ordinary tap or keyboard activation.
 * @returns element ref and pointer/keyboard handlers for the character button.
 */
export function useCompanionDrag(
  position: CompanionPosition | null,
  move: (position: CompanionPosition) => void,
  dock: () => void,
  activate: () => void,
): DragBinding {
  const root = useRef<HTMLElement>(null)
  const gesture = useRef<{
    id: number
    target: HTMLButtonElement
    element: HTMLElement
    x: number
    y: number
    left: number
    top: number
    moved: boolean
  } | null>(null)
  const suppressClick = useRef(false)
  const latest = useRef(position)
  latest.current = position
  const [dragging, setDragging] = useState(false)
  const floating = position !== null

  const clamp = (point: CompanionPosition, element: HTMLElement): CompanionPosition => {
    const rect = element.getBoundingClientRect()
    const viewport = window.visualViewport
    const left = viewport?.offsetLeft ?? 0
    const top = viewport?.offsetTop ?? 0
    return {
      x: Math.max(left, Math.min(point.x, left + (viewport?.width ?? window.innerWidth) - rect.width)),
      y: Math.max(top, Math.min(point.y, top + (viewport?.height ?? window.innerHeight) - rect.height)),
    }
  }
  useLayoutEffect(() => {
    const element = root.current
    if (!floating || element === null) return
    const constrain = () => {
      const current = latest.current
      if (current === null) return
      const next = clamp(current, element)
      if (next.x !== current.x || next.y !== current.y) move(next)
    }
    constrain()
    const observer = new ResizeObserver(constrain)
    observer.observe(element)
    const viewport = window.visualViewport
    window.addEventListener('resize', constrain)
    viewport?.addEventListener('resize', constrain)
    viewport?.addEventListener('scroll', constrain)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', constrain)
      viewport?.removeEventListener('resize', constrain)
      viewport?.removeEventListener('scroll', constrain)
    }
  }, [floating, move])
  useLayoutEffect(() => () => {
    const current = gesture.current
    gesture.current = null
    if (current?.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id)
  }, [])

  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current
    if (current === null || current.id !== event.pointerId) return
    gesture.current = null
    suppressClick.current = current.moved
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return {
    root,
    dragging,
    onPointerDown: (event) => {
      if (event.button !== 0 || !event.isPrimary || gesture.current !== null) return
      suppressClick.current = false
      const element = root.current
      if (element === null) return
      const rect = element.getBoundingClientRect()
      gesture.current = { id: event.pointerId, target: event.currentTarget, element,
        x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: (event) => {
      const current = gesture.current
      if (current === null || current.id !== event.pointerId) return
      const dx = event.clientX - current.x
      const dy = event.clientY - current.y
      if (!current.moved && Math.hypot(dx, dy) < 6) return
      current.moved = true
      setDragging(true)
      move(clamp({ x: current.left + dx, y: current.top + dy }, current.element))
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
    onClick: (event) => {
      const dragged = suppressClick.current
      suppressClick.current = false
      if (!dragged || event.detail === 0) activate()
    },
    onKeyDown: (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'Home') {
        event.preventDefault()
        dock()
        return
      }
      const delta: Record<string, CompanionPosition> = {
        ArrowLeft: { x: -16, y: 0 }, ArrowRight: { x: 16, y: 0 },
        ArrowUp: { x: 0, y: -16 }, ArrowDown: { x: 0, y: 16 },
      }
      const offset = delta[event.key]
      if (offset === undefined) return
      event.preventDefault()
      const element = root.current
      if (element === null) return
      const rect = element.getBoundingClientRect()
      move(clamp({ x: rect.left + offset.x, y: rect.top + offset.y }, element))
    },
  }
}
