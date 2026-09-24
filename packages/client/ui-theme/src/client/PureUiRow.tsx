/**
 * Pure-UI preference row registered into the General section item slot: title
 * + description + Switch. Registered by this package — the theme feature owns
 * the presentation switch the same way it owns the appearance preference. The
 * switch echoes the persisted value, never the click.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MobileAppearance } from './mobile-appearance.ts'
import css from './PureUiRow.module.css'

/** Theme-owned observable and the pure-UI preference write. */
export interface PureUiRowInjected {
  hooks: { mobileAppearance: ObservableSnapshot<MobileAppearance> }
  /** Switch the pure-UI presentation on every viewport. */
  setPureUi: (enabled: boolean) => void
}

/** Full component props: runtime share + locale seat + injected face. */
export type PureUiRowComponentProps =
  PropsRuntime<'settings.layout.item'> & PropsLocale<'settings.theme'> & InjectFace<PureUiRowInjected>

/**
 * Render the pure-UI row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function PureUiRow({ useMobileAppearance, setPureUi, t }: PureUiRowComponentProps) {
  const enabled = useMobileAppearance(value => value.pureUi)
  return (
    <div className={css.row} data-pure-ui-row>
      <div className={css.rowText}>
        <div className={css.title}>{t('pureUi.title')}</div>
        <div className={css.desc}>{t('pureUi.description')}</div>
      </div>
      <Switch checked={enabled} label={t('pureUi.title')} onChange={setPureUi} />
    </div>
  )
}
