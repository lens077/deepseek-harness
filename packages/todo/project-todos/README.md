# @deepseek-ai/dsh-project-todos

English | [中文](README.zh.md)

Project-level todo documents behind the `projectTodos` Remote. The Host scans every project under the roots the user configures, plus every registered workspace directory, for documents such as `TODO.md`, parses their list items, and serves the result whole; every scan whose result differs from the previous one publishes `project-todos/changed`. The documents stay the user's files: nothing here writes them, and a browser may read only a document the last scan listed. The reference consumer is the digest panel's project todos tab ([ui-digest](../../client/ui-digest/README.md)).

## Data

A **project** is a directory: each configured root itself, each root's immediate subdirectories (hidden directories, `node_modules`, and `.git` are skipped), and, when `includeWorkspaces` is set, each workspace known to `ctx.workspaceRegistry`. A directory reached both ways lists both sources. A project appears in the snapshot only when at least one file pattern matches under it.

A **document** is a file under a project matching one of the configured `files` globs (relative to the project, at most `maxDepth` directory levels down). Parsing is line-based Markdown: bullet (`-`, `*`, `+`) and numbered list items are items; a `[x]` box marks an item `done`, a `[ ]` box or no box leaves it `open`; the indentation gives its depth, the nearest preceding heading its section, and fenced code is skipped. The snapshot keeps at most `maxItemsPerFile` items per document but counts every item; a document above `maxFileBytes` is listed with no items and a warning.

The snapshot carries the settings the scan used, the number of candidate directories examined, the projects (sorted by name) with their documents (shallowest first) and counts, and warnings for roots, candidates, and documents that could not be read. `get` serves the last snapshot; `rescan` scans now; `readDocument` returns the text of one listed path and answers `not-listed` for anything else.

## Watching

The roots are watched two levels deep, every listed project one level deep, and every listed document directly, so a new or removed project directory, a new top-level document, or an edit triggers a rescan after `watchDebounceMs` of quiet. A document appearing deeper than the first level of a pattern is found by the next explicit rescan. A settings change and any write to the workspace storage domain also rescan.

## Configuration

| Key | Required | Meaning |
| --- | --- | --- |
| `roots` | no | Absolute directories whose immediate subdirectories are projects; default `[]`. |
| `files` | no | Project-relative glob patterns naming todo documents; default `[]`. |
| `includeWorkspaces` | no | Whether registered workspaces are projects too; default `true`. |
| `maxDepth` | yes | Deepest directory level a pattern may reach below a project. |
| `maxFileBytes` | yes | Documents above this size are listed without items. |
| `maxItemsPerFile` | yes | Items kept per document. |
| `watchDebounceMs` | yes | Quiet time after a file event before the rescan. |

`roots`, `files`, and `includeWorkspaces` are also the `project-todos` settings section: the composition entry is its base layer and the user's `settings.yaml` overrides it, so the settings page edits them without a restart. A relative root, a blank pattern, or a pattern escaping the project is refused at load and at write time.

## Composition

```yaml
- id: project-todos
  name: '@deepseek-ai/dsh-project-todos'
  config:
    roots: []
    files: [TODO.md, todo.md, docs/TODO.md]
    includeWorkspaces: true
    maxDepth: 2
    maxFileBytes: 262144
    maxItemsPerFile: 200
    watchDebounceMs: 300
```

Requires nothing at load; `settings` and `workspaceRegistry` are optional peers read when present. The Remote namespace is generated from the `@Remote` methods (`get`, `rescan`, `readDocument`) and mounted by `dsh-api-remotes`, which also forwards `project-todos/changed` to browsers.

## Model Experience

None, as the scan serves browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Read-only** — the panel cannot check off or add an item; the user edits the document in an editor and the watcher picks the change up.
- **Deep documents are not watched** — a document matched below a pattern's first directory level is refreshed on edit (it is watched directly) but discovered only by an explicit rescan or another watched change.
- **Plain bullets count as open items** — a document that mixes notes and tasks as plain bullets lists every bullet; use checkboxes to distinguish them.
