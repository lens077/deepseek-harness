# Agent Note: 会话级附加工作区目录

Status: implemented

[English](2026-08-18-session-additional-directories.md) | 中文

## 问题

一个编码会话有时需要修改多个目录中的文件。把每个目录都视为 Workspace 会破坏产品模型：Workspace 记录依据一个不可变主要 cwd 对 Session 分组，持有侧边栏顺序，并决定持久化位置。只在进程内保存、不写入日志的 allowlist 则会产生另一种错误：沙箱可以授予模型可见策略上下文和会话回放都无法重建的写入权限。

文件工具、一次性 shell 工具、持久终端和各平台限制后端也需要共用同一个有效根目录集合。各自解析根目录会使一项能力允许写入而另一项拒绝，或者让进程限制与模型看到的策略文本不一致。Windows 常驻 ACL 授权还有一项独立风险：如果相互重叠的较宽和较窄根目录集合复用同一个 SID，授权会随时间合并。

## 决策

每个 Session 有一个不可变主要目录和零个或多个附加目录。`SessionHeader.cwd` 仍是主要目录、Workspace 成员关系键、持久化分组键、相对路径基准和默认进程 cwd。附加目录只属于会话策略状态：它们绝不进入 header、创建 Workspace 记录、把 Session 附加到另一个分组，也不会移动 transcript。此规则保留[主要 cwd 文件系统决策](../architecture/2026-07-02-fs-per-session-cwd.zh.md)、[Workspace 产品流程](2026-07-25-workspace-ui-product-flow.zh.md)和[项目会话目录布局](../architecture/2026-07-24-project-session-directories.zh.md)。

必需且不可忽略的 `session/directories` 事件携带完整的规范 `additionalDirectories` 列表。最新快照胜出，没有快照即表示空列表；规范化结果相同的替换不会追加事件。回放会验证绝对且规范的路径拼写、重复标识和主要目录别名，但不要求记录的路径仍然存在。格式仍沿用当前 `SESSION_FORMAT_VERSION`，因为这是新的必需事件类型，而非事件信封变更。

写入路径只接受绝对且现有的目录。它按原生 realpath 语义解析每个目录，拒绝文件，移除主要目录和先前条目的别名，并保留其余条目的调用方顺序。显式的祖先根目录和后代根目录仍是独立授权；实现绝不会自行创建共同父目录。策略归属方是唯一写入方，因此 Host RPC 和 ACP 会话设置共用这些规则，并返回已接受的规范列表。

`SandboxExecutionPolicy.workspaceRoots` 是非空有序元组。第零项是规范化后的主要 cwd，后续项来自最新附加目录快照。相对 fs 路径、省略的 shell workdir 和省略的终端 cwd 始终以第零项为基准。绝对 workdir 可以从附加根目录启动，`workspace-write` 变更权限覆盖每个显式根目录。`read-only` 仍不授予会话根目录写入，`danger-full-access` 仍不受限制。

进程内 fs 围栏与 Seatbelt、bwrap、Landlock 进程 profile 都从同一个 `writableRoots(policy)` 函数派生 allowlist。Shell 与终端消费方在进程创建时标记同一份已解析策略。因此，替换根目录列表只影响后续解析和启动；已经运行的后台进程或 PTY 在退出前保留 spawn 时捕获的根目录。这不同于持久终端模式变更；后者在终端开放期间会被拒绝，具体见[持久 PTY 决策](2026-07-16-persistent-pty-sessions.zh.md)。

Windows 使用带域分离和长度成帧的哈希，从经过排序、去重和规范化的精确根目录集合中派生一个不受顺序影响的 SID。同一个 SID 会授予每个显式根目录，随机私有临时目录 SID 则仍限定到一个活跃的 Session／根目录集合对。集合成员变化会产生另一个 SID，因此相互重叠的较宽和较窄集合所留下的常驻 ACE 不会合并成非预期权限。临时根目录重叠检查会覆盖每个成员。[Windows ACL 决策](2026-08-08-windows-acl-restricted-token-sandbox.zh.md)继续负责后端的部分强制执行和常驻授权限制。

