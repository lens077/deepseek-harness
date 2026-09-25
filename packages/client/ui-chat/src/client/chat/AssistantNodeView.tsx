import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import type { AssistantExposureInjected, ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'
import { observeReplyExposure } from './reply-exposure.ts'

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, turnProcess, openFile, renderMessageImages, fileMentions, t, useChat, reportReplyExposure,
}: ChatNodeViewProps<'assistant-step'> & AssistantExposureInjected) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const latestTurn = useChat(snapshot => snapshot.timeline.turnOrder.at(-1))
  const bodyRef = useRef<HTMLDivElement>(null)
  const replySeq = turn?.turn === latestTurn && turn?.end?.data.reason.kind === 'completed'
    && data.status === 'settled' && tail?.closing?.finalNode.seq === data.finalNode?.seq
    ? data.finalNode?.seq
    : undefined
  useEffect(() => {
    const body = bodyRef.current
    if (replySeq === undefined || body === null) return
    return observeReplyExposure(body, (exposed) => { reportReplyExposure(replySeq, exposed) })
  }, [replySeq, reportReplyExposure])
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  const reasoningHidden = turnProcess !== undefined
    && turnProcess.foldable
    && turnProcess.spec.answerStep === data.step
    && turnProcess.spec.inlineReasoning
    && !turnProcess.open
  const revealProcess = useCallback(() => { turnProcess?.setOpen(true) }, [turnProcess])
  return (
    <AssistantMarkdown
      bodyRef={bodyRef}
      blocks={data.blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      renderMessageImages={renderMessageImages}
      reasoningHidden={reasoningHidden}
      revealProcess={revealProcess}
      mentions={mentions}
      t={t}
    />
  )
})
