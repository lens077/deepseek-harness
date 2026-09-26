import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import clsx from 'clsx'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconCloseOutline16, IconEllipsisOutline16, IconWarningOutline16,
  Menu, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionAutoPinStatus, SessionPinsSidebarRows } from '../contract/slots.ts'
import type { SessionNode } from '../tree.ts'
import {
  PIN_SHORTCUT_DIGIT_PRESET, formatPinShortcut, hasPinShortcutCommandModifier, pinShortcutConflict, spellPinShortcut,
  type PinShortcutChord, type PinShortcutOwner, type PinShortcutPlatform,
} from '../pin-shortcuts.ts'
import { SessionNodeItem, type SessionRowContext } from './Rows.tsx'
import css from './PinnedArea.module.css'

/** Row counts the ⋯ menu offers beside `auto`, matching the settings page. */
const ROW_OPTIONS: readonly number[] = Array.from({ length: 20 }, (_, index) => index + 1)

/** Status rows in the ⋯ menu, in the order the settings page lists them. */
const STATUS_OPTIONS: readonly SessionAutoPinStatus[] = ['running', 'completed', 'failed']

const ROW_PREFIX = 'rows-'
const STATUS_PREFIX = 'status-'
const SHORTCUTS_ENABLED = 'shortcuts-enabled'
const SHORTCUTS_EDIT = 'shortcuts-edit'

/** Pinned-area options: the row count group, the independent auto-pin status toggles, and the shortcut switch and editor. */
function PinnedOptionsMenu({ rows, autoStatuses, shortcutsEnabled, onRowsPick, onStatusToggle, onShortcutsEnabled, onShortcutsEdit, t }: {
  rows: SessionPinsSidebarRows
  autoStatuses: readonly SessionAutoPinStatus[]
  shortcutsEnabled: boolean
  onRowsPick: (rows: SessionPinsSidebarRows) => void
  onStatusToggle: (status: SessionAutoPinStatus) => void
  onShortcutsEnabled: (enabled: boolean) => void
  onShortcutsEdit: () => void
  t: SessionRowContext['t']
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={[
        { type: 'label' as const, id: 'rows', text: t('pinned.rows.label') },
        { id: `${ROW_PREFIX}auto`, label: t('pinned.rows.auto') },
        ...ROW_OPTIONS.map(count => ({ id: `${ROW_PREFIX}${count}`, label: String(count) })),
        { type: 'separator' as const, id: 'auto-separator' },
        { type: 'label' as const, id: 'auto', text: t('pinned.auto.label') },
        ...STATUS_OPTIONS.map(status => ({ id: `${STATUS_PREFIX}${status}`, label: t(`pinned.auto.${status}`) })),
        { type: 'separator' as const, id: 'shortcuts-separator' },
        { type: 'label' as const, id: 'shortcuts', text: t('pinned.shortcuts.label') },
        { id: SHORTCUTS_ENABLED, label: t('pinned.shortcuts.enabled') },
        { id: SHORTCUTS_EDIT, label: t('pinned.shortcuts.edit') },
      ]}
      selectedIds={[
        `${ROW_PREFIX}${rows}`,
        ...autoStatuses.map(status => `${STATUS_PREFIX}${status}`),
        ...shortcutsEnabled ? [SHORTCUTS_ENABLED] : [],
      ]}
      onSelect={(id) => {
        if (id.startsWith(STATUS_PREFIX)) {
          // Status toggles are independent checks; the list stays open so
          // several can be flipped in one visit.
          onStatusToggle(id.slice(STATUS_PREFIX.length) as SessionAutoPinStatus)
          return
        }
        if (id === SHORTCUTS_ENABLED) {
          onShortcutsEnabled(!shortcutsEnabled)
          return
        }
        setOpen(false)
        if (id === SHORTCUTS_EDIT) {
          onShortcutsEdit()
          return
        }
        const picked = id.slice(ROW_PREFIX.length)
        onRowsPick(picked === 'auto' ? 'auto' : Number(picked))
      }}
      align="end"
      dense
      // Portal: the sidebar column clips overflow, so an in-place list would
      // be cut off at the area's bounds.
      portal
      anchor={(
        <Tooltip label={t('pinned.options')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('pinned.options')}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconEllipsisOutline16 />
          </button>
        </Tooltip>
      )}
    />
  )
}

/** A chord the recorder captured that the browser or the system also answers, awaiting the user's say. */
interface PendingConflict {
  slot: number
  chord: PinShortcutChord
  owner: PinShortcutOwner
}

/**
 * Inline recorder for the per-position chords: one keycap per position that
 * records the next key pressed on it, a preset and a clear for the whole
 * list, and a status line that names the recording position, a refused key,
 * or a chord the browser or the system also answers.
 */
