# @deepseek-ai/dsh-project-todos

[English](README.md) | 中文

`projectTodos` Remote 背后的项目级待办文档。Host 扫描用户配置的根目录下的每个项目以及每个已注册的工作区目录，寻找 `TODO.md` 这类文档，解析其中的列表项，并整体提供结果；每次扫描结果与上一次不同时都会发布 `project-todos/changed`。文档始终是用户自己的文件：这里不会写入它们，浏览器也只能读取上次扫描列出的文档。参考消费者是汇总面板的项目待办 tab（[ui-digest](../../client/ui-digest/README.zh.md)）。

## 数据

**项目**是一个目录：每个配置的根目录本身、根目录的每个直接子目录（隐藏目录、`node_modules` 与 `.git` 会被跳过），以及在设置了 `includeWorkspaces` 时 `ctx.workspaceRegistry` 已知的每个工作区。同时以两种方式到达的目录会列出两个来源。只有至少一条文件规则在其下匹配到文件的项目才出现在快照里。

**文档**是项目下匹配任一配置 `files` glob 的文件（相对项目目录，最多向下 `maxDepth` 层目录）。解析按行进行的 Markdown：无序（`-`、`*`、`+`）和有序列表项都是条目；`[x]` 方框标记条目为 `done`，`[ ]` 方框或没有方框则为 `open`；缩进给出深度，最近的前置标题给出所属小节，围栏代码块会被跳过。快照每个文档最多保留 `maxItemsPerFile` 个条目但会统计全部条目；超过 `maxFileBytes` 的文档只列出而不带条目，并附一条警告。

快照携带本次扫描使用的设置、检查过的候选目录数量、按名称排序的项目（各自的文档按最浅优先排列）及其计数，以及无法读取的根目录、候选目录和文档的警告。`get` 提供上一次快照；`rescan` 立即扫描；`readDocument` 返回一个已列出路径的文本，对其他任何路径回答 `not-listed`。

## 监视

根目录向下监视两层，每个已列出的项目向下监视一层，每个已列出的文档直接监视，因此新建或删除项目目录、新建顶层文档或编辑文档都会在 `watchDebounceMs` 的静默后触发重新扫描。出现在规则第一层以下的文档要到下一次显式重新扫描才会被发现。设置变更以及工作区存储域的任何写入也会重新扫描。

## 配置

| 键 | 必填 | 含义 |
| --- | --- | --- |
| `roots` | 否 | 绝对路径目录，其直接子目录即项目；默认 `[]`。 |
| `files` | 否 | 相对项目目录的 glob 规则，指明待办文档；默认 `[]`。 |
| `includeWorkspaces` | 否 | 已注册工作区是否也算项目；默认 `true`。 |
| `maxDepth` | 是 | 规则在项目下可到达的最深目录层级。 |
| `maxFileBytes` | 是 | 超过此大小的文档只列出而不带条目。 |
| `maxItemsPerFile` | 是 | 每个文档保留的条目数。 |
| `watchDebounceMs` | 是 | 文件事件后到重新扫描前的静默时间。 |

`roots`、`files` 与 `includeWorkspaces` 同时也是 `project-todos` 设置节：组合条目是它的基础层，用户的 `settings.yaml` 覆盖它，因此设置页可以无需重启地编辑它们。相对路径的根目录、空白规则或逃出项目的规则会在加载时和写入时被拒绝。

## 组合

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

加载时不需要任何依赖；`settings` 与 `workspaceRegistry` 是可选的同伴，存在时才读取。Remote 命名空间由 `@Remote` 方法（`get`、`rescan`、`readDocument`）生成并由 `dsh-api-remotes` 挂载，后者也把 `project-todos/changed` 转发给浏览器。

## 模型体验

无，扫描只服务于浏览器界面；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送供应商请求。

## 已知限制与后续工作

- **只读** — 面板不能勾选或新增条目；用户在编辑器里修改文档，监视器会捕获变更。
- **深层文档不被监视** — 匹配在规则第一层目录以下的文档在编辑时会刷新（它被直接监视），但只有显式重新扫描或另一处被监视的变更才能发现它。
- **普通项目符号算作未完成条目** — 用普通项目符号混写笔记和任务的文档会列出每一个项目符号；请用复选框区分它们。
