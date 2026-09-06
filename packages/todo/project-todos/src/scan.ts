/**
 * Todo-document discovery and parsing: which directories are projects, which
 * files inside them are todo documents, and which lines of those documents
 * are items. Every function here is free of service state so the scan is
 * testable against a temporary tree and the parser against a string.
 * @module @deepseek-ai/dsh-project-todos/scan
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { glob } from 'tinyglobby'
import type {
  ProjectTodoFile,
  ProjectTodoItem,
  ProjectTodoProject,
  ProjectTodoSource,
  ProjectTodoWarning,
  ProjectTodosSettings,
  ProjectTodosSnapshot,
} from './types.ts'

/** Scan bounds fixed by the deployment rather than the user. */
export interface ScanLimits {
  /** Deepest directory level a file pattern may reach below a project. */
  readonly maxDepth: number
  /** Documents above this byte size are listed with no items and a warning. */
  readonly maxFileBytes: number
  /** Items kept per document; later lines are counted but not listed. */
  readonly maxItemsPerFile: number
}

/** One scan's inputs beyond the settings. */
export interface ScanInput {
  readonly settings: ProjectTodosSettings
  readonly limits: ScanLimits
  /** Registered workspace directories, consulted only when `includeWorkspaces` is set. */
  readonly workspacePaths: readonly string[]
}

/** Directory names never treated as projects or searched for documents. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(['node_modules', '.git'])

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/u
const FENCE = /^\s{0,3}(`{3,}|~{3,})/u
const LIST_ITEM = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(?:\[([ xX])\]\s+)?(.*?)\s*$/u
/** Indentation counted as one nesting level. */
const INDENT_WIDTH = 2

/** The parsed body of one document. */
export interface ParsedDocument {
  readonly items: readonly ProjectTodoItem[]
  readonly open: number
  readonly done: number
  readonly truncated: boolean
}

/**
 * Parse Markdown-style todo lines. Bullet and numbered list items are items;
 * a `[x]` box marks one done and a `[ ]` box or no box leaves it open.
 * Headings name the section of the items after them; fenced code is skipped.
 * @param text - the complete document text.
 * @param maxItems - how many items to keep; counts still cover every item.
 * @returns the items and their counts.
 */
export function parseTodoDocument(text: string, maxItems: number): ParsedDocument {
  const items: ProjectTodoItem[] = []
  let open = 0
  let done = 0
  let section: string | null = null
  let fence: string | null = null
  const lines = text.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as string
    const fenceMatch = FENCE.exec(line)
    if (fenceMatch !== null) {
      const marker = fenceMatch[1] as string
      if (fence === null) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (fence !== null) continue
    const heading = HEADING.exec(line)
    if (heading !== null) {
      section = (heading[2] as string).trim()
      continue
    }
    const item = LIST_ITEM.exec(line)
    if (item === null) continue
    const body = item[3] as string
    if (body.length === 0) continue
    const box = item[2]
    const status = box !== undefined && box !== ' ' ? 'done' : 'open'
    if (status === 'done') done++
    else open++
    if (items.length >= maxItems) continue
    items.push(Object.freeze({
      line: index + 1,
      text: body,
      status,
      checkbox: box !== undefined,
      depth: Math.floor((item[1] as string).replace(/\t/gu, '  ').length / INDENT_WIDTH),
      section,
    }))
  }
  return { items, open, done, truncated: open + done > items.length }
}

/** Directory levels below the project a relative document path sits at. */
function depthOf(relativePath: string): number {
  return relativePath.split('/').length
}

/**
 * Describe one caught value for a warning or failure.
 * @param error - the caught value.
 * @returns its message, or its string form for a non-Error throw.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether a settings value is usable as a scan input; the settings layer
 * rejects these at write time, so a failure here means an external edit.
 * @param settings - the resolved section.
 * @returns the reasons the section is unusable, empty when it is fine.
 */
export function settingsProblems(settings: ProjectTodosSettings): string[] {
  const problems: string[] = []
  for (const root of settings.roots) {
    if (!isAbsolute(root)) problems.push(`root must be an absolute path: ${JSON.stringify(root)}`)
  }
  for (const pattern of settings.files) {
    if (pattern.trim().length === 0) problems.push('file pattern must not be blank')
    else if (isAbsolute(pattern) || pattern.split(/[\\/]/u).includes('..')) {
      problems.push(`file pattern must stay inside the project: ${JSON.stringify(pattern)}`)
    }
  }
  return problems
}

/**
 * Collect candidate project directories: each root itself, each root's
 * immediate subdirectories, and, when enabled, every registered workspace.
 * @param input - the scan inputs.
 * @param warnings - receives one entry per unreadable root.
 * @returns candidate paths mapped to the ways they were reached.
 */
