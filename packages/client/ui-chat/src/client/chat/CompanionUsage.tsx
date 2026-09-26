/** Companion adapter reuses the Chat-owned usage drawer and framework projections. */
import { useRef } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-companion/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { UsageLedgerDrawer } from './UsageLedgerPanel.tsx'
import { UsagePreview } from './UsagePreview.tsx'

/** Optional-session slot props; global usage does not create or select a Session. */
export type CompanionUsageProps = PropsRuntime<'companion.usage.panel'> & PropsLocale<'chat'>

/** Display the requested usage audience using the existing accounting UI.
 * @param props - optional active Session, requested scope, and dismissal callback.
 * @returns the shared usage drawer, including missing-snapshot disclosures.
 */
export function CompanionUsage(props: CompanionUsageProps) {
  const { sessionId, useProjection, useSessions, initialScope, onClose, t } = props
  const ledger = useProjection('usageLedger')
  const trigger = useRef<HTMLButtonElement>(null)
  if (initialScope === 'today' || initialScope === 'week' || initialScope === 'month') {
    return <UsagePreview {...props} period={initialScope} />
  }
  return <UsageLedgerDrawer sessionId={sessionId} ledger={ledger} useSessions={useSessions}
    initialScope={initialScope} onClose={onClose} trigger={trigger} t={t} />
}
