/** Allowed workspace-filter row limits, shared by the viewing store and Layout control. */
export const WORKSPACE_ROWS = ['single', 2, 3, 4, 5, 6, 'all'] as const

/** Single horizontal strip, a natural-height row cap, or unrestricted wrapping. */
export type WorkspaceRows = typeof WORKSPACE_ROWS[number]

/**
 * Decode a browser-stored row limit or select-control value.
 * @param value - persisted JSON or a select option value.
 * @returns an allowed row limit; malformed browser preferences use one row.
 */
export function workspaceRowsOf(value: unknown): WorkspaceRows {
  return WORKSPACE_ROWS.find(option => value === option || value === String(option)) ?? 'single'
}
