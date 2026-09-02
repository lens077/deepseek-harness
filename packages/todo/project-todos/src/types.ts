/**
 * Public value, request, failure, and event vocabulary of the project todo
 * scanner. This module contains types only so generated Remote clients and
 * browser plugins consume it without importing Host runtime code.
 * @module @deepseek-ai/dsh-project-todos/types
 */

/** Lifecycle of one todo line as written in the document. */
export type ProjectTodoStatus = 'open' | 'done'

/** One list item read from a todo document. */
export interface ProjectTodoItem {
  /** 1-based line number inside the document. */
  readonly line: number
  /** Item text with the list marker and checkbox removed, trimmed. */
  readonly text: string
  /** `done` for a checked `[x]` box; every other item is `open`. */
  readonly status: ProjectTodoStatus
  /** Whether the line carried a Markdown checkbox; a plain bullet is a todo without one. */
  readonly checkbox: boolean
  /** Nesting depth, 0 for a top-level item. */
  readonly depth: number
  /** Text of the nearest preceding heading, or `null` before the first heading. */
  readonly section: string | null
}

/** One todo document found under a project directory. */
export interface ProjectTodoFile {
  /** Absolute path of the document. */
  readonly path: string
  /** Path relative to the project directory, with `/` separators. */
  readonly relativePath: string
  /** Modification time in Unix epoch milliseconds. */
  readonly mtime: number
  /** Document size in bytes. */
  readonly size: number
  /** Parsed items in document order, bounded by the configured per-file budget. */
  readonly items: readonly ProjectTodoItem[]
  /** Count of `open` items among every parsed item. */
  readonly open: number
  /** Count of `done` items among every parsed item. */
  readonly done: number
  /** Whether the item budget cut the list short. */
  readonly truncated: boolean
}

/** How a directory became a project candidate. */
export type ProjectTodoSource = 'root' | 'workspace'

/** One project directory that holds at least one todo document. */
export interface ProjectTodoProject {
  /** Absolute project directory path. */
  readonly path: string
  /** Directory basename, the display name. */
  readonly name: string
  /** Every way the directory was reached; a registered workspace under a scanned root lists both. */
  readonly sources: readonly ProjectTodoSource[]
  /** Todo documents under the project, shallowest first, then by relative path. */
  readonly files: readonly ProjectTodoFile[]
  /** Sum of every file's open count. */
  readonly open: number
  /** Sum of every file's done count. */
  readonly done: number
}

/** A root or project the scan could not read; the scan continues past it. */
export interface ProjectTodoWarning {
  readonly path: string
  readonly message: string
}

/** The user-editable part of the scanner configuration, mirrored from the settings section. */
export interface ProjectTodosSettings {
  /** Directories whose immediate subdirectories are projects; each root itself is also a candidate. */
  readonly roots: string[]
  /** Glob patterns, relative to a project directory, naming todo documents. */
  readonly files: string[]
  /** Whether every registered workspace directory is also a project candidate. */
  readonly includeWorkspaces: boolean
}

/** The complete scan result, served whole after every read and rescan. */
export interface ProjectTodosSnapshot {
  /** When the scan finished, Unix epoch milliseconds; `null` before the first scan. */
  readonly scannedAt: number | null
  /** The settings the scan used. */
  readonly settings: ProjectTodosSettings
  /** How many candidate directories were examined. */
  readonly candidates: number
  /** Projects holding at least one todo document, ordered by name then path. */
  readonly projects: readonly ProjectTodoProject[]
  /** Roots and candidates the scan could not read. */
  readonly warnings: readonly ProjectTodoWarning[]
}

/** Read one todo document that the current snapshot lists. */
export interface ProjectTodoReadRequest {
  /** Absolute document path exactly as the snapshot lists it. */
  readonly path: string
}

/** The document text of one listed todo file. */
export interface ProjectTodoDocument {
  readonly path: string
  /** Complete UTF-8 text. */
  readonly text: string
  /** Modification time at read, Unix epoch milliseconds. */
  readonly mtime: number
}

/** The path is not a document the current snapshot lists. */
export interface ProjectTodoNotListed {
  readonly code: 'not-listed'
  readonly path: string
}

/** The document is listed but could not be read now. */
export interface ProjectTodoReadFailed {
  readonly code: 'read-failed'
  readonly path: string
  readonly message: string
}

/** Every explicit read failure. */
export type ProjectTodoReadFailure = ProjectTodoNotListed | ProjectTodoReadFailed

/** Successful business result. */
export interface ProjectTodoSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Explicit business failure. */
export interface ProjectTodoRejected<E extends ProjectTodoReadFailure> {
  readonly ok: false
  readonly error: E
}

/** Result of reading one document. */
export type ProjectTodoReadResult =
  | ProjectTodoSuccess<ProjectTodoDocument>
  | ProjectTodoRejected<ProjectTodoReadFailure>

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A scan finished with a result that differs from the previous one:
     * a document changed, appeared, or disappeared, or the settings moved.
     * The payload is the complete snapshot, the same value `get` serves.
     * @mode emit
     * @param snapshot - the complete scan result.
     */
    'project-todos/changed'(snapshot: ProjectTodosSnapshot): void
  }
}
