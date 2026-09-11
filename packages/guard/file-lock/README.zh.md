---
description: "跨会话的文件租约，覆盖 fs 工具：修改文件的会话在本轮 turn 结束前持有该文件，外部写入排队，外部读取先等待、再询问用户或订阅释放；面向组合或调试该插件的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-call-file-lock

[English](README.md) | 中文

## 概要

使用本包阻止两个会话同时修改同一个文件。最先用 `write` 或 `edit` 触碰某文件的会话会租下它，直到其 turn 结束。另一会话的写入最多等待 `writeWaitMs` 后被拒绝并指明持有者；另一会话的读取先等待 `readWaitMs`，随后询问用户是立即读取还是继续等待，选择继续等待则订阅释放、不设上限。每个决定都是一条折叠进 `fileLocks` 投影的 `file-lock/*` 会话事件。等待时长可在 `file-lock` 设置命名空间下由用户修改；`dsh` 基础 bundle 启用了它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

基础 bundle 以默认值挂载本插件。从不触碰其他会话正在修改的文件的会话不会察觉任何变化；只有被争用的文件才会等待、询问或拒绝。

### 何时选择它

当同一个 `dsh` 进程里的多个会话在相同目录中工作——并行的 Web 会话、跨工作区扇出的子 Agent——而某个会话改到一半的编辑不能被另一个会话读到或覆盖时，选择它。单会话的组合里不存在外部租约，无需使用；也不要指望它覆盖通过 `bash` 修改的文件：只有 `tools` 中列出的工具受保护。

### 配置方式

挂载插件；每个字段都有默认值：

```yaml
- name: '@deepseek-ai/dsh-tool-call-file-lock'
  config:
    readWaitMs: 30000        # silent wait before the user is asked
    writeWaitMs: 600000      # queue before a foreign write is refused
    leaseTtlMs: 1800000      # a lease older than this is released even mid-turn
    delegatedReadTimeout: wait   # or read-now, for callers that cannot ask a human
    tools:                   # which tools take which access; defaults cover the shipped fs tools
      - { tool: read, pathArgument: file_path, access: read }
      - { tool: write, pathArgument: file_path, access: write }
```

`readWaitMs`、`writeWaitMs`、`leaseTtlMs` 与 `delegatedReadTimeout` 构成 `file-lock` 设置节：组合值是基础层，设置提供方写入的用户层——`$DSH_HOME` 下的 `settings.yaml` 文档，或 Web 插件设置页上以秒和分钟、用日常用语编辑这些等待时长的**共用文件**卡片——会实时覆盖它们。`tools` 仅限组合层。带 `readWhenArgument` 与 `readWhenValues` 的规则会把写规则在单次调用中转为读取，自带的 `str_replace_editor` 规则对 `command: view` 就是如此。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-call-file-lock)列出了全部字段。

### 你会得到什么

会话对某文件的第一次 `write` 或 `edit` 会租下它；租约覆盖同一运行时家族（一个根 Agent 及其拥有的 Agent）的全部会话，并随租约会话的 `turn/end`、其销毁或 `leaseTtlMs` 结束。面对外部租约时：

- **写入**按 FIFO 排队最多 `writeWaitMs`。释放后继续执行并接管租约；超时则模型收到 `Error: file lock: "<path>" is being modified by session "<title>" (workspace <cwd>) since <time>; waited <n>s. Wait for that session to finish its turn, or work on a different file.`，错误码为 `FILE_LOCKED`。
- **读取**等待 `readWaitMs`。窗口内释放则恢复读取，并附加一条说明持有者与等待时长的通知。窗口过后，拥有用户提问应答方的根会话会提出 **Shared file** 问题：`Read now` 读取当前内容并附上内容可能不完整的通知，且本轮 turn 内记住该选择；`Keep waiting` 订阅释放、不设上限。提问挂起期间发生释放会撤回问题并直接读取。受委托的调用方或没有应答方的组合则改为遵循 `delegatedReadTimeout`。
- 取消调用方的 turn 会以 `aborted` 结束任何等待，并让工具自行报告取消。

每个会话的 `fileLocks` 投影包含 `held`（本轮 turn 内租下的显示路径）与 `waiting`（当前被外部租约挡住的调用，含持有者与阶段：`waiting`、`asked` 或 `subscribed`）。两者都在 `turn/end` 时重置。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本节说明租约表位于何处、一次调用如何经过各等待阶段、以及由哪些代码实现；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 设计理念

- **一张进程内的表，按文件身份为键。** 同一个 `dsh` 进程的所有会话共享 `FileLockRegistry`，键是提供方的 `targetKey`（本地后端即 realpath），因此两个工作区通过不同相对路径到达同一文件时争用的是同一份租约。不涉及任何文件系统锁或外部命令。
- **租约跟随 turn 而非调用。** 一次修改是执行它的整个 turn，所以租约在 `turn/end` 释放而不是工具返回后释放；`agent/disposed` 与 TTL 是 turn 始终不关闭时的两道兜底。
- **读者先于写者。** 一次释放先唤醒所有等待中的读者，再授予队首的写者，因此久等的读取不会被新来的写入再次压后。
- **停滞的读取由人来决定。** 读取不能悄悄返回另一会话改到一半的内容；静默窗口过后，用户在“过时但立刻”和“正确但稍后”之间选择，该选择在本轮 turn 内被记住。
- **每个决定都被记录。** 等待、提问、回答、订阅、结算与非 turn 释放都是会话事件，因此转录与 `fileLocks` 投影能还原一次调用为何暂停、谁持有该文件。

