/** The Layout section: one column rendering feature-owned layout rows. */
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './GeneralSection.module.css'

/** Full component props: section owner share plus layout-item render share. */
export type LayoutSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.layout.item'>

/**
 * Render the Layout section content column.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function LayoutSection({ renderSlot }: LayoutSectionComponentProps) {
  return (
    <div className={css.section}>
      {renderSlot('settings.layout.item', {})}
    </div>
  )
}