function PinnedShortcutEditor({ shortcuts, platform, onChange, onReplace, onClose, t }: {
  shortcuts: readonly (PinShortcutChord | null)[]
  platform: PinShortcutPlatform
  onChange: (slot: number, chord: PinShortcutChord | null) => void
  onReplace: (chords: readonly (PinShortcutChord | null)[]) => void
  onClose: () => void
  t: SessionRowContext['t']
}) {
  const [recording, setRecording] = useState<number | null>(null)
  const [pending, setPending] = useState<PendingConflict | null>(null)
  const [refused, setRefused] = useState(false)
  const keycaps = useRef<(HTMLButtonElement | null)[]>([])
  const startRecording = (slot: number): void => {
    setPending(null)
    setRefused(false)
    setRecording(slot)
    keycaps.current[slot]?.focus()
  }
  const onKeyDown = (slot: number, event: KeyboardEvent<HTMLButtonElement>): void => {
    // Idle keycaps keep native button activation, so Enter or Space starts recording through the click.
    if (recording !== slot) return
    // Recording owns the press: nothing below the keycap and no shortcut listener may act on it.
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setRecording(null)
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      onChange(slot, null)
      setRecording(null)
      return
    }
    const spelled = spellPinShortcut(event)
    if (spelled.kind === 'transient') return
    if (spelled.kind === 'refused') {
      setRefused(true)
      return
    }
    setRecording(null)
    const owner = pinShortcutConflict(spelled.chord, platform)
    if (owner === null) onChange(slot, spelled.chord)
    else setPending({ slot, chord: spelled.chord, owner })
  }
  const plain = shortcuts.some(chord => chord !== null && !hasPinShortcutCommandModifier(chord))
  const refusedNow = recording !== null && refused
  return (
    <div className={css.editor} role="group" aria-label={t('pinned.shortcuts.title')}>
      <div className={css.editorHeader}>
        <span className={css.editorTitle}>{t('pinned.shortcuts.label')}</span>
        <button type="button" className={css.textButton} onClick={() => { onReplace(PIN_SHORTCUT_DIGIT_PRESET) }}>
          {t('pinned.shortcuts.preset')}
        </button>
        <button type="button" className={css.textButton} onClick={() => { onReplace([]) }}>
          {t('pinned.shortcuts.clear')}
        </button>
        <button type="button" className={css.iconButton} aria-label={t('pinned.shortcuts.close')} onClick={onClose}>
          <IconCloseOutline16 size={14} />
        </button>
      </div>
      <div className={css.keycaps}>
        {shortcuts.map((chord, slot) => {
          const shown = pending?.slot === slot ? pending.chord : chord
          const label = shown === null ? undefined : formatPinShortcut(shown, platform)
          return (
            <button
              key={slot}
              ref={(element) => { keycaps.current[slot] = element }}
              type="button"
              className={clsx(
                css.keycap, recording === slot && css.keycapRecording, pending?.slot === slot && css.keycapPending,
              )}
              aria-label={t('pinned.shortcuts.slot.aria', { n: slot + 1, key: label ?? t('pinned.shortcuts.unbound') })}
              aria-pressed={recording === slot}
              onClick={() => { startRecording(slot) }}
              onKeyDown={(event) => { onKeyDown(slot, event) }}
              onBlur={() => { if (recording === slot) setRecording(null) }}
            >
              <span className={css.keycapIndex}>{slot + 1}</span>
              <kbd className={clsx(css.keycapKey, label === undefined && css.keycapKeyEmpty)}>{label}</kbd>
            </button>
          )
        })}
      </div>
      <p className={clsx(css.status, refusedNow && css.statusRefused)} aria-live="polite">
        {recording === null
          ? t('pinned.shortcuts.hint')
          : refusedNow ? t('pinned.shortcuts.refused') : t('pinned.shortcuts.recording', { n: recording + 1 })}
      </p>
      {pending !== null && (
        <div className={css.conflict} role="alert">
          <IconWarningOutline16 className={css.conflictIcon} />
          <span className={css.conflictText}>
            {t(`pinned.shortcuts.conflict.${pending.owner}`, { key: formatPinShortcut(pending.chord, platform) })}
          </span>
          <span className={css.conflictActions}>
            <button
              type="button"
              className={css.textButton}
              onClick={() => {
                onChange(pending.slot, pending.chord)
                setPending(null)
              }}
            >
              {t('pinned.shortcuts.conflict.keep')}
            </button>
            <button type="button" className={css.textButton} onClick={() => { startRecording(pending.slot) }}>
              {t('pinned.shortcuts.conflict.retry')}
            </button>
          </span>
        </div>
      )}
      {plain && <p className={css.note}>{t('pinned.shortcuts.plain')}</p>}
    </div>
  )
}

