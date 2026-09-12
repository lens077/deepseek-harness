import type { Context } from '@deepseek-ai/cordis'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { hasPriorContent, IconEditOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatFileDiffExpansion } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { diffCardModel } from '../models/diff-card-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

/** Optional inline-diff preference projected into each mutation row. */
export interface FileMutationRowInjected {
  /** Reactive settings sources converted to component selector hooks by the slot runtime. */
  hooks: { diffExpansion: ObservableSnapshot<ChatFileDiffExpansion> }
}

type FileMutationRowProps =
  ToolCallViewProps & PropsLocale<'conversation'> & InjectFace<FileMutationRowInjected>

/**
 * Lets users expand an applied file diff and open the reported path.
 */
export function FileMutationRow({
  toolName, block, cwd, home, openFile, inspect, useDiffExpansion, t,
}: FileMutationRowProps) {
  const model = toolRowModel(toolName, block, cwd, home)
  const diff = diffCardModel(block)
  const openOnArrival = useDiffExpansion(mode => mode === 'all')
  return (
    <ToolRow
      initiallyExpanded={diff !== null && openOnArrival && hasPriorContent(diff.card.diffs)}
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconEditOutline16 size={14} />}
      title={t(model.titleKey)}
      summary={model.summary}
      output={model.output}
      errorSummary={model.errorSummary}
      diff={diff}
      state={model.state}
      filePath={model.filePath}
      onOpenFile={openFile}
      inspect={inspect}
    />
  )
}

/** Registers the edit and write conversation rows. */
export const fileMutationToolview = {
  name: 'file-mutation-toolview',
  inject: ['slots'],
  apply(ctx: Context): void {
    const diffExpansion: ObservableSnapshot<ChatFileDiffExpansion> = {
      getSnapshot: () => ctx.get('chatFileDiffs')?.expansion.getSnapshot() ?? 'none',
      subscribe: listener => ctx.get('chatFileDiffs')?.expansion.subscribe(listener) ?? (() => {}),
    }
    const inject = (): FileMutationRowInjected => ({ hooks: { diffExpansion } })
    ctx.slots.inject('tool.call.toolview', function* () {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'edit', locale: NS, inject }, FileMutationRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'write', locale: NS, inject }, FileMutationRow)
    })
  },
}
