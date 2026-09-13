---
description: "Web Session-header \"Open In...\" split button: launches the remembered application on the session workspace directory, sends Chat file clicks to the same application (or the Sidebar), and lists every application the host probed as installed."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-open-in-app

English | [中文](README.zh.md)

## Summary

This package provides the browser surface of the open-in-app feature: a Session-header split button whose main button opens the current session's workspace directory (the summary's `cwd`) in the remembered application, and whose chevron lists every catalog application the host probed as installed plus a **Sidebar preview** entry. The remembered entry also decides where a file click in the conversation goes: the same application (Finder or File Explorer reveals the file in its folder, an editor opens it) or the right Sidebar's text preview. Availability, icons, and launches come from the host routes of [`dsh-host-open-in-app`](../../host/open-in-app/README.md); mount the two packages together. A session without a workspace directory, or a host where nothing nameable is installed, renders no button at all, and file clicks then stay in the Sidebar.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin in the Web composition beside [`dsh-host-open-in-app`](../../host/open-in-app/README.md); the pair composes the whole feature in two cordis.yml rows and this row takes no config. The Session header grows an "Open In..." split button whenever the host probed at least one installed catalog application and the session has a known workspace directory.

### What to expect

The main button shows the remembered application's icon — the real application icon wherever the host extracts one (macOS bundle icons, Windows executable icons, Linux theme icons), a generic glyph where it serves none — and a design-system tooltip ("Open locally"); clicking launches immediately. The chevron opens a dense menu of the installed applications, then the Sidebar preview entry, with the remembered one marked by a filled row. Availability is read once per page from the host; the last chosen entry persists in the browser (`dsh.open-in-app.choice`), and the header falls back to the first available application when the remembered one is no longer installed. A launch that finishes quickly leaves the button untouched — the dimmed busy treatment appears only after 250 ms in flight — and a failed launch shows the error tooltip and a red outline for two seconds. All copy lives in the bilingual `open-in-app` locale namespace; an application id the dictionaries cannot name is not offered.

Clicking a file in the conversation — a produced-file chip, an inline-code mention, a tool row's path — follows the same remembered entry. With no choice made, the first application the host offers takes it, and the catalog puts the platform file manager first: Finder on macOS and File Explorer on Windows reveal the file selected in its folder, editors and IDEs open the file itself, and terminals or Git GUIs open its folder. Choosing **Sidebar preview** keeps every file click in the right Sidebar's text preview (the product's own viewer) and turns the header button into the Sidebar file-tree opener. A remembered application the host no longer offers is never silently replaced for file clicks: the click shows Chat's open-failure dialog naming the application, so an uninstalled editor is a visible warning, not a surprise Finder window; a launch the host could not perform reports the same way.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin registers the split button on `conversation.session.header.utilities` through the standard slot/inject currency, registers the `open-in-app` dictionaries as one effect, and provides Chat's optional `chatFileOpener` service (declared by [`dsh-client-ui-chat`](../ui-chat/README.md)). A page-lifetime controller ([`src/client/controller.ts`](src/client/controller.ts)) owns the once-per-page availability read, the persisted choice snapshot store, the launch POST, and the file-target decision (`fileTarget()`: Sidebar, an offered app, a remembered-but-unoffered app, no launcher at all, or pending before the host answered); the component receives both stores through the inject `hooks` compartment, so every Session header shares one truth. The service's `active()` answers false only for the Sidebar and an empty host, so Chat keeps its own Sidebar path there; `open(path)` waits for availability, launches the target on the absolute path, and words the controller's `OpenInAppLaunchError` codes from the dictionaries for Chat's dialog. Route paths and wire payload types are inlined from the host package's browser-safe `@deepseek-ai/dsh-host-open-in-app/shared` subpath. In-flight launches are guarded by a ref — repeat clicks and menu picks during a launch are ignored whole (a pick would otherwise persist a choice the gesture never opened) — and the busy/error dress is timer-driven around the `launch` promise. The node half is an empty `apply` that keeps the plugin on the host roster.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-host-open-in-app](../../host/open-in-app/README.md) — the host routes serving availability, icons, and launches, and the catalog behind them.
- [dsh-session-log-export](../../session-query/session-log-export/README.md) — the sibling Session-header action.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the split button is browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The dictionaries gate the menu.** A host catalog extension without a matching `app.<id>` entry in both dictionaries stays invisible instead of showing a raw id; extending the catalog means extending [`dsh-host-open-in-app`](../../host/open-in-app/README.md) and this package's locales together.
- **Availability is read once per page.** An application installed while the page is open appears after a reload (and, host-side, after a host restart).
- **A file click's line is not forwarded to the application.** The Sidebar preview lands on the requested line; an external editor opens the file at its top.
- **Desktop Linux reveals the folder, not the file.** No portable file-manager select verb exists, so the file manager entry opens the parent directory there.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The feature-level decisions, including the split into the host package and this surface, are recorded in the [promotion Agent Note](../../../.agents/notes/implemented/feature/2026-08-25-promote-open-anywhere-plugin.md).

</details>

**Runtime invariant:** No companion is published. The plugin registers one dictionary effect and one header-slot entry whose disposal the HMR-safety spec proves; availability and choice live in the controller's snapshot stores with no second copy to diverge.
