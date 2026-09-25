/** One continuous exposure interval; interruptions discard, rather than accumulate, viewing time. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { InboxSnapshot } from '@deepseek-ai/dsh-session-inbox/types'

/** Exact reply whose exposure may be acknowledged. */
export interface ExposedReply {
  readonly sessionId: SessionId
  readonly seq: number
}

/**
 * Resolve the unread closing answer, independently of sidebar membership or handled state.
 * @param row - the Session list row, possibly not yet loaded.
 * @param inbox - durable seen marks.
 * @returns the completed unread reply, or null without one.
 */
export function unreadReply(row: SessionSummary | undefined, inbox: InboxSnapshot): ExposedReply | null {
  const digest = row?.projectionValues?.sessionDigest
  if (row === undefined || row.running || digest?.outcome !== 'completed' || digest.replySeq === null) return null
  const seen = inbox.sessions.find(mark => mark.sessionId === row.id)?.lastSeenSeq ?? -1
  return digest.replySeq > seen ? { sessionId: row.id, seq: digest.replySeq } : null
}

/** Owns at most one timer and acknowledges each uninterrupted exposure once. */
export class ReadingGrace {
  private current: ExposedReply | null = null
  private seconds = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  /** @param acknowledge - consumes only the reply captured when the interval began. */
  constructor(private readonly acknowledge: (reply: ExposedReply) => void) {}

  /**
   * Replace the qualifying exposure; equal observations preserve the interval.
   * @param reply - visible, unread completed reply, or null when any prerequisite fails.
   * @param seconds - validated configured interval in seconds.
   */
  update(reply: ExposedReply | null, seconds: number): void {
    if (this.current?.sessionId === reply?.sessionId && this.current?.seq === reply?.seq && this.seconds === seconds) return
    this.dispose()
    this.current = reply
    this.seconds = seconds
    if (reply === null) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.acknowledge(reply)
    }, seconds * 1_000)
  }

  /** Cancel the pending interval without acknowledging its reply. */
  dispose(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.current = null
  }
}
