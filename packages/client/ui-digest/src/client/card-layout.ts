/** Browser-local card column choices for the Digest panel. */
export const CARD_COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8] as const

/** Maximum cards per row before available width reduces the count. */
export type CardColumns = typeof CARD_COLUMNS[number]

/**
 * Decode persisted JSON or a select-control value without losing older viewing preferences.
 * @param value - stored or selected column count.
 * @returns one through eight columns; absent or invalid preferences use five.
 */
export function cardColumnsOf(value: unknown): CardColumns {
  return CARD_COLUMNS.find(columns => value === columns || value === String(columns)) ?? 5
}
