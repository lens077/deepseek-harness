# todo/：todo／规划能力家族

[English](README.md) | 中文

todo 能力：面向模型的会话列表，以及面向用户的项目待办文档扫描。两者都是**产品**包——一个 agent（智能体）会话拥有自己的列表，用户的文件拥有它们的列表——因此不存在可替换的提供方约定。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`tool-todo/`](tool-todo/README.zh.md) | 存储并公开会话的 todo 列表。 | （注册到 `ctx.tools`） |
| [`project-todos/`](project-todos/README.zh.md) | 在 `projectTodos` Remote 背后扫描配置的根目录与已注册工作区中的 `TODO.md` 类文档。 | `projectTodos` |

各子级 README 负责其工具或 Remote、持久化和渲染约定。

事件载荷记录在 [docs/subsystems/session.md](../../docs/subsystems/session.zh.md)。
