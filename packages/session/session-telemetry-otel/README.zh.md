# @deepseek-ai/dsh-session-telemetry-otel

[English](README.md) | 中文

[遥测（telemetry）seam](../session-telemetry/) 的 OpenTelemetry 后端，也是部署方唯一要加载的条目。其 `mode` 决定 seam 是实时跟随会话事件、仅在记录反馈时回放权威日志，还是将遥测留在本地。上传模式会原样组合 OTel JS SDK（`LoggerProvider` → `BatchLogRecordProcessor` → OTLP/HTTP 日志导出器），把每条已交接记录映射到 `logger.emit()`，并使用两个插桩作用域（instrumentation scope）：ledger 记录挂在 `@deepseek-ai/dsh-session-telemetry-otel` 下，运维记录挂在 `@deepseek-ai/dsh-session-telemetry-otel/ops` 下。资源身份始终包含来自 `dsh-llm` 的 `APP_IDENTITY` 所提供的 `service.name`/`service.version`；持久的 Harness home 匿名 `user.id` 是独立且默认关闭的 opt-in。

## 配置

```yaml
- id: session-telemetry-otel
  name: '@deepseek-ai/dsh-session-telemetry-otel'
  config:
    mode: FULL
    captureContent: false
    includeAnonymousUserId: false
    shutdownTimeoutMillis: 3000
    exporter:
      url: https://collector.example.com/v1/logs
      headers:
        authorization: !!js `Bearer ${process.env.OTLP_TOKEN}`
    processor: {}            # optional; passed verbatim to BatchLogRecordProcessor
```

| `mode` | 行为 |
|---|---|
| `FULL` | 每条已投影记录都立即交给 OTel SDK，包括生命周期运维记录。 |
| `FEEDBACK_ONLY` | 每个 `feedback/record` 都会回放权威会话日志中截至该事件的后缀，并进行投影与脱敏。后续记录等待下一个反馈事件；如果没有后续反馈，则留在本地。 |
| `DISABLED` | 默认值。不构造协调器、提供方、处理器或导出器。没有遥测记录会离开进程。`feedback/record` 会记录 `session sessionTelemetry is DISABLED; nothing will be shared and this feedback remains local`；该事件留在本地会话日志中。 |

程序化 TypeScript 配置使用导出的 `SessionTelemetryMode` 枚举（`SessionTelemetryMode.FULL`、`SessionTelemetryMode.FEEDBACK_ONLY` 或 `SessionTelemetryMode.DISABLED`）；原始字符串字面量不可赋值。序列化后的 Cordis 配置继续使用上表所示的字符串值。

`captureContent` 的默认值为 `false`，并且独立于上传模式。只有 collector 边界获准接收原始提示词、工具 payload 与本地工件时，才将其设为 `true`。`includeAnonymousUserId` 的默认值也是 `false`；启用后会把 `$DSH_HOME/.anonymous-user-id`（首次使用时创建的随机 UUID；删除该文件可重置）作为 OTel Resource 随每个导出批次携带一次。两个 opt-in 都不会改变默认的 `DISABLED` 模式。

上传授权采用显式许可，且为 fail-closed。通过直接构造传入未知模式时，会在读取传输配置前失败。只有 `FULL` 接受对 `ctx.sessionTelemetry.emit()` 的直接调用。`FEEDBACK_ONLY` 向其按需协调器提供私有后端能力，并且仅在 `feedback/record` 对象已经存储于 `session.events[event.seq]` 且对象身份完全相同时，才将其视为同意；独立发出的总线值会被忽略。即使存在导出器选项，`DISABLED` 也绝不会构造 SDK 流水线。

