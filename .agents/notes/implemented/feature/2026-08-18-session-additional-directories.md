# Agent Note: Session-level additional workspace directories

Status: implemented

English | [中文](2026-08-18-session-additional-directories.zh.md)

## Problem

A coding session sometimes needs to modify files in more than one directory. Treating every directory as a Workspace would corrupt the product model: Workspace records group Sessions by one immutable primary cwd, own sidebar order, and determine persistence placement. An unlogged process-only allowlist would create a different failure: the sandbox could grant writes that the model-visible policy context and a replayed session could not reconstruct.

The file tools, one-shot shell tools, persistent terminals, and platform confinement backends also need one effective root set. Independent root resolution would let one capability write where another refuses, or let process confinement differ from the policy text shown to the model. Windows standing ACL grants add a distinct risk: reusing one SID for overlapping wider and narrower root sets would union those grants over time.

## Decision

Each Session has one immutable primary directory and zero or more additional directories. `SessionHeader.cwd` remains the primary directory, Workspace membership key, persistence grouping key, relative-path base, and default process cwd. Additional directories are session policy state only: they never enter the header, create Workspace records, attach a Session to another group, or move its transcript. This preserves the [primary-cwd filesystem decision](../architecture/2026-07-02-fs-per-session-cwd.md), [Workspace product flow](2026-07-25-workspace-ui-product-flow.md), and [project session-directory layout](../architecture/2026-07-24-project-session-directories.md).

The required, non-ignorable `session/directories` event carries the complete canonical `additionalDirectories` list. The latest snapshot wins, absence means an empty list, and an equal canonical replacement appends nothing. Replay validates absolute canonical spellings, duplicate identities, and primary aliases without requiring recorded paths to still exist. The format stays within the current `SESSION_FORMAT_VERSION` because this is a new required event type, not an envelope change.

The write path accepts only absolute, existing directories. It resolves each with native realpath semantics, rejects files, removes aliases of the primary directory and earlier entries, and preserves the caller's remaining order. Explicit ancestor and descendant roots remain separate grants; the implementation never invents a common parent. The policy owner is the only writer, so Host RPC and ACP session setup share these rules and return the accepted canonical list.

`SandboxExecutionPolicy.workspaceRoots` is a non-empty ordered tuple. Element zero is the canonical primary cwd; later elements are the latest additional-directory snapshot. Relative fs paths, omitted shell workdirs, and omitted terminal cwd always resolve from element zero. An absolute workdir may start under an additional root, and `workspace-write` mutation access covers every explicit root. `read-only` still grants no session-root writes, and `danger-full-access` remains unconfined.

The in-process fs fence and the Seatbelt, bwrap, and Landlock process profiles derive their allowlists from the same `writableRoots(policy)` function. Shell and terminal consumers stamp the same resolved policy on process creation. A root-list replacement therefore affects later resolutions and launches only; an already-running background process or PTY retains the roots captured at spawn until it exits. This differs from persistent-terminal mode changes, which are rejected while a terminal is open, as recorded by the [persistent PTY decision](2026-07-16-persistent-pty-sessions.md).

Windows derives one order-independent SID from the exact sorted, deduplicated canonical root set using domain-separated, length-framed hashing. The same SID is granted on every explicit root, while the random private-temp SID remains scoped to one live Session/root-set pair. Changing set membership produces another SID, so standing ACEs for overlapping wider and narrower sets cannot combine into unintended authority. Temp-root overlap checks apply to every member. The [Windows ACL decision](2026-08-08-windows-acl-restricted-token-sandbox.md) continues to own the backend's partial-enforcement and standing-grant limits.

The model-visible `sandbox:policy` context lists the ordered explicit roots, identifies the first as primary, and summarizes platform temp areas. Because the additional list is a durable event and full runtime-context snapshots are logged, policy text remains reconstructable from the Session log. A replacement changes the next cache-safe tail snapshot; it does not rewrite the stable system prompt. This extends the [current sandbox-policy context decision](2026-07-30-current-sandbox-policy-context.md) without adding a capability inventory.

ACP advertises `sessionCapabilities.additionalDirectories`. `session/new` validates and canonicalizes the supplied list, then commits a non-empty initial snapshot in the unpublished Agent setup transaction before publication; absence represents an empty list. The primary ACP `cwd` remains the relative-path base, and non-empty MCP server lists remain unsupported. This changes roots within one Session without changing the [one-connection multi-session ownership model](2026-06-14-acp-multi-session.md) or ACP's automation-only role.

The Host exposes read and whole-list replacement RPCs. The Web Session row opens a Chinese directory-management dialog that shows the immutable primary directory, removes additional entries, and uses a third directory-picker child slot to add one. The UI always adopts the Host's canonical response and warns about the non-retroactive process lifetime. The same native and browse picker implementations occupy Workspace creation and Session-directory slots without calling `workspace.create` for the latter.

Forks inherit a directory snapshot only when it lies in the copied event prefix, following the [SessionStore fork decision](2026-06-30-session-store-fork-api.md); later parent replacements do not follow the child. Newly delegated or out-of-process subagents do not automatically inherit additional directories, and the existing sandbox-mode inheritance rule is unchanged. Additional roots do not trigger instruction-file discovery, become LSP workspaces, or change LSP containment under the primary cwd.

## Alternatives considered

**Create one Workspace per additional directory** — rejected. It would turn write authority into grouping and persistence ownership, give one Session several ledger entries, and make removal look like deleting product data rather than narrowing future process access.

**Store additional directories in `SessionHeader`** — rejected. The primary cwd is immutable identity used before event replay. A mutable header field would mix identity with policy state and bypass the event-sourced, model-visible reconstruction rule.

**Keep an in-memory allowlist outside the log** — rejected. Restarts and forks could not reconstruct it, while the model could receive policy text that had no durable source.

**Collapse overlapping roots to a common ancestor** — rejected. A common parent grants paths the caller never named. Explicit ancestor and descendant entries are redundant for containment but remain meaningful caller intent and stable round-trip state.

**Give every Windows root its own standing SID** — rejected. A token carrying several per-root SIDs would make standing grants compose across sessions and root sets. One SID for the exact complete set prevents a narrower policy from inheriting a wider set's accumulated authority.

**Retroactively revoke roots from running processes** — rejected. POSIX confinement profiles and Windows restricted tokens capture authority at spawn, and changing a live process safely would require another process lifecycle mechanism. The UI and policy documentation state the future-launch boundary instead.

## Consequences

A Session can work across several explicit directories while retaining one primary identity and one Workspace ledger entry. Model context, fs mutation checks, shell confinement, terminal launches, ACP setup, Host RPCs, and Web state all derive from the same durable list.

The design pays for synchronous filesystem validation when the list changes, extra policy bytes proportional to the explicit roots, and platform grants for each new set. Directory removal is not immediate revocation for already-running processes, fork inheritance follows the selected log prefix rather than the parent's current state, and subagent or LSP multi-root propagation remains a separate decision.

## Verification

The repository TypeScript aggregate checks the event map, policy tuple, every process and fs consumer, ACP capability setup, Host schemas and carrier methods, client runtime, slot registrations, and UI props as one graph. Existing platform profile and Windows runner suites retain their enforcement ownership; this change updates their policy fixtures without introducing a second allowlist implementation. The allowed validation for this change is `pnpm run typecheck`.
