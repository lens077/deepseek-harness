/** Phone frame and navigation share one safe-area-inclusive reservation. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const frame = readFileSync(new URL('../src/client/AppFrame.module.css', import.meta.url), 'utf8')
const sidebar = readFileSync(new URL('../../ui-sidebar/src/client/MobileSidebar.module.css', import.meta.url), 'utf8')

describe('phone navigation sizing', () => {
  it('reserves the bottom safe area only when the presentation owns system insets', () => {
    expect(frame).toMatch(/\.frame\[data-mobile\]\s*\{[^}]*--mobile-nav-safe-area: 0px/s)
    const standalone = /@media \(display-mode: standalone\), \(display-mode: fullscreen\)\s*\{\s*\.frame\[data-mobile\]/s
    const match = standalone.exec(frame)
    expect(match).not.toBeNull()
    expect(frame.slice(match!.index + match![0].length)).toMatch(/^\s*\{\s*--mobile-nav-safe-area: env\(safe-area-inset-bottom, 0px\)/s)
    expect(frame).toContain('--mobile-nav-height: calc(60px + var(--mobile-nav-safe-area))')
    expect(frame).toContain('padding-bottom: var(--mobile-nav-height)')
    const navigation = /\.navigation\s*\{([^}]*)\}/s.exec(sidebar)?.[1]
    expect(navigation).toContain('height: var(--mobile-nav-height)')
    expect(navigation).toContain('padding-bottom: var(--mobile-nav-safe-area)')
    expect(navigation).toContain('box-sizing: border-box')
    expect(sidebar).not.toContain('env(safe-area-inset-bottom')
  })

  it('tracks the dynamic viewport and leaves navigation entries touchable', () => {
    expect(frame).toMatch(/\.frame\[data-mobile\]\s*\{[^}]*height: 100dvh/s)
    expect(sidebar).toMatch(/\.entry\s*\{[^}]*min-height: 44px/s)
  })
})