已挂载的服务通过 seam 的 [`SessionTelemetrySharingStatus`](../session-telemetry/README.zh.md#the-sharing-disclosure) `sharing` 属性披露解析后的模式（`full` / `feedback-only` / `disabled`），因此 `/feedback` 的确认文本可以报告会话是否以及如何被共享。该披露在构造函数中设置，与采集相互独立：即使 `DISABLED` 也会披露 `disabled`。

`exporter.url` 在 `FULL` 与 `FEEDBACK_ONLY` 中必填，无默认值，且必须能解析为 `http(s)`；在 `DISABLED` 中可省略且不使用。在上传模式中，`shutdownTimeoutMillis` 是由 DSH 管理的有限正数外层截止时间，默认值为 3000 ms；`processor.maxExportBatchSize` 不是正整数时也会在插件加载时失败，因为 SDK 会接受该值，随后却在关闭时挂起。两个 SDK 配置块都整体透传（passthrough）：`OTLPExporterNodeConfigBase` 的每个字段（`headers`、`timeoutMillis`、`compression`、`keepAlive` 等）都会到达导出器；批处理、导出节奏（`scheduledDelayMillis`）、重试、队列上限，以及持续失败下的丢失策略，都是通过 `processor` 调节的 SDK 行为。该后端不实现 `flush()`：常规 flush 由批处理器负责。关闭期间，OTel 会先等待 `exporter.forceFlush()`，再等待受处理器 `exportTimeoutMillis` 限制的完成 promise；如果该传输 promise 始终不结算，本包会在 `shutdownTimeoutMillis` 到期时放弃等待，通过协调器记录已隔离的关闭失败，并让应用继续拆卸。该截止时间无法取消 SDK 传输，因此届时仍待处理的记录可能在进程退出时丢失。

## 哪些数据会离开本机

使用默认的 `captureContent: false` 时，上传模式会在 seam 的 `session-telemetry/record` waterfall（瀑布式事件）之后应用封闭的结构化 allowlist。记录会保留关联与生命周期元数据（`session.id`、谱系、事件类型与 seq、turn/step）、时长与 token 数、提供方/模型与工具名称、重试等待、结果/错误分类，以及原始 body 的字节数。记录会移除不透明的工具调用 id、`session.cwd`、提示词与消息文本、系统提示词与工具 schema、工具参数与结果（包括命令输出和文件内容）、todo 文本、压缩（compaction）摘要、钩子输出、反馈文本、错误消息与未知 attribute。没有显式元数据投影的事件类型只导出 body 字节数，因此新增事件类型不会意外开始导出内容。系统也不会导出内容哈希。

保留的字符串元数据必须符合操作标识符形态：不超过 128 个字符，且只包含字母、数字、`_`、`.`、`:`、`/` 与 `-`。这会拒绝形似自然语言或含控制字符的 payload，但 session id、提供方/模型路由与工具名称等标识符仍可能暴露部署拓扑或租户命名。如果连这类元数据也敏感，应保持 telemetry 为 `DISABLED`；`metadata-only` 表示原始内容字段在结构上被排除，不表示保留的标识符已经匿名化。

使用 `captureContent: true` 时，后端会把 waterfall 结果作为结构化 body 与 attribute 导出。内容可能包含前述所有类别，以及被复制到提示词、工具参数/结果、文件、命令输出、反馈消息或错误消息中的任何 secret。因此，该模式要求 collector 边界已获批准，或部署方已挂载 waterfall 策略（见 [seam README](../session-telemetry/README.zh.md#the-redact-waterfall)）。`FULL` 在追加时运行 waterfall；`FEEDBACK_ONLY` 不保留遥测副本，而是在反馈触发权威日志回放时运行当时挂载的规则。适配器 API key 只要仍位于构造配置中，就在结构上不属于会话事件；但是，原始内容模式无法保护被重复写入事件内容的凭据。`DISABLED` 不构造 SDK 流水线，也不向后端交付任何捕获。

## 字段映射

准备后的 seam 记录 → SDK 日志记录：`time` → `timestamp`/`observedTimestamp`；`severity` → `severityNumber`/`severityText`（INFO 9 / WARN 13 / ERROR 17）；准备后的 `body` → 结构化日志 body；准备后的 `attributes` → 日志 attribute。每条记录都带有 `dsh.telemetry.content_mode`（`metadata-only` 或 `full`）；metadata-only 记录还带有 `dsh.telemetry.body_bytes`。接收端基于 `(session.id, event.seq)` 去重，并按严重级别告警。在 `FULL` 中，接收端还可通过缺少 `shutdown` 记录检测崩溃：该标记在会话自身 dispose（资源释放）或应用关闭时发出；标记之后出现更多事件，说明遥测发生了重载。在 `FEEDBACK_ONLY` 中，已释放的前缀通常不包含随后的 `shutdown` 标记，因此缺少该标记不是崩溃信号。跨谱系（lineage）的流并不自足：恢复的会话在其自身 id 的流上从上一个进程停止之处继续；fork 出的会话的流从继承边界开始，其前缀位于父会话的流中，由接收端基于 `session.parent_id` + `session.seed_length` 拼接。恢复后的本地日志可能包含从未导出的合成关闭事件；协议流忠实于实际交给 SDK 的记录。

## 模型体验

无。该后端只把 seam 脱敏后的记录转发进 OTel SDK 流水线；它绝不向模型请求贡献任何内容。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **上游实验性源码树**：`@opentelemetry/sdk-logs` 仍从上游实验性（experimental）源码树发布；SDK API 的变动只会落在本包，也仅落在本包；seam 约定不动。
- **真实 collector 行为属于 SDK 导出器**：身份验证、TLS、限流及其他真实 OTLP 部署行为遵循上游 SDK，不由本包自有兼容层处理。
- **反馈时快照**：`FEEDBACK_ONLY` 在反馈前不保留遥测自有副本。记录反馈时，它读取并脱敏当前的权威日志；反馈前发生崩溃时什么都不上传，而反馈前的策略变更会影响该次回放的导出内容。
- **Allowlist 延迟会有意保持不透明**：新增事件类型仍可按 identity 与 body 大小观测，但在本后端增加并测试显式元数据投影之前，不会暴露事件专有字段。
- **第一方不做内容采样**：后端仅支持 metadata-only 导出或显式的完整内容导出。选择性内容采样仍由部署方 waterfall 决定，本包不会通过启发式规则推断。
