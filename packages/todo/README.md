# todo/ — todo / planning capability family

English | [中文](README.zh.md)

The todo capability: the model-facing session list, and the user-facing scan of project todo documents. Both are **product** packages — one agent session owns its list, and the user's files own theirs — so there is no replaceable provider contract.

| Package | Role | ctx key |
|---|---|---|
| [`tool-todo/`](tool-todo/README.md) | Stores and exposes the session's todo list. | (registers on `ctx.tools`) |
| [`project-todos/`](project-todos/README.md) | Scans configured roots and registered workspaces for `TODO.md`-style documents behind the `projectTodos` Remote. | `projectTodos` |

Each child README owns its tool or Remote, persistence, and rendering contract.

The event payload is documented on [docs/subsystems/session.md](../../docs/subsystems/session.md).
