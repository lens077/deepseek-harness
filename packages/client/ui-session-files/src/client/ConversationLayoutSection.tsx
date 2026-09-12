/**
 * The Conversation-layout settings section: one column rendering row
 * contributions, mirroring the General section's arrangement. This package
 * owns the section (it holds the conversation surface's layout preferences)
 * and declares the row seat at register time.
 */
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './ConversationLayoutSection.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One preference row inside the Conversation-layout settings section —
     * the additive seat for a conversation-surface layout preference,
     * mirroring `settings.general.item`: the section column only stacks
     * rows, a row draws its own internals (label included), and the owner
     * passes no props. Declared at runtime by this package's section entry;
     * the type lives here because this package is the only registrant — a
     * second contributor moves it to the settings domain base.
     */
    'settings.conversation-layout.item': { kind: 'list'; scope: 'root'; owner: ConversationLayoutItemOwnerProps }
  }
}

/** Owner share of a Conversation-layout row (the section supplies nothing). */
export interface ConversationLayoutItemOwnerProps {
  /** Marker field: item owner props are intentionally empty. */
  children?: never
}

/** Full component props: section owner share plus row render share. */
export type ConversationLayoutSectionProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.conversation-layout.item'>

/**
 * Render the Conversation-layout section content column.
 * @param props - composed slot props.
 * @returns the section element tree.
 */
export function ConversationLayoutSection({ renderSlot }: ConversationLayoutSectionProps) {
  return (
    <div className={css.section}>
      {renderSlot('settings.conversation-layout.item', {})}
    </div>
  )
}
