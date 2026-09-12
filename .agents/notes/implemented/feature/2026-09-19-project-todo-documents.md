# Agent Note: Project todo documents in the digest panel

Status: implemented

English | [中文](2026-09-19-project-todo-documents.zh.md)

## Problem

The two todo surfaces the GUI had were both session-level: the model's `todo_write` list, cleared at the next turn, and the user's inbox todos, each addressed to one session. A user who keeps a `TODO.md` in every project directory — the ordinary way to plan work that outlives any conversation — had no view of those files across projects, no way to see which project still has open items, and no path from an item to a session in that project. The question "which of my projects has work waiting" was answered by opening each directory by hand.

## Decision

### The Host scans the user's files and serves them whole

`@deepseek-ai/dsh-project-todos` is a Host plugin behind the `projectTodos` Remote. It treats each configured root, each root's immediate subdirectories, and (when enabled) each registered workspace directory as a project, matches the configured project-relative glob patterns under it, and parses the matched documents line by line: bullet and numbered list items are items, a `[x]` box marks one done, indentation gives depth, the nearest heading gives the section, fenced code is skipped. The result — projects with documents with items, counts, the settings used, and warnings for what could not be read — is one snapshot served by `get`, refreshed by `rescan`, and published as `project-todos/changed` whenever a scan differs from the previous one. `readDocument` returns a listed document's text and refuses any other path, so the snapshot is the whole set of files a browser can read through this service.

The documents stay the user's: nothing writes them. Watching is bounded rather than recursive — roots two levels deep, listed projects one level deep, listed documents directly — so a big root with many projects costs a few dozen directory watches, not a crawl; a document appearing deeper than a pattern's first level is found by the next explicit rescan. Watchers persist across scans and only the changed paths are added or released, because a watcher restarted after every scan would miss the event that lands during its startup.

### The scan settings are the settings section

`roots`, `files`, and `includeWorkspaces` are the plugin's composition entry and, through `installSettingsSection`, the `project-todos` settings section the user edits in the GUI without a restart; the fixed bounds (`maxDepth`, `maxFileBytes`, `maxItemsPerFile`, `watchDebounceMs`) stay in the composition. A relative root or a pattern that escapes the project is refused at load and at write time, so the scan never runs on a section it cannot use. A workspace registry write (`domain/changed` on the `workspace` domain) also rescans, which is how a workspace registered from the sidebar joins the scan.

### One more tab on the inbox, one settings page

The digest panel grows a **项目待办** tab: a section per project with its sources and counts, a block per document with its items, and read-only actions — a session in that project (the directory is registered as a workspace when needed and the composer is prefilled with a line naming the document), the document text inline, the file or directory in the Host's own application, and a rescan. The scan is read the first time the tab shows, never for a user who keeps to the inbox. The same plugin registers the **项目待办** settings page over the `project-todos` scope: a roots list with a native directory chooser, patterns as lines, and the workspace toggle. Both live in ui-digest because the panel already joins cross-workspace state and the settings page is that tab's configuration.

## Alternatives considered

**Scan on the client through a file-listing RPC.** Rejected: the Host owns file access and the trust fence; a browser walking directories through `host.listDirectory` would issue one request per directory and could not watch anything.

**Let the panel check items off by rewriting the document.** Rejected for now: rewriting a Markdown file the user also edits by hand risks clobbering unsaved editor state, and a checkbox toggle is the one edit that is as fast in the editor. The Remote is read-only; the limitation is recorded in the README.

**Store the scan in a storage domain.** Rejected: the files are the authority and the scan is cheap to recompute; a stored copy would be a second authority that goes stale.

**Watch every project recursively.** Rejected: a root such as a monorepo checkout would put thousands of directories under watch; the bounded scheme covers the common layouts (top-level `TODO.md`, `docs/TODO.md`) and the explicit rescan covers the rest.

**A separate client package for the tab and settings page.** Rejected: the tab lives inside the digest panel's tab strip, which is not a slot, and the settings page is the tab's own configuration; a separate package would need a new slot in ui-digest for one registrant.

## Consequences

Every project directory with a todo document is visible from one place, with its open count, and one click away from a session in that directory. The scan reflects file edits within the debounce window for watched paths.

Reading documents outside the last scan is impossible by construction. Plain bullets count as open items, so a document mixing notes and tasks lists every bullet unless it uses checkboxes. The `remote.projectTodos` namespace is required by ui-digest, so a web composition must mount the Host plugin.

## Verification

The Host suite pins the parser (checkbox, plain, numbered, nested, headings, CRLF, fences, budgets), settings validation, candidate collection (roots, subdirectories, skipped directories, workspaces, non-directory paths), warnings for unreadable roots and documents, oversized documents, on-demand rescans that publish only on change, concurrent rescan collapsing, watcher-driven rescans for an edit and a new top-level document, workspace-domain and settings-driven rescans, listed-only document reads, and disposal. Client suites pin the controller's read/push/rescan/read-document/disposal paths, the settings policy and page, the projects tab's rendering, folding, filter, actions, and failure notices, and the plugin's namespace binding, project opening, path opening, and settings page registration. The assembled web application was exercised against a scratch `DSH_HOME` on port 3081: the Remote served the scan configured in `settings.yaml`, the tab listed the projects, a root added from the settings page reached the scan and the document, and an edit to a listed document refreshed the snapshot through the watcher.

## Related

- [Durable session inbox](2026-09-17-durable-session-inbox.md) owns the digest panel this tab joins and the `sessionInbox` Remote pattern this plugin mirrors.
- [Adding a settings card](../../../../docs/cookbook/adding-a-settings-card.md) is the settings-section pattern the scan settings follow.
