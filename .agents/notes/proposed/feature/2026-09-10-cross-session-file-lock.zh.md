# Agent Note：跨会话文件租约与资源治理

Status: proposed

[English](2026-09-10-cross-session-file-lock.md) | 中文

## 问题

一个 `dsh web` Host 同时运行多个会话，它们的 Agent 在相互重叠的目录里工作：同一 checkout 中并行的 Web 会话、跨工作区扇出的子 Agent、以及恰好触碰同一文件的独立 Agent。Git worktree 隔离的是分支，不是两个会话经同一路径到达的文件。`dsh-fs-local` 按目标键串行化单次操作，`dsh-fs-observation-policy` 拒绝覆盖本会话从未读过的内容，但二者都不知道另一个会话的存在：会话 A 对某文件多步编辑做到一半时，会话 B 可以读到它，随后 B 自己的编辑又覆盖了 A 的改动。没有任何记录说明谁在修改什么，用户也就看不出两个会话为何产生了冲突的结果。[Agent 团队决策](../../implemented/feature/2026-08-05-agent-teams.zh.md)点明了同一处共享 checkout 的边界，并拒绝把任务所有者当作文件锁；本 note 补上它留下的显式租约。

更宽泛的“一个人、许多 Agent”问题——共享的 CPU、内存、磁盘、构建缓存、无主进程——经审视后针对这台机器收窄：macOS 上的单一操作者、并发任务很少，没有内存或磁盘压力，因此按宿主水位准入没有必要；跨会话文件冲突才是真实且已观察到的问题。仅 Linux 可用的探测（`/proc/meminfo`、PSI、`flock(1)`）不在范围内。

## 提案

### 租约跟随执行修改的 turn

`@deepseek-ai/dsh-tool-call-file-lock` 为其 `tools` 规则中列出的工具（自带的 `read`、`read_image`、`write`、`edit` 与 `str_replace_editor`）包装 `tools/execute`。会话对某文件的第一次 `write` 或 `edit` 取得一份以提供方 `targetKey`（本地后端即 realpath）为键的独占租约，持有到该会话的 `turn/end`；`agent/disposed` 与 `leaseTtlMs`（默认 30 分钟）是 turn 始终不关闭时的兜底。租约覆盖一个运行时家族——根 Agent 及其拥有的全部 Agent——因此子 Agent 编辑父级的文件从不等待，而两个根会话会。

租约表是一张进程内的 `FileLockRegistry`：同一个 `dsh` 进程的全部会话共享它，因此不需要文件系统锁、`flock` 或外部命令，插件与平台无关。一次释放先唤醒所有等待中的读者，再授予队首的写者。

### 外部写入先排队、后拒绝

面对外部租约的写入按 FIFO 排队最多 `writeWaitMs`（默认 10 分钟）。释放后继续执行并接管租约；超时则模型收到 `FILE_LOCKED` 错误，指明持有者会话（已知时含标题与工作区）、租约起始时间与等待时长，并告知等待该会话的 turn 或改做别处。不提供“照样覆盖”的选项：那正是租约要防止的冲突。

### 外部读取先等待、再询问、后订阅

面对外部租约的读取静默等待 `readWaitMs`（默认 30 秒）。窗口内释放则恢复读取，并附上说明持有者与等待时长的通知。窗口过后，拥有用户提问应答方的根会话通过 `ctx.userQuestions` 询问人类：**Read now** 读取当前内容并附上内容可能不完整的通知，且在本轮 turn 剩余时间内记住该选择；**Keep waiting** 订阅释放、不设上限，租约一释放立即唤醒。问题在同一个 `AbortController` 下与释放竞速，因此提问挂起期间发生释放会撤回问题并直接读取。受委托的 Agent 无法询问人类（`DELEGATED_CALLER`），组合也可能没有挂载应答方；二者都遵循 `delegatedReadTimeout`（默认 `wait`，或 `read-now`）。

### 每个决定都被记录并投影

`file-lock/acquired`、`waiting`、`asked`、`answered`、`subscribed`、`settled` 与 `released`（仅 TTL；turn 结束时的释放由 `turn/end` 隐含）是硬会话事件，因为拒绝文本与通知会到达模型。`fileLocks` 投影（状态版本 1）把它们折叠为每个会话的 `held` 与 `waiting`，并在 `turn/end` 重置，UI 由此读取唯一权威视图。

### 等待时长由设置拥有

`readWaitMs`、`writeWaitMs`、`leaseTtlMs` 与 `delegatedReadTimeout` 通过 `settings.installSection` 构成 `file-lock` 设置节：组合值是基础层，用户的设置文档实时覆盖它。`tools` 保持仅组合层，因为它命名的是部署工具而非用户偏好。

## 交付顺序

1. 插件、其事件与投影、设置节、基础 bundle 接线，以及两个根 Agent 上的真实组合测试套件。
2. **本次变更**——`dsh-client-ui-settings-plugins` 中的**文件锁**卡片，使三个等待时长与受委托读取的行为可在 Web 插件设置页编辑。每个等待时长按各自选定的单位编辑（读取等待用秒，写入排队与租约 TTL 用分钟），而文档仍保存毫秒；受委托读取的行为是两个 token 的选择而非自由文本。
3. 资源清单（每会话的 `subprocess`、`dsh-mcp-client` 子进程、jobs）与提供租约表、清单和无主进程的 `resource-governance` Remote，含需确认的显式 id `reclaim`。
4. `dsh-client-ui-digest`：**运行中**之后的**等锁**收件箱分区、`blocked` 导航徽章、**资源** tab（锁、每会话清单、仅桌面端可确认终止的无主进程），以及晨报条目。
5. 可选的 `bash` 重命令串行化（`pnpm run build|typecheck|test:coverage`），仅做互斥，不做水位。

## 曾考虑的替代方案

- **按工具调用加锁。** 拒绝：一次修改是整个 turn；`write` 返回即释放会让另一会话在同一改动的两次编辑之间读到文件。
- **在 `fs/write-intent` / `fs/edit-intent` 加锁。** 拒绝：读取不经过这些 waterfall，而人类决策正在读取一侧；`tools/execute` 在一处同时看到两种访问。
- **文件系统锁（`flock`、`/tmp` 下的锁文件）。** 暂时拒绝：所有会话共享一个 Host 进程；文件后端的表延后到 CLI 与 Web Host 需要协调时。
- **宿主水位准入（内存、磁盘、PSI）。** 对本部署拒绝；设计在交付步骤 5 中为其保留了纯互斥的位置。
- **有上限的订阅加第二次提问。** 拒绝：用户要求无上限等待；turn 的取消即是出口。

## 验收标准

- 两个根会话写同一文件：第二个在 `writeWaitMs` 后被拒绝并指明持有者；在窗口内排队则于持有者 `turn/end` 时继续。
- 外部读取在 `readWaitMs` 内于释放时恢复；窗口过后提问，`Read now` 在本轮 turn 内被记住，`Keep waiting` 在释放时恢复，提问期间的释放会撤回问题。
- 受委托的子 Agent 共享父级租约，面对外部租约时遵循 `delegatedReadTimeout`。
- TTL、销毁与 turn 结束各自释放租约；取消等待中的 turn 把等待结算为 `aborted`。
- `file-lock` 用户节覆盖组合层的等待时长；销毁插件会移除包装器与全部租约。

## 风险

- 通过 `bash` 修改的文件不取得租约。步骤 4 的重命令互斥收窄构建产物冲突；README 记录了这一缺口。
- 订阅中的读取按设计无限期保持其 turn 打开；步骤 3 的汇总面板是用户查看并取消它的地方。
