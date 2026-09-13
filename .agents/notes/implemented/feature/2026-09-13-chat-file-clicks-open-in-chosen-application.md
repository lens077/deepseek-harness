# Agent Note: Chat file clicks open in the chosen desktop application

Status: implemented

English | [中文](2026-09-13-chat-file-clicks-open-in-chosen-application.zh.md)

## Problem

Every file click in the conversation — a produced-file chip, an inline-code mention, a tool row's path — opened the right Sidebar's text preview, the only route since [the right Sidebar](2026-09-04-right-sidebar-docking-infrastructure.md) replaced the Host desktop opener of [workspace file links](2026-07-31-web-workspace-file-links.md). Users working beside an editor wanted the file in that editor, and users with no editor wanted the file selected in Finder or File Explorer, while the Sidebar preview stayed available for those who prefer it. The Session header already carried the [open-in-app](2026-08-25-promote-open-anywhere-plugin.md) split button with the remembered application, but it opened only the workspace directory.

## Decision

The header's remembered entry decides where file clicks go. `ui-chat` declares an optional `chatFileOpener` service (`active()`, `open(absolutePath)`) and consults it on every click; `ui-open-in-app` provides it from its page-lifetime controller. With no choice made, the first application the host offers takes the click — the catalog lists the platform file manager first, so Finder on macOS and File Explorer on Windows are the default; both ship with the operating system and always resolve. The menu gains a **Sidebar preview** entry (`sidebar`, not a catalog id) that keeps clicks in the Sidebar and turns the header button into the Sidebar file-tree opener. The [ui-open-in-app README](../../../../packages/client/ui-open-in-app/README.md) owns the user-facing behavior.

A remembered application the host no longer offers is a warning, not a fallback. The controller's `fileTarget()` names it `not-installed`; the service words it from the dictionaries and rejects, and Chat's existing open-failure dialog shows the sentence. The header button still falls back to the first available application for the workspace directory, as before; only the file click refuses, because a click that silently landed in Finder would hide the uninstall from the user who chose the editor.

The host open route accepts a file as well as a directory. A `shell-open` launcher (the file managers) reveals a file selected in its folder through the new `revealNativePath` in `dsh-native-command` (`open -R`; Explorer `/select,` through `Start-Process`, because `explorer.exe` exits non-zero even when it raised the window; the parent directory through `xdg-open` on desktop Linux, which has no portable select verb). An `argv` launcher receives the file verbatim, except that a catalog entry marked `directoryOnly` — terminals and Git GUIs — receives the file's parent directory, so a terminal opens beside the file rather than executing it.

## Alternatives considered

**A separate setting for file clicks.** Two controls naming applications would drift; the header menu is already the one place the user says which application they mean, and its choice persists across sessions.

**Fall back to the file manager when the remembered editor is gone.** Rejected for file clicks: the user chose the editor, and a Finder window in its place reads as a bug. The header directory button keeps its fallback because its label names the application it will open.

**Forward the line to the editor (`code --goto file:line`).** Argument syntax differs per editor and the catalog carries no per-application file grammar; the Sidebar preview keeps line landing and editors open at the top. Deferred.

**Direct `explorer.exe /select,` spawn on Windows.** The shared runner rejects non-zero exits, and Explorer exits 1 after raising the window; `Start-Process` returns 0 and detaches.

## Consequences

Clicking a file on a macOS or Windows host now reveals it in Finder or File Explorer until the user picks an editor or the Sidebar; a host with no launcher (SSH, headless Linux) keeps the Sidebar behavior unchanged, because the service's `active()` answers false for an empty catalog. The web scaffold disables the open-in-app rows unless a test asks for them, so existing browser e2e file-preview goldens are unaffected.

[The controller spec](../../../../packages/client/ui-open-in-app/tests/controller.client.spec.ts) owns `fileTarget()` and `openFile`; [the plugin spec](../../../../packages/client/ui-open-in-app/tests/browser-plugin.client.spec.ts) owns the provided service and its wording; [the action spec](../../../../packages/client/ui-open-in-app/tests/open-in-app-action.client.spec.tsx) owns the Sidebar entry; [the Chat apply spec](../../../../packages/client/ui-chat/tests/apply-inject.client.spec.tsx) owns the routing; [the host route spec](../../../../packages/host/open-in-app/tests/host-routes.spec.ts) owns file launches per application kind; [the path-opener spec](../../../../packages/util/native-command/tests/path-opener.spec.ts) owns `revealNativePath`.