async function collectCandidates(input: ScanInput, warnings: ProjectTodoWarning[]): Promise<Map<string, Set<ProjectTodoSource>>> {
  const candidates = new Map<string, Set<ProjectTodoSource>>()
  const add = (path: string, source: ProjectTodoSource): void => {
    const key = resolve(path)
    const sources = candidates.get(key) ?? new Set<ProjectTodoSource>()
    sources.add(source)
    candidates.set(key, sources)
  }
  for (const root of input.settings.roots) {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch (error) {
      warnings.push({ path: root, message: messageOf(error) })
      continue
    }
    add(root, 'root')
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) continue
      add(join(root, entry.name), 'root')
    }
  }
  if (input.settings.includeWorkspaces) {
    for (const path of input.workspacePaths) add(path, 'workspace')
  }
  return candidates
}

/**
 * Read and parse one matched document.
 * @param project - the project directory.
 * @param path - absolute document path.
 * @param limits - size and item budgets.
 * @param warnings - receives an entry when the document is oversized or unreadable.
 * @returns the file record, or `null` when it could not be read.
 */
async function readDocument(
  project: string,
  path: string,
  limits: ScanLimits,
  warnings: ProjectTodoWarning[],
): Promise<ProjectTodoFile | null> {
  const relativePath = relative(project, path).split('\\').join('/')
  try {
    const info = await stat(path)
    const base = { path, relativePath, mtime: Math.round(info.mtimeMs), size: info.size }
    if (info.size > limits.maxFileBytes) {
      warnings.push({ path, message: `document exceeds ${limits.maxFileBytes} bytes and was not parsed` })
      return Object.freeze({ ...base, items: [], open: 0, done: 0, truncated: true })
    }
    const parsed = parseTodoDocument(await readFile(path, 'utf8'), limits.maxItemsPerFile)
    return Object.freeze({ ...base, ...parsed })
  } catch (error) {
    warnings.push({ path, message: messageOf(error) })
    return null
  }
}

/**
 * Scan every candidate for todo documents.
 * @param input - settings, limits, and the workspace directories.
 * @returns the complete snapshot with `scannedAt` set to now.
 */
export async function scanProjects(input: ScanInput): Promise<ProjectTodosSnapshot> {
  const warnings: ProjectTodoWarning[] = []
  for (const problem of settingsProblems(input.settings)) warnings.push({ path: '', message: problem })
  const patterns = input.settings.files.filter(pattern => pattern.trim().length > 0 && !isAbsolute(pattern))
  const candidates = await collectCandidates(input, warnings)
  const projects: ProjectTodoProject[] = []
  for (const [path, sources] of candidates) {
    // tinyglobby suppresses directory read errors itself: an unreadable or
    // non-directory candidate simply matches nothing.
    const matches = patterns.length === 0
      ? []
      : await glob(patterns, {
        cwd: path,
        absolute: true,
        onlyFiles: true,
        deep: input.limits.maxDepth,
        ignore: [...SKIPPED_DIRECTORIES].map(name => `**/${name}/**`),
        expandDirectories: false,
      })
    if (matches.length === 0) continue
    const files: ProjectTodoFile[] = []
    for (const match of [...new Set(matches)].sort()) {
      const file = await readDocument(path, match, input.limits, warnings)
      if (file !== null) files.push(file)
    }
    if (files.length === 0) continue
    files.sort((a, b) => depthOf(a.relativePath) - depthOf(b.relativePath) || a.relativePath.localeCompare(b.relativePath))
    projects.push(Object.freeze({
      path,
      name: basename(path) || path,
      sources: Object.freeze([...sources].sort()),
      files: Object.freeze(files),
      open: files.reduce((sum, file) => sum + file.open, 0),
      done: files.reduce((sum, file) => sum + file.done, 0),
    }))
  }
  projects.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
  return Object.freeze({
    scannedAt: Date.now(),
    settings: Object.freeze({
      roots: [...input.settings.roots],
      files: [...input.settings.files],
      includeWorkspaces: input.settings.includeWorkspaces,
    }),
    candidates: candidates.size,
    projects: Object.freeze(projects),
    warnings: Object.freeze(warnings),
  })
}

/**
 * Whether two snapshots describe the same documents and items, ignoring the
 * scan time; a rescan that finds nothing new publishes nothing.
 * @param left - previous snapshot.
 * @param right - next snapshot.
 * @returns true when every listed fact matches.
 */
export function sameScan(left: ProjectTodosSnapshot, right: ProjectTodosSnapshot): boolean {
  const strip = (snapshot: ProjectTodosSnapshot): string => JSON.stringify({ ...snapshot, scannedAt: null })
  return strip(left) === strip(right)
}
