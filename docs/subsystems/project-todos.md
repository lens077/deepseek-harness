# Project Todos

English | [中文](project-todos.zh.md)

[`@deepseek-ai/dsh-project-todos`](../../packages/todo/project-todos) scans the user's project directories — each configured root, its immediate subdirectories, and every registered workspace — for todo documents such as `TODO.md`, parses their list items, and serves the result behind the `projectTodos` Remote. The documents are the authority: the Host never writes them, recomputes the snapshot on every change it watches, and lets a browser read only a document the last scan listed. The web digest panel ([ui-digest](../../packages/client/ui-digest/README.md)) lists the result and edits the scan settings.

Source: [`packages/todo/project-todos/src/types.ts`](../../packages/todo/project-todos/src/types.ts)

## Public types

```ts type-equiv
/** Lifecycle of one todo line as written in the document. */
type ProjectTodoStatus = 'open' | 'done'
```

```ts type-equiv
/** One list item read from a todo document. */
interface ProjectTodoItem {
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
```

```ts type-equiv
/** One todo document found under a project directory. */
interface ProjectTodoFile {
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
```

```ts type-equiv
/** How a directory became a project candidate. */
type ProjectTodoSource = 'root' | 'workspace'
```

```ts type-equiv
/** One project directory that holds at least one todo document. */
interface ProjectTodoProject {
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
```

```ts type-equiv
/** A root or project the scan could not read; the scan continues past it. */
interface ProjectTodoWarning {
  readonly path: string
  readonly message: string
}
```

```ts type-equiv
/** The user-editable part of the scanner configuration, mirrored from the settings section. */
interface ProjectTodosSettings {
  /** Directories whose immediate subdirectories are projects; each root itself is also a candidate. */
  readonly roots: string[]
  /** Glob patterns, relative to a project directory, naming todo documents. */
  readonly files: string[]
  /** Whether every registered workspace directory is also a project candidate. */
  readonly includeWorkspaces: boolean
}
```

```ts type-equiv
/** The complete scan result, served whole after every read and rescan. */
interface ProjectTodosSnapshot {
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
```

```ts type-equiv
/** Read one todo document that the current snapshot lists. */
interface ProjectTodoReadRequest {
  /** Absolute document path exactly as the snapshot lists it. */
  readonly path: string
}
```

```ts type-equiv
/** The document text of one listed todo file. */
interface ProjectTodoDocument {
  readonly path: string
  /** Complete UTF-8 text. */
  readonly text: string
  /** Modification time at read, Unix epoch milliseconds. */
  readonly mtime: number
}
```

```ts type-equiv
/** The path is not a document the current snapshot lists. */
interface ProjectTodoNotListed {
  readonly code: 'not-listed'
  readonly path: string
}
```

```ts type-equiv
/** The document is listed but could not be read now. */
interface ProjectTodoReadFailed {
  readonly code: 'read-failed'
  readonly path: string
  readonly message: string
}
```

```ts type-equiv
/** Every explicit read failure. */
type ProjectTodoReadFailure = ProjectTodoNotListed | ProjectTodoReadFailed
```

```ts type-equiv
/** Successful business result. */
interface ProjectTodoSuccess<T> {
  readonly ok: true
  readonly value: T
}
```

```ts type-equiv
/** Explicit business failure. */
interface ProjectTodoRejected<E extends ProjectTodoReadFailure> {
  readonly ok: false
  readonly error: E
}
```

```ts type-equiv
/** Result of reading one document. */
type ProjectTodoReadResult =
  | ProjectTodoSuccess<ProjectTodoDocument>
  | ProjectTodoRejected<ProjectTodoReadFailure>
```

## Scan and watch

One scan runs at a time; a request landing during a scan queues exactly one follow-up. Candidates are the roots, their visible subdirectories (hidden directories, `node_modules`, and `.git` skipped), and the workspace registry's directories when `includeWorkspaces` is set. The configured `files` globs are matched under each candidate at most `maxDepth` levels down; a matched document is parsed line by line, kept to `maxItemsPerFile` items, and listed without items above `maxFileBytes`. Roots are watched two levels deep, listed projects one level deep, and listed documents directly; a settings change and a write to the workspace storage domain also rescan.

## Publication

`get` serves the last snapshot and `rescan` scans now; a scan whose result differs from the previous one emits `project-todos/changed` with the complete snapshot, forwarded verbatim to browsers through the `dsh-api-remotes` allowlist. `readDocument` answers `not-listed` for any path outside the snapshot.

## Known limitations

- Documents are read-only through this service; an item is checked off in an editor.
- A document below a pattern's first directory level is refreshed on edit but discovered only by an explicit rescan.
- Plain bullets count as open items.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxprojecttodos--projecttodosservice"></a>

### `ctx.projectTodos` — `ProjectTodosService`

Scanner service. Scans are serialized; a request landing during a scan queues exactly one more, so a burst of file events yields one rescan.

```ts cordis-catalog
/**
 * Read the last scan result.
 * @returns the complete snapshot; empty before the first scan finishes.
 */
@Remote('get') get(): ProjectTodosSnapshot

/**
 * Scan again now, ahead of any pending file-event rescan.
 * @returns the fresh snapshot.
 */
@Remote('rescan') rescan(): Promise<ProjectTodosSnapshot>

/**
 * Read the text of one document the current snapshot lists. Any other
 * path is refused: the snapshot is the whole set of files a browser may
 * read through this service.
 * @param request - the listed document path.
 * @returns the document, or an explicit refusal or read failure.
 */
@Remote('readDocument') async readDocument(request: ProjectTodoReadRequest): Promise<ProjectTodoReadResult>
```

Source: [`packages/todo/project-todos/src/index.ts`](../../packages/todo/project-todos/src/index.ts)

<a id="project-todos-events"></a>

### `project-todos/*` events

<a id="project-todoschanged--emit"></a>

#### `project-todos/changed` — emit

A scan finished with a result that differs from the previous one: a document changed, appeared, or disappeared, or the settings moved. The payload is the complete snapshot, the same value `get` serves.

```ts cordis-catalog
/**
 * A scan finished with a result that differs from the previous one:
 * a document changed, appeared, or disappeared, or the settings moved.
 * The payload is the complete snapshot, the same value `get` serves.
 * @mode emit
 * @param snapshot - the complete scan result.
 */
'project-todos/changed'(snapshot: ProjectTodosSnapshot): void
```

Source: [`packages/todo/project-todos/src/types.ts`](../../packages/todo/project-todos/src/types.ts)
<!-- END GENERATED cordis-surface -->
