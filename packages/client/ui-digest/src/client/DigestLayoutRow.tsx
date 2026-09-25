/** Workspace-filter display preference contributed to Settings → Layout. */
import { useId } from 'react'
import type { DigestLayoutRowProps } from './contract/slots.ts'
import { WORKSPACE_ROWS, workspaceRowsOf } from './workspace-layout.ts'
import css from './DigestLayoutRow.module.css'

/**
 * Render the browser-local workspace row limit without changing the active filter.
 * @param props - the panel's shared viewing store and localized copy.
 * @returns the labeled Layout preference.
 */
export function DigestLayoutRow({ useStore, actions, t }: DigestLayoutRowProps) {
  const id = useId()
  const rows = useStore(state => workspaceRowsOf(state.workspaceRows))
  return (
    <div className={css.row}>
      <div className={css.text}>
        <label className={css.label} htmlFor={id}>{t('workspaceLayout.title')}</label>
        <p id={`${id}-hint`} className={css.hint}>{t('workspaceLayout.hint')}</p>
      </div>
      <select
        id={id}
        className={css.select}
        value={rows}
        aria-describedby={`${id}-hint`}
        onChange={(event) => { actions.setWorkspaceRows(workspaceRowsOf(event.currentTarget.value)) }}
      >
        {WORKSPACE_ROWS.map(value => (
          <option key={value} value={value}>
            {typeof value === 'number' ? t('workspaceLayout.rows', { count: value }) : t(`workspaceLayout.${value}`)}
          </option>
        ))}
      </select>
    </div>
  )
}
