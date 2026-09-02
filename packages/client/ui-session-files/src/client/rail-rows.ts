/**
 * Directory grouping for the rail's changed-file list: fold flat file paths
 * into `tree`-style rows — one header per directory, files indented beneath —
 * so a row's name says where the file lives without every row repeating the
 * whole path.
 *
 * Single-child directory chains collapse into one header (`src/client` rather
 * than `src` above a lone `client`): the rail is narrow, and a ladder of
 * one-child headers spends that width on indentation that distinguishes
 * nothing. Order is structural, not chronological — directories first, then
 * files, each alphabetical — because grouping already breaks the flat list's
 * chronology; the newest change is still found by the default selection and
 * the writing spinner, not by list position.
 * @module
 */

import type { SessionFileEntry } from './session-files.ts'

/** Horizontal px one nesting level adds to a rail row. */
export const TREE_INDENT_PX = 14

/** One directory header row; orientation only, never selectable. */
export interface RailDirRow {
  readonly kind: 'dir'
  /** Slash-joined directory path (backslashes normalized), for the hover title. */
  readonly path: string
  /** Segments this header adds below its parent; collapsed chains joined with `/`. */
  readonly label: string
  /** Nesting depth; 0 at the top level. */
  readonly depth: number
}

/** One changed file row, drawn under its directory header. */
export interface RailFileRow {
  readonly kind: 'file'
  readonly entry: SessionFileEntry
  /** Final path segment, the name the row draws. */
  readonly name: string
  /** Nesting depth; its directory header's depth + 1, or 0 for a loose file. */
  readonly depth: number
}

/** One rail list row. */
export type RailRow = RailDirRow | RailFileRow

/** Mutable directory node while the paths are folded. */
interface DirNode {
  label: string
  path: string
  dirs: Map<string, DirNode>
  files: Array<{ name: string; entry: SessionFileEntry }>
}

/**
 * Fold changed entries into render-ready rows.
 * @param changed - the merged model's changed files, in any order.
 * @returns rows in render order; empty when nothing changed.
 */
export function railRows(changed: readonly SessionFileEntry[]): readonly RailRow[] {
  const root: DirNode = { label: '', path: '', dirs: new Map(), files: [] }
  for (const entry of changed) {
    // Both separator styles, runs collapsed. A leading POSIX `/` folds into
    // the first segment so `/repo/a.ts` and `/repo/b.ts` group under `/repo`.
    const raw = entry.path.split(/[\\/]+/u)
    const absolute = raw[0] === ''
    const segments = raw
      .slice(absolute ? 1 : 0)
      .map((segment, index) => (absolute && index === 0 ? `/${segment}` : segment))
    const name = segments.pop() ?? entry.path
    let node = root
    for (const segment of segments) {
      const held = node.dirs.get(segment)
      if (held === undefined) {
        const child: DirNode = {
          label: segment,
          path: node.path === '' ? segment : `${node.path}/${segment}`,
          dirs: new Map(),
          files: [],
        }
        node.dirs.set(segment, child)
        node = child
      } else {
        node = held
      }
    }
    node.files.push({ name, entry })
  }
  const rows: RailRow[] = []
  emit(root, 0, rows)
  return rows
}

/** Append one container's rows: subdirectory groups first, then its own files. */
function emit(node: DirNode, depth: number, rows: RailRow[]): void {
  for (let dir of [...node.dirs.values()].sort(byLabel)) {
    // A header that adds no branch and holds no file collapses into its only
    // child; `size === 1` makes the inner loop body run exactly once per step.
    while (dir.files.length === 0 && dir.dirs.size === 1) {
      for (const only of dir.dirs.values()) {
        dir = { ...only, label: `${dir.label}/${only.label}` }
      }
    }
    rows.push({ kind: 'dir', path: dir.path, label: dir.label, depth })
    emit(dir, depth + 1, rows)
  }
  for (const file of [...node.files].sort(byName)) {
    rows.push({ kind: 'file', entry: file.entry, name: file.name, depth })
  }
}

/** Ascending by label; labels at one level are unique (Map keys). */
function byLabel(left: DirNode, right: DirNode): number {
  return left.label < right.label ? -1 : 1
}

/** Ascending by name; equal names (mixed separators) keep an arbitrary order. */
function byName(left: { name: string }, right: { name: string }): number {
  return left.name < right.name ? -1 : 1
}