模型可见的 `sandbox:policy` 上下文列出有序显式根目录，标明首项为主要目录，并概述平台临时区域。附加目录列表来自持久事件，完整运行时上下文快照也会写入日志，因此策略文本仍可从 Session 日志重建。替换会改变下一份缓存安全尾部快照，但不会重写稳定系统提示词。此机制扩展[当前沙箱策略上下文决策](2026-07-30-current-sandbox-policy-context.zh.md)，而不增加能力清单。

ACP 公布 `sessionCapabilities.additionalDirectories`。`session/new` 会校验并规范化所提供的列表，再于 Agent 发布前，在尚未发布的 Agent setup 事务中提交非空初始快照；没有该事件则表示空列表。主要 ACP `cwd` 仍是相对路径基准，非空 MCP 服务器列表仍不受支持。该能力只改变一个 Session 内的根目录，不会改变[单连接多会话归属模型](2026-06-14-acp-multi-session.zh.md)或 ACP 仅面向自动化的角色。

Host 公开读取和完整列表替换 RPC。Web Session 行会打开中文目录管理对话框，显示不可变主要目录、移除附加条目，并通过第三个目录选择器子 slot 添加目录。UI 始终采用 Host 返回的规范结果，并提示进程生命周期中的非追溯生效边界。相同的原生与浏览式选择器实现会同时占用 Workspace 创建和 Session 目录 slot；后者不会调用 `workspace.create`。

Fork 只在目录快照位于已复制事件前缀内时继承它，遵循 [SessionStore fork 决策](2026-06-30-session-store-fork-api.zh.md)；父会话之后的替换不会跟随子会话。新委派或跨进程 subagent 不会自动继承附加目录，现有沙箱模式继承规则保持不变。附加根目录不会触发指令文件发现，不会成为 LSP 工作区，也不会改变 LSP 在主要 cwd 下的包含边界。

## 曾考虑的替代方案

**为每个附加目录创建一个 Workspace**：否决。该方案会把写入权限变成分组与持久化归属，使一个 Session 拥有多个账本条目，并让目录移除看起来像删除产品数据，而不是收窄后续进程访问。

**把附加目录存入 `SessionHeader`**：否决。主要 cwd 是事件回放前就使用的不可变标识。可变 header 字段会混合身份与策略状态，并绕过事件溯源和模型可见内容重建规则。

**在日志之外保留内存 allowlist**：否决。重启和 fork 无法重建该列表，模型却可能收到没有持久来源的策略文本。

**把相互重叠的根目录折叠成共同祖先**：否决。共同父目录会授予调用方从未指定的路径。显式祖先和后代条目对包含关系而言可能冗余，但仍代表调用方意图和稳定的往返状态。

**为每个 Windows 根目录分配独立常驻 SID**：否决。携带多个逐根 SID 的令牌会使常驻授权跨会话和根目录集合组合。对精确完整集合使用一个 SID，可防止较窄策略继承较宽集合积累的权限。

**从运行中的进程追溯撤销根目录**：否决。POSIX 限制 profile 和 Windows 受限令牌都在 spawn 时捕获权限；安全修改活跃进程需要另一套进程生命周期机制。UI 与策略文档改为明确说明只影响后续启动。

## 后果

一个 Session 可以跨多个显式目录工作，同时保留一个主要身份和一个 Workspace 账本条目。模型上下文、fs 变更检查、shell 限制、终端启动、ACP 设置、Host RPC 与 Web 状态都从同一份持久列表派生。

该设计的代价包括：列表变化时同步校验文件系统、策略字节数随显式根目录增长，以及各平台为每个新集合物化授权。目录移除不会立即撤销已运行进程的权限；fork 继承遵循所选日志前缀，而不是父会话当前状态；subagent 或 LSP 多根传播仍需单独决策。

## 验证

仓库 TypeScript 聚合会把事件映射、策略元组、每个进程与 fs 消费方、ACP 能力设置、Host schema 与载体方法、客户端运行时、slot 注册和 UI props 作为一张图检查。现有平台 profile 与 Windows runner 套件继续持有各自的强制执行验证；本次变更只更新其策略 fixture，不引入第二套 allowlist 实现。本次变更允许执行的验证命令是 `pnpm run typecheck`。
