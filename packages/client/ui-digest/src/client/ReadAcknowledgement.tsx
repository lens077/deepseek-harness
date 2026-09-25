/** Explicit acknowledgement of a completed reply; never handles or unpins the Session. */
import { useState } from 'react'
import { Button, IconCheckOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReadAcknowledgementProps } from './contract/slots.ts'
import { unreadReply } from './reading-grace.ts'
import css from './ReadAcknowledgement.module.css'

/**
 * Render the current reply's manual acknowledgement, including in manual-only mode.
 * @param props - Session identity, inbox view, exact-reply writer and localized copy.
 * @returns the action while the completed reply remains unread.
 */
export function ReadAcknowledgement({ sessionId, useSessions, useInbox, markReplySeen, t }: ReadAcknowledgementProps) {
  const row = useSessions(list => list.byId[sessionId])
  const inbox = useInbox(view => view)
  const reply = unreadReply(row, inbox.snapshot)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (reply === null) return null
  const acknowledge = async (): Promise<void> => {
    setPending(true)
    setError(null)
    try {
      const result = await markReplySeen(reply.sessionId, reply.seq)
      if (!result.ok) setError(result.error.message)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }
  return (
    <div className={css.root}>
      <Button variant="toolbar" size="sm" icon={<IconCheckOutline16 />} disabled={pending || inbox.status !== 'ready'} onClick={() => { void acknowledge() }}>
        {pending ? t('read.marking') : t('read.markSeen')}
      </Button>
      {error !== null && <span className={css.error} role="alert">{t('read.failed', { message: error })}</span>}
    </div>
  )
}
