/**
 * Pure request-projection geometry shared by attachment providers and
 * provider-side request pricing. @module @deepseek-ai/dsh-attachment/request-projection
 */

/**
 * Compute aspect-preserving integer dimensions within a hard total-pixel
 * budget and, when given, a hard per-edge cap.
 *
 * The per-edge cap exists because a total-pixel budget alone admits a long
 * edge the provider refuses: Anthropic rejects a request carrying more than
 * 20 images when any of them exceeds 2000 pixels on either edge, and a
 * 2374×1698 screenshot fits a 2048×2048 pixel budget untouched.
 * @param width - positive source width.
 * @param height - positive source height.
 * @param maxPixels - positive width-times-height cap.
 * @param maxDimension - optional positive cap on the larger edge; omission caps neither edge.
 * @returns inward-rounded dimensions satisfying both caps; small images are not enlarged.
 */
export function requestImageDimensions(
  width: number,
  height: number,
  maxPixels: number,
  maxDimension?: number,
): { width: number; height: number } {
  const fits = (candidateWidth: number, candidateHeight: number): boolean =>
    candidateWidth * candidateHeight <= maxPixels
    && (maxDimension === undefined || Math.max(candidateWidth, candidateHeight) <= maxDimension)
  if (fits(width, height)) return { width, height }
  const pixelScale = Math.sqrt(maxPixels / (width * height))
  // The edge cap is applied as an exact integer: scaling the long edge by
  // `maxDimension / longEdge` can land one unit short after floating-point rounding.
  const longEdgeCap = maxDimension ?? Number.POSITIVE_INFINITY
  if (width >= height) {
    let projectedWidth = Math.max(1, Math.min(width, Math.floor(width * pixelScale), longEdgeCap))
    let projectedHeight = Math.max(1, Math.round(projectedWidth * height / width))
    while (!fits(projectedWidth, projectedHeight) && projectedWidth > 1) {
      projectedWidth -= 1
      projectedHeight = Math.max(1, Math.round(projectedWidth * height / width))
    }
    return { width: projectedWidth, height: projectedHeight }
  }
  let projectedHeight = Math.max(1, Math.min(height, Math.floor(height * pixelScale), longEdgeCap))
  let projectedWidth = Math.max(1, Math.round(projectedHeight * width / height))
  while (!fits(projectedWidth, projectedHeight) && projectedHeight > 1) {
    projectedHeight -= 1
    projectedWidth = Math.max(1, Math.round(projectedHeight * width / height))
  }
  return { width: projectedWidth, height: projectedHeight }
}
