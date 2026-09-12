/** The file-lock policy's card: how long a session waits for a file another session is modifying. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ChoiceField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { FileLockCardFace } from './file-lock-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the file-lock card. */
export type FileLockCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<FileLockCardFace>

/**
 * Render the file-lock card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function FileLockCard(props: FileLockCardProps) {
  const { t } = props
  const state = props.useFileLockCard(snapshot => snapshot)
  return (
    <PluginCard
      t={t}
      titleKey="fileLockTitle"
      descriptionKey="fileLockDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <ValueField
        id="plugin-config-file-lock-read-wait"
        label={t('fileLockReadWait')}
        hint={t('fileLockReadWaitHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.readWaitSeconds}
        onEdit={(text) => { props.edit('readWaitMs', text) }}
        onReset={() => { props.resetField('readWaitMs') }}
      />
      <ValueField
        id="plugin-config-file-lock-write-wait"
        label={t('fileLockWriteWait')}
        hint={t('fileLockWriteWaitHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.writeWaitMinutes}
        onEdit={(text) => { props.edit('writeWaitMs', text) }}
        onReset={() => { props.resetField('writeWaitMs') }}
      />
      <ValueField
        id="plugin-config-file-lock-lease-ttl"
        label={t('fileLockLeaseTtl')}
        hint={t('fileLockLeaseTtlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.leaseTtlMinutes}
        onEdit={(text) => { props.edit('leaseTtlMs', text) }}
        onReset={() => { props.resetField('leaseTtlMs') }}
      />
      <ChoiceField
        id="plugin-config-file-lock-delegated"
        label={t('fileLockDelegated')}
        hint={t('fileLockDelegatedHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('fileLockDelegatedInvalid')}
        disabled={!state.writable}
        choices={[
          { value: 'wait', label: t('fileLockDelegatedWait') },
          { value: 'read-now', label: t('fileLockDelegatedReadNow') },
        ]}
        {...state.delegatedReadTimeout}
        onEdit={(value) => { props.edit('delegatedReadTimeout', value) }}
        onReset={() => { props.resetField('delegatedReadTimeout') }}
      />
    </PluginCard>
  )
}
