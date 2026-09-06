// Directory grouping for the rail: one header per branch point with the files
// indented beneath it, single-child chains collapsed into one label, and a
// structural order — directories first, then files, each alphabetical.

import { describe, expect, it } from 'vitest'
import type { SessionFileEntry } from '../src/client/session-files.ts'
import { railRows, type RailRow } from '../src/client/rail-rows.ts'

function entry(path: string): SessionFileEntry {
  return { path, additions: 0, deletions: 0, firstSeq: 0, lastSeq: 0, segments: [], writing: false }
}

/** One indented line per row, `label/` for headers, so a whole tree pins in one literal. */
function sketch(rows: readonly RailRow[]): string[] {
  return rows.map(row => '  '.repeat(row.depth) + (row.kind === 'dir' ? `${row.label}/` : row.name))
}

describe('railRows', () => {
  it('returns nothing for no changes', () => {
    expect(railRows([])).toEqual([])
  })

  it('keeps separator-free names as loose top-level rows, sorted', () => {
    const rows = railRows([entry('b.ts'), entry('a.ts')])
    expect(sketch(rows)).toEqual(['a.ts', 'b.ts'])
    expect(rows.every(row => row.kind === 'file' && row.depth === 0)).toBe(true)
  })

  it('groups files under a header per branch point, directories before files', () => {
    // Sibling directories arrive both in and out of alphabetical order, so the
    // sort demonstrably reorders rather than echoing insertion order.
    const rows = railRows([
      entry('src/client/app.ts'),
      entry('src/tests/app.spec.ts'),
      entry('src/style.css'),
      entry('src/api/index.ts'),
      entry('README.md'),
    ])
    expect(sketch(rows)).toEqual([
      'src/',
      '  api/',
      '    index.ts',
      '  client/',
      '    app.ts',
      '  tests/',
      '    app.spec.ts',
      '  style.css',
      'README.md',
    ])
  })

  it('collapses a single-child directory chain into one header', () => {
    const rows = railRows([entry('packages/client/ui/src/b.ts'), entry('packages/client/ui/src/a.ts')])
    expect(sketch(rows)).toEqual(['packages/client/ui/src/', '  a.ts', '  b.ts'])
    expect(rows[0]).toMatchObject({ kind: 'dir', path: 'packages/client/ui/src', depth: 0 })
  })

  it('folds a leading slash into the first segment and titles headers with full paths', () => {
    const rows = railRows([entry('/repo/pkg/a.ts'), entry('/repo/README.md')])
    expect(sketch(rows)).toEqual(['/repo/', '  pkg/', '    a.ts', '  README.md'])
    expect(rows[1]).toMatchObject({ kind: 'dir', path: '/repo/pkg', label: 'pkg', depth: 1 })
  })

  it('groups backslash paths with slash paths and normalizes header paths', () => {
    const rows = railRows([entry('C:\\repo\\src\\a.ts'), entry('C:/repo/src/b.ts')])
    expect(sketch(rows)).toEqual(['C:/repo/src/', '  a.ts', '  b.ts'])
    expect(rows[0]).toMatchObject({ kind: 'dir', path: 'C:/repo/src' })
  })

  it('keeps a file row per entry when normalized names collide', () => {
    const rows = railRows([entry('a/x.ts'), entry('a\\x.ts')])
    expect(sketch(rows)).toEqual(['a/', '  x.ts', '  x.ts'])
  })

  it('survives degenerate paths without a directory to name', () => {
    expect(sketch(railRows([entry(''), entry('/')]))).toEqual(['', '/'])
  })
})