### 租约表

`FileLockRegistry` 为每个键保存一份 `Lease`，含其家族、所有者会话与持有者集合。`acquire` 对空闲键或持有家族立即授予，否则将写者入队；`awaitRelease` 在不存在外部租约时立即解析，否则将读者入队；`releaseAll(session)` 移除该会话在每份租约中的份额，释放变空的租约，先唤醒读者再唤醒队首写者。每个等待者把中止监听、期限与队列位置合并为一个只结算一次的 `PendingWait`。每份租约的 TTL 计时器在释放时清除，因此到期的租约一定是仍存活的那份；`onExpire` 让插件记录 `file-lock/released`。

### 一次调用穿过包装器

`tools/execute` 监听器把工具名与 `tools` 匹配，读取路径参数，经 `ctx.fs.resolve` 按会话 `cwd` 解析，并沿 `ctx.agents.isOwnedBy` 走到根来推导调用方的家族。写入会获取租约（遇外部租约则排队），并在该会话本轮首次取得该键时记录 `file-lock/acquired`。被外部租约挡住的读取记录 `file-lock/waiting`、等待 `readWaitMs`，超时后要么通过 `ctx.userQuestions` 提问——在同一个 `AbortController` 下让问题与无上限的 `awaitRelease` 竞速，落败方被撤回——要么应用 `delegatedReadTimeout`。两条路径都以带结果与等待时长的 `file-lock/settled` 结束，恢复的读取会以 `additionalContexts` 携带一条 `notice` 形式的插件消息。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config`、设置节、`tools/execute` 包装器、turn 结束与销毁时的释放 |
| [`src/registry.ts`](src/registry.ts) | `FileLockRegistry`：租约、写者与读者队列、TTL、销毁 |
| [`src/projection.ts`](src/projection.ts) | `fileLocks` 投影定义 |
| [`src/types.ts`](src/types.ts) | 与客户端共享的设置、事件载荷与投影状态 |
| — | 不发布运行时不变量伴随包；注册表是租约状态的唯一所有者，投影是已记录事件的纯折叠，不存在可能分歧的两个观察。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当包级契约不够用时阅读这些页面。它们从工具调用流水线走向提问 seam、投影注册表与 guard 组地图。

- [工具子系统参考](../../../docs/subsystems/tools.zh.md)——本包装器挂接的 `tools/execute` waterfall。
- [`dsh-user-questions`](../../interaction/user-questions/README.zh.md)——停滞读取用来提问的应答方 waterfall，以及受委托调用方为何不能提问。
- [`dsh-session-projection`](../../session/session-projection/README.zh.md)——`fileLocks` 投影如何折叠、缓存与提供。
- [资源治理 Agent Note](../../../.agents/notes/proposed/feature/2026-09-10-cross-session-file-lock.zh.md)——决策记录：按 turn 计的租约、读取的三个阶段、延后的面板工作。
- [guard 组地图](../README.zh.md)——同组的 guard 包。

-----

<a id="model-experience"></a>
## 模型体验

### 条件性的工具结果

#### 模型看到什么

本插件不添加提示词或 schema，未被争用的调用原样通过。被拒绝的写入会把工具结果替换为 `Error: file lock: "<path>" is being modified by <holder> since <ISO time>; waited <n>s. Wait for that session to finish its turn, or work on a different file.`，其中 `<holder>` 为 `session "<title>"` 或 `session <id>`，持有者有工作区时再跟 ` (workspace <cwd>)`。等待过的读取会在结果后追加一条 `notice` 消息，形式为下面两者之一：

##### 释放后读取通知的原文

```markdown
[file-lock] waited <n>s until <holder> finished modifying "<path>"; the content you read is the released version.
```

##### 立即读取通知的原文

```markdown
[file-lock] "<path>" is being modified by <holder> right now; the content you read may be incomplete or change again.
```

#### Token 影响

未争用的调用零 token。一次拒绝把工具自身的结果替换为一条简短错误；等待过的读取在未改变的结果旁增加一条保留的通知消息。

#### KV Cache 影响

仅追加；拒绝与通知都跟在可复用的请求前缀之后，不会使已有的 KV-cache 条目失效。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了本策略不适用的场景。它们是当前的包约束，不是任务清单。

- **只覆盖规则中列出的工具**——通过 `bash`、`git` 或 `tools` 中未列出的工具修改的文件既不取得租约，也不等待任何租约。
- **单进程**——租约表是进程局部的；同一台机器上的 `dsh` CLI 与 `dsh web` Host 看不到彼此的租约。
- **订阅中的读取会阻塞其 turn**——`Keep waiting` 与 `wait` 策略按设计没有上限；取消 turn 是唯一出口。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：尚未决定的开放问题与方向。它明确不具权威性——已交付的行为、限制与已接受的理由位于上文各节、包代码与链接的 Agent Notes 中。

跨同一仓库多个 git worktree 合并租约（`mergeWorktreePaths`）与面向多个 `dsh` 进程的文件后端租约表都尚未决定；二者都没有当前的消费者。

</details>
