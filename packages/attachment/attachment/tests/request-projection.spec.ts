import { describe, expect, it } from 'vitest'
import { requestImageDimensions } from '../src/index.ts'

describe('request image dimensions', () => {
  it.each([
    [4096, 4096, 800, 800],
    [4096, 2048, 1130, 565],
    [3840, 2160, 1066, 600],
    [320, 240, 320, 240],
  ])('projects %sx%s under 640,000 pixels as %sx%s', (width, height, expectedWidth, expectedHeight) => {
    const projected = requestImageDimensions(width, height, 640_000)
    expect(projected).toEqual({
      width: expectedWidth,
      height: expectedHeight,
    })
    expect(projected.width * projected.height).toBeLessThanOrEqual(640_000)
  })

  it('projects a portrait within the same total-pixel budget', () => {
    const projected = requestImageDimensions(2160, 3840, 640_000)

    expect(projected).toEqual({ width: 600, height: 1066 })
    expect(projected.width * projected.height).toBeLessThanOrEqual(640_000)
  })

  it('rounds a portrait inward when integer aspect rounding crosses the pixel cap', () => {
    expect(requestImageDimensions(2, 4, 5)).toEqual({ width: 1, height: 2 })
  })

  describe('per-edge cap', () => {
    it('caps the long edge of a screenshot that fits the pixel budget untouched', () => {
      // 2374×1698 = 4,031,052 px fits a 2048² budget yet exceeds Anthropic's
      // 2000 px many-image edge limit.
      const projected = requestImageDimensions(2374, 1698, 2048 * 2048, 2000)

      expect(projected).toEqual({ width: 2000, height: 1430 })
    })

    it('caps a portrait long edge', () => {
      const projected = requestImageDimensions(1568, 2270, 2048 * 2048, 2000)

      expect(projected).toEqual({ width: 1381, height: 2000 })
    })

    it.each([
      [4096, 4096, 800, 800],
      [2000, 1000, 1130, 565],
      [320, 240, 320, 240],
    ])('leaves %sx%s to the pixel budget when both edges are within the cap', (width, height, expectedWidth, expectedHeight) => {
      expect(requestImageDimensions(width, height, 640_000, 2000)).toEqual({ width: expectedWidth, height: expectedHeight })
    })

    it('applies the tighter of the two caps', () => {
      const projected = requestImageDimensions(8000, 400, 2048 * 2048, 2000)

      expect(projected).toEqual({ width: 2000, height: 100 })
      expect(requestImageDimensions(8000, 400, 640_000, 2000)).toEqual({ width: 2000, height: 100 })
      expect(requestImageDimensions(8000, 400, 100_000, 2000)).toEqual({ width: 1409, height: 70 })
    })

    it('rounds inward when the short edge rounds above the cap', () => {
      expect(requestImageDimensions(2, 4, 1_000, 1)).toEqual({ width: 1, height: 1 })
    })
  })
})
