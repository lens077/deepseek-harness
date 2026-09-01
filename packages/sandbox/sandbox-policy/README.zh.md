# dsh-sandbox-policy：沙箱策略归属位置（`ctx.sandboxPolicy`）

[English](README.md) | 中文

沙箱策略解析的唯一归属位置：部署默认 [`SandboxMode`](../sandbox/README.zh.md) 与回退根目录，加上每个会话的持久模式覆盖、不可变主要 cwd 和持久附加目录快照。每项负责强制执行的能力在每次调用时都会收到一项解析完成的模式与有序根目录策略；模型在每次请求前会收到相同的有序根目录，而不会另收一份能力清单。

## 为何需要共享归属位置

文件系统工具、一次性 bash 命令和终端会话可以用不同组合强制执行同一套模式词汇。如果各自解析 `mode` + `workspaceRoots`，就可能漂移成分裂世界，正是[沙箱 Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.zh.md)所警告的情况。每个强制执行后端都会消费归属方解析出的完整策略，而当前上下文只说明该策略对于任何受 DSH 文件沙箱强制执行的可用操作有何含义。[跨家族 fs 沙箱 Agent Note](../../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.zh.md)记录了共享策略决策。

## 配置

- `mode`：部署默认 `SandboxMode`（`read-only`／`workspace-write`／`danger-full-access`），加载时验证。默认为 `read-only`（故障安全）。
- `workspaceRoot`：无 agent（智能体）的调用或没有 cwd 的会话在 `workspace-write` 下可写入的回退目录。默认为 `process.cwd()`；无论显式配置还是采用默认值，都会解析为其绝对文件系统标识。普通 agent 调用改用其会话头中不可变的 `cwd`。

## 接口

- `ctx.sandboxPolicy.resolve({ session?, mode? })`：解析一项完整的逐调用策略。显式批准的模式优先于会话最后一条 `sandbox/mode` 事件，后者又优先于 `defaultMode`；`workspaceRoots[0]` 是规范化后的不可变会话 cwd 或配置回退值，后续根目录来自最新的 `session/directories` 快照。规范化先于词法归一化，因此 `symlink/..` 与进程工作目录解析保持一致。
- `ctx.sandboxPolicy.defaultMode`／`ctx.sandboxPolicy.workspaceRoot`：`resolve()` 使用的部署默认值与主要回退根目录。
- `ctx.sandboxPolicy.additionalDirectoriesOf(session)`／`setAdditionalDirectories(session, directories)`：读取或原子替换持久附加根目录列表。写入路径只接受现有的绝对目录，存储文件系统规范化标识，移除重复项和主要目录别名，保留显式的祖先／后代根目录，并追加一条完整列表形式的 `session/directories` 事件。
- `sandbox:policy`：直接派生自 `resolve({ session })` 的请求时缓存安全上下文贡献。它说明该模式中与具体能力无关的文件操作约定，以及 `workspace-write` 下的每个规范化会话根目录；工具归属方仍负责特定于操作的拒绝与升权引导。
- `effectiveSandboxMode(events)`／`effectiveAdditionalDirectories(events)`：分别对 `sandbox/mode` 与 `session/directories` 事件执行最后写入胜出的纯 fold。
- `setSandboxMode(session, mode)`：逐会话模式覆盖的写入路径；它恰好追加一条 `sandbox/mode` 事件。
- `SANDBOX_MODES`：所有模式，用于选项展示与运行时验证。

可选的 `./invariant` 配套组件会拒绝超出封闭词汇的伪造持久 `sandbox/mode` 事件，以及包含非绝对、非规范、重复或主要目录别名条目的 `session/directories` 快照。回放验证不要求记录的目录仍然存在；Session 与其配套组件负责相关存储与核心执行封闭规则。agent loop（智能体循环）会将组装后的完整运行时上下文快照记录为一条带来源的 `user/message`，因此无需内存中的「上次告知」镜像，也能重建确切的策略输入。

## 逐会话存储

运行时模式切换是在对应会话日志中追加的一条 `sandbox/mode` 事件。`effective mode = explicit grant ?? fold(events) ?? deployment default`，因此覆盖会通过回放跨重启保留，两个会话也绝不会看到彼此状态。`SessionHeader.cwd` 仍是不可变主要根目录；一条必需且不可忽略的 `session/directories` 事件会替换完整附加根目录列表，没有该事件即表示空列表。两个事件 fold 都会在下一次请求前贡献给完整运行时上下文快照。

## 模型体验

### 当前文件沙箱策略

#### 模型看到的内容

每个 agent 会话的当前运行时上下文快照中都有一项 `sandbox:policy` 贡献。它不枚举已装载的能力。工具插件继续负责操作与升权引导，批准策略单独贡献给同一份快照，计划引导仍由 `dsh-plan-mode` 的系统段落管理。

##### 只读

```markdown
Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.
```

##### 工作区写入

```markdown
Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under these session workspace roots: ["<primary root>","<additional root>",...]. The first root is the primary working directory; later roots are additional directories. Some platform temporary areas may also be writable.
```

##### 完全访问

```markdown
Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.
```

#### Token 影响

首次请求和有效策略每次变化时增加一条简洁的持久上下文消息；未变化的请求不增加内容。`workspace-write` 携带有序且规范化的会话根目录，因此替换附加目录会改变下一份快照；平台特定的临时路径仍以摘要表述。

#### KV Cache 影响

模式切换时，稳定的系统提示词仍逐字节相同。变化后的完整上下文快照会追加到保留的历史之后，从而保留此前已缓存的前缀；后续未变化的请求会复用该保留快照。

## 已知限制与暂缓事项

- **运行中的进程会捕获其根目录**：替换附加目录会影响后续策略解析和进程启动；已经运行的受限进程在退出前仍保留 spawn 时捕获的根目录。
- **仅限文件操作模式**：`SandboxMode` 管控文件操作；网络和进程策略不在其词汇中，因此这里没有限制它们的旋钮。
- **有意概述临时区域**：强制执行后端会授予不同的平台临时区域，这些区域在策略解析后才会选定，因此无法在当前上下文中如实枚举。
