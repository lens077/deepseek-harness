# dsh-sandbox-policy — the sandbox policy home (`ctx.sandboxPolicy`)

English | [中文](README.zh.md)

The single owner of sandbox-policy resolution: the deployment's default [`SandboxMode`](../sandbox/README.md) and fallback root, plus each session's durable mode override, immutable primary cwd, and durable additional-directory snapshot. Every enforcing capability receives one resolved mode-and-roots policy per call; before each request, the model receives the same ordered roots without a separate capability inventory.

## Why a shared home

Filesystem tools, one-shot bash commands, and terminal sessions may enforce the same mode vocabulary in different combinations. If each resolved its own `mode` + `workspaceRoots`, they could drift into a split world, exactly what [the sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) warns against. Each enforcing backend consumes the complete owner-resolved policy, while the current context describes only what that policy means for any available operation the DSH file sandbox enforces. The [cross-family fs sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md) records the shared-policy decision.

## Config

- `mode` — the deployment default `SandboxMode` (`read-only` / `workspace-write` / `danger-full-access`), validated at load. Default `read-only` (fail-safe).
- `workspaceRoot` — the fallback directory `workspace-write` may write under for agentless calls or sessions without a cwd. Default `process.cwd()`, resolved to its absolute filesystem identity either way. A normal agent call uses its session header's immutable `cwd` instead.

## API

- `ctx.sandboxPolicy.resolve({ session?, mode? })` — resolves one complete per-call policy. An explicit approved mode outranks the session's last `sandbox/mode` event, which outranks `defaultMode`; `workspaceRoots[0]` is the canonical immutable session cwd or configured fallback, and later roots come from the latest `session/directories` snapshot. Canonicalization precedes lexical normalization so `symlink/..` agrees with process working-directory resolution.
- `ctx.sandboxPolicy.defaultMode` / `ctx.sandboxPolicy.workspaceRoot` — the deployment default and fallback primary root used by `resolve()`.
- `ctx.sandboxPolicy.additionalDirectoriesOf(session)` / `setAdditionalDirectories(session, directories)` — read or atomically replace the durable additional-root list. The write path accepts existing absolute directories, stores filesystem-canonical identities, removes duplicates and primary aliases, retains explicit ancestor/descendant roots, and appends one whole-list `session/directories` event.
- `sandbox:policy` — a request-time cache-safe context contribution derived directly from `resolve({ session })`. It states the mode's capability-neutral file-effect contract and every canonical session root under `workspace-write`; tool owners retain operation-specific denial and escalation guidance.
- `effectiveSandboxMode(events)` / `effectiveAdditionalDirectories(events)` — pure latest-write-wins folds for `sandbox/mode` and `session/directories` events.
- `setSandboxMode(session, mode)` — the write path for a per-session mode override; it appends exactly one `sandbox/mode` event.
- `SANDBOX_MODES` — every mode, for option advertisement and runtime validation.

The optional `./invariant` companion rejects a forged durable `sandbox/mode` event outside the closed vocabulary and a `session/directories` snapshot with non-absolute, non-canonical, duplicate, or primary-alias entries. Replay validation never requires a recorded directory to still exist; Session and its companion own the surrounding storage and core execution-enclosure rules. The agent loop logs the assembled full runtime-context snapshot as a sourced `user/message`, so exact policy input remains reconstructable without an in-memory “last told” mirror.

## The per-session store

A runtime mode switch is one log-only `sandbox/mode` event on the session it applies to. `effective mode = explicit grant ?? fold(events) ?? deployment default`, so an override survives restart by replay and two sessions never see each other's state. `SessionHeader.cwd` remains the immutable primary root; a required, non-ignorable `session/directories` event replaces the complete additional-root list, with absence meaning empty. Both event folds contribute to the full runtime-context snapshot before the next request.

## Model Experience

### Current file sandbox policy

#### What the model sees

One `sandbox:policy` contribution in the current runtime-context snapshot for every agent session. It does not enumerate mounted capabilities. Tool plugins retain operation and escalation guidance, approval policy contributes separately to the same snapshot, and plan guidance remains `dsh-plan-mode`'s system section.

##### Read-only

```markdown
Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.
```

##### Workspace-write

```markdown
Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under these session workspace roots: ["<primary root>","<additional root>",...]. The first root is the primary working directory; later roots are additional directories. Some platform temporary areas may also be writable.
```

##### Danger-full-access

```markdown
Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.
```

#### Token effect

One concise durable context message on the first request and each effective policy change; unchanged requests add nothing. `workspace-write` carries the ordered canonical session roots, so replacing additional directories changes the next snapshot; platform-specific temporary paths remain summarized.

#### KV Cache effect

The stable system prompt remains byte-identical across mode changes. A changed full context snapshot is appended after retained history, preserving the prior cached prefix; subsequent unchanged requests reuse that retained snapshot.

## Known Limitations and Deferred Work

- **Running processes capture their roots** — replacing additional directories affects future policy resolutions and process launches; an already-running confined process keeps the roots captured at spawn until it exits.
- **File-effect modes only** — `SandboxMode` governs file effects; network and process policy are outside its vocabulary, so no knob here restricts them.
- **Temporary areas are deliberately summarized** — enforcing backends grant different platform temporary areas, which are selected after policy resolution and therefore cannot be enumerated truthfully in the current context.