/**
 * Pinned sidebar region rendered above the workspace browser sections: a
 * header that folds the list and carries the options menu, then the rows,
 * each wearing the keycap of the chord that opens it.
 * @param props.rows - visible pinned session rows in recency order.
 * @param props.row - shared row actions and locale seat.
 * @param props.count - fixed number of row slots, or `auto` to fit the rows.
 * @param props.autoStatuses - statuses the area lists without a pin mark.
 * @param props.collapsed - whether only the header shows.
 * @param props.onCollapse - fold or unfold the list.
 * @param props.onCountPick - commit a new row count.
 * @param props.onStatusToggle - flip one auto-pin status.
 * @param props.shortcuts - the chord bound to each position, first row first.
 * @param props.shortcutsEnabled - whether the chords answer keys; off hides the keycaps.
 * @param props.platform - the platform whose shortcut notation and conflicts apply.
 * @param props.onShortcutsEnabled - switch the chords on or off.
 * @param props.onShortcutChange - bind or clear one position.
 * @param props.onShortcutsReplace - replace the whole list (preset or clear).
 * @param props.emptyLabel - localized empty-state hint.
 * @param props.ariaLabel - localized accessible region name.
 * @returns the pinned region.
 */
export function PinnedArea({
  rows, row, count, autoStatuses, collapsed, onCollapse, onCountPick, onStatusToggle,
  shortcuts, shortcutsEnabled, platform, onShortcutsEnabled, onShortcutChange, onShortcutsReplace, emptyLabel, ariaLabel,
}: {
  rows: readonly SessionNode[]
  row: SessionRowContext
  count: SessionPinsSidebarRows
  autoStatuses: readonly SessionAutoPinStatus[]
  collapsed: boolean
  onCollapse: (collapsed: boolean) => void
  onCountPick: (rows: SessionPinsSidebarRows) => void
  onStatusToggle: (status: SessionAutoPinStatus) => void
  shortcuts: readonly (PinShortcutChord | null)[]
  shortcutsEnabled: boolean
  platform: PinShortcutPlatform
  onShortcutsEnabled: (enabled: boolean) => void
  onShortcutChange: (slot: number, chord: PinShortcutChord | null) => void
  onShortcutsReplace: (chords: readonly (PinShortcutChord | null)[]) => void
  emptyLabel: string
  ariaLabel: string
}) {
  const [editingShortcuts, setEditingShortcuts] = useState(false)
  const listStyle = count === 'auto' ? undefined : { '--pinned-rows': count } as CSSProperties
  const keycapOf = (index: number): string | undefined => {
    const chord = shortcutsEnabled ? shortcuts[index] : undefined
    return chord === undefined || chord === null ? undefined : formatPinShortcut(chord, platform)
  }
  return (
    <section className={css.area} aria-label={ariaLabel}>
      <div className={css.header}>
        <button
          type="button"
          className={css.toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? row.t('pinned.expand') : row.t('pinned.collapse')}
          onClick={() => { onCollapse(!collapsed) }}
        >
          {collapsed ? <IconChevronRightOutline14 /> : <IconChevronDownOutline14 />}
          <span className={css.label}>{row.t('section.pinned')}</span>
          {collapsed && rows.length > 0 && <span className={css.count}>{rows.length}</span>}
        </button>
        <PinnedOptionsMenu
          rows={count}
          autoStatuses={autoStatuses}
          shortcutsEnabled={shortcutsEnabled}
          onRowsPick={onCountPick}
          onStatusToggle={onStatusToggle}
          onShortcutsEnabled={onShortcutsEnabled}
          onShortcutsEdit={() => {
            // Editing shows the keycaps, so it switches the chords on as well.
            if (!shortcutsEnabled) onShortcutsEnabled(true)
            onCollapse(false)
            setEditingShortcuts(true)
          }}
          t={row.t}
        />
      </div>
      {editingShortcuts && (
        <PinnedShortcutEditor
          shortcuts={shortcuts}
          platform={platform}
          onChange={onShortcutChange}
          onReplace={onShortcutsReplace}
          onClose={() => { setEditingShortcuts(false) }}
          t={row.t}
        />
      )}
      {!collapsed && (
        <div className={clsx(css.list, count === 'auto' && css.listAuto)} style={listStyle} role="tree">
          {rows.length === 0
            ? <div className={css.empty}>{emptyLabel}</div>
            : rows.map((node, index) => (
              <SessionNodeItem
                key={node.id}
                node={node}
                flat
                shortcut={keycapOf(index)}
                currentId={row.currentId}
                now={row.now}
                t={row.t}
                onOpen={row.onOpen}
                onContextMenu={row.onContextMenu}
                statusIndicatorMode={row.statusIndicatorMode}
                onRename={row.onRename}
                onFork={row.onFork}
                pinned={row.isPinned(node.id)}
                onPin={row.onPin}
                onDirectories={row.onDirectories}
                onArchive={row.onArchive}
                onDelete={row.onDelete}
                multiSelected={row.isSelected(node.id)}
                multiLead={row.isLead(node.id)}
              />
            ))}
        </div>
      )}
    </section>
  )
}
