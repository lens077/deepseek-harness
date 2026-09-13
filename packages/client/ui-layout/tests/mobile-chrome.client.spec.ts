/** Phone frame and navigation share one safe-area-inclusive reservation. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const frame = readFileSync(new URL('../src/client/AppFrame.module.css', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../../ui-sidebar/src/client/MobileSidebar.module.css', import.meta.url), 'utf8')

describe('phone navigation sizing', () => {
  it('reserves the bottom safe area only when the presentation owns system insets', () => {
    expect(frame).toMatch(/\.frame\[data-mobile\]\s*\{[^}]*--mobile-nav-safe-area: 0px/s)
    expect(frame).toMatch(/@media \(display-mode: standalone\), \(display-mode: fullscreen\)\s*\{\s*\.frame\[data-mobile\]\s*\{\s*--mobile-nav-safe-area: env\(safe-area-inset-bottom, 0px\)/s)
    expect(frame).toContain('--mobile-nav-height: calc(60px + var(--mobile-nav-safe-area))')
    expect(frame).toContain('padding-bottom: var(--mobile-nav-height)')
    expect(sidebar).toMatch(/\.navigation\s*\{[^}]*height: var\(--mobile-nav-height\);[^}]*padding-bottom: var\(--mobile-nav-safe-area\);[^}]*box-sizing: border-box/s)
    expect(sidebar).not.toContain('env(safe-area-inset-bottom')
  })

  it('tracks the dynamic viewport and leaves navigation entries touchable', () => {
    expect(frame).toMatch(/\.frame\[data-mobile\]\s*\{[^}]*height: 100dvh/s)
    expect(sidebar).toMatch(/\.entry\s*\{[^}]*min-height: 44px/s)
  })
})
