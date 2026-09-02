# 项目待办

[English](project-todos.md) | 中文

[`@deepseek-ai/dsh-project-todos`](../../packages/todo/project-todos) 扫描用户的项目目录——每个配置的根目录、其直接子目录以及每个已注册的工作区——寻找 `TODO.md` 这类待办文档，解析其中的列表项，并在 `projectTodos` Remote 背后提供结果。文档是权威：Host 从不写入它们，对每一次被监视到的变更重算快照，并且只允许浏览器读取上次扫描列出的文档。Web 汇总面板（[ui-digest](../../packages/client/ui-digest/README.zh.md)）列出结果并编辑扫描设置。

来源：[`packages/todo/project-todos/src/types.ts`](../../packages/todo/project-todos/src/types.ts)

## 公开类型

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

## 扫描与监视

同一时刻只运行一次扫描；扫描期间到达的请求恰好排队一次后续扫描。候选目录是根目录、它们的可见子目录（跳过隐藏目录、`node_modules` 与 `.git`），以及设置了 `includeWorkspaces` 时工作区注册表中的目录。配置的 `files` glob 在每个候选目录下最多向下匹配 `maxDepth` 层；匹配到的文档逐行解析，最多保留 `maxItemsPerFile` 个条目，超过 `maxFileBytes` 的只列出而不带条目。根目录向下监视两层，已列出的项目向下监视一层，已列出的文档直接监视；设置变更与工作区存储域的写入也会重新扫描。

## 发布

`get` 提供上一次快照，`rescan` 立即扫描；结果与上一次不同的扫描会携带完整快照发出 `project-todos/changed`，并经 `dsh-api-remotes` 允许列表原样转发给浏览器。`readDocument` 对快照之外的任何路径回答 `not-listed`。

## 已知限制

- 通过本服务文档只读；勾选条目要在编辑器中完成。
- 位于规则第一层目录以下的文档在编辑时会刷新，但只有显式重新扫描才能发现它。
- 普通项目符号算作未完成条目。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
