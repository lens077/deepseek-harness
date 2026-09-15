# Domain Docs

How the engineering skills consume this repo's domain documentation when exploring the codebase.

This repo does not use the `CONTEXT.md` + `docs/adr/` layout those skills assume. Terminology and decisions already have homes here; the mapping below points at them.

## Before exploring, read these

- **[docs/glossary.md](../glossary.md)** — the term definitions. This is what the skills mean by `CONTEXT.md`.
- **[.agents/notes/](../../.agents/notes/README.md)** — the decision records. This is what the skills mean by `docs/adr/`. Read the notes touching the area you are about to work in.

Agent Notes are filed as `.agents/notes/{proposed,implemented,rejected,archived}/{architecture,bug-fix,feature,process,simplification,testing}/`. `implemented/` describes shipped reality; `proposed/` is not yet authority. **Archived notes are frozen history and never current authority** — do not cite one as the reason for a decision.

Deeper scopes carry their own standing orders rather than their own glossary: [packages/AGENTS.md](../../packages/AGENTS.md) and the subtree `AGENTS.md` files. Per-package contracts live in each package README.

## Do not create the skills' default files

Do not create `CONTEXT.md`, `CONTEXT-MAP.md`, or `docs/adr/` in this repo, and do not suggest them. A skill that wants to record a term edits [docs/glossary.md](../glossary.md); a skill that wants to record a decision writes an Agent Note under the directory rules in [.agents/notes/README.md](../../.agents/notes/README.md). Creating the default layout would split terminology and decisions across two competing systems.

## Use the glossary's vocabulary

When your output names a domain concept — an issue title, a refactor proposal, a hypothesis, a test name — use the term as defined in [docs/glossary.md](../glossary.md). Do not drift to synonyms the glossary explicitly avoids. `seam` in particular is reserved for the defined capability seam.

If the concept you need is not in the glossary yet, that is a signal: either you are inventing language the project does not use (reconsider), or there is a real gap (note it for `/domain-modeling`).

## Flag decision conflicts

If your output contradicts an existing Agent Note, surface it explicitly rather than silently overriding:

> _Contradicts [2026-08-10-session-log-version-mechanism](../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md), but worth reopening because…_

Cite the note by relative path, never by a number or bare filename.
