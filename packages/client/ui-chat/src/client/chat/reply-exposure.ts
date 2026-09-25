/** Foreground exposure of rendered answer content, excluding reasoning and occluding UI. */

/**
 * Test the visible answer blocks against the scrollport and the topmost hit target.
 * @param body - the Assistant body, whose immediate children are rendered blocks.
 * @returns whether answer content, rather than only reasoning, is visibly exposed.
 */
export function replyExposed(body: HTMLElement): boolean {
  if (!body.isConnected || document.visibilityState !== 'visible' || !document.hasFocus()) return false
  if (body.closest('[hidden], [inert]') !== null) return false
  let left = 0
  let top = 0
  let right = window.innerWidth
  let bottom = window.innerHeight
  for (let parent = body.parentElement; parent !== null; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
    if (/(auto|scroll|hidden|clip)/u.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
      const rect = parent.getBoundingClientRect()
      left = Math.max(left, rect.left)
      top = Math.max(top, rect.top)
      right = Math.min(right, rect.right)
      bottom = Math.min(bottom, rect.bottom)
    }
  }
  for (const block of body.children) {
    if (!(block instanceof HTMLElement) || block.hasAttribute('data-assistant-reasoning')) continue
    const rect = block.getBoundingClientRect()
    const x1 = Math.max(left, rect.left)
    const x2 = Math.min(right, rect.right)
    const y1 = Math.max(top, rect.top)
    const y2 = Math.min(bottom, rect.bottom)
    const style = getComputedStyle(block)
    const fontSize = Number.parseFloat(style.fontSize)
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize
    if (!Number.isFinite(fontSize) || x2 - x1 < Math.min(rect.width, fontSize)
      || y2 - y1 < Math.min(rect.height, lineHeight) || x2 <= x1 || y2 <= y1) continue
    const hit = document.elementFromPoint((x1 + x2) / 2, (y1 + y2) / 2)
    if (hit != null && block.contains(hit)) return true
  }
  return false
}

/**
 * Observe geometry, focus, and application overlays without a polling clock.
 * @param body - rendered Assistant block container.
 * @param report - receives changes in exposure, including false on disposal.
 * @returns a disposer removing all observers and event listeners.
 */
export function observeReplyExposure(body: HTMLElement, report: (exposed: boolean) => void): () => void {
  let previous: boolean | undefined
  const measure = (): void => {
    const exposed = replyExposed(body)
    if (exposed === previous) return
    previous = exposed
    report(exposed)
  }
  const intersection = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(measure)
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
  const mutations = new MutationObserver(measure)
  intersection?.observe(body)
  resize?.observe(body)
  // Portaled menus and dialogs can cover an otherwise intersecting answer.
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'open'] })
  document.addEventListener('scroll', measure, true)
  document.addEventListener('visibilitychange', measure)
  window.addEventListener('focus', measure)
  window.addEventListener('blur', measure)
  window.addEventListener('resize', measure)
  document.addEventListener('transitionend', measure, true)
  measure()
  return () => {
    intersection?.disconnect()
    resize?.disconnect()
    mutations.disconnect()
    document.removeEventListener('scroll', measure, true)
    document.removeEventListener('visibilitychange', measure)
    window.removeEventListener('focus', measure)
    window.removeEventListener('blur', measure)
    window.removeEventListener('resize', measure)
    document.removeEventListener('transitionend', measure, true)
    report(false)
  }
}
