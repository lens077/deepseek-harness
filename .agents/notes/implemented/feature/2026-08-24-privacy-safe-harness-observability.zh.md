# Agent Note：默认保护隐私的本地 Harness 可观测性

Status: implemented

[English](2026-08-24-privacy-safe-harness-observability.md) | 中文

## 问题

权威会话日志已经记录会话谱系、turn/step 边界、模型 chunk 与已组装消息、工具调用/结果、用量、重试、错误、取消和崩溃修复。但在规模化场景中，运维人员仍需手工重建几个基础问题：完整 turn 与 step 延迟、提供方重试次数与等待时间、未配对/错误的工具结果，以及各类 turn 结束结果的分布。Web 统计条展示了模型/工具耗时和 TTFT，却没有展示这些可靠性信号。

随附的遥测服务默认禁用，但启用参考 OTel 后端后，waterfall 的原始输出会直接交给 SDK。除非每个部署自行编写规则集，否则提示词、系统/工具 schema、工具 payload、文件与命令输出、反馈、错误文本和 `cwd` 都可能越过 exporter 边界。上传模式还会无条件附带持久匿名 `user.id`。因此，安全默认值依赖部署经验，而不是由随附的后端边界保证。

## 决策

1. 扩展 `sessionStats` projection，新增完整 `turnMs`/`stepMs`、工具调用/结果/错误计数、模型重试次数与计划等待时间，以及每种核心 `turn/end` 原因的独立计数器。这些字段是对 append-only 日志的标量、无内容折叠。Web 统计条展示总 turn 耗时与非零的重试/失败/中断信号；分页和压缩不会改变这些数字。
2. 让参考 OTel 后端默认使用 metadata-only，并与投递模式相互独立。封闭的结构化 allowlist 保留符合标识符形态的关联字段、谱系、生命周期坐标、耗时、token 用量、提供方/模型/工具身份、重试等待，以及结果/错误分类；同时移除不透明的工具调用 id、`cwd` 与所有承载内容的 payload。未知事件 body 只保留序列化字节数，并且不导出内容哈希。保留的标识符受语法约束，但不会被描述为匿名化；若部署拓扑或租户命名也敏感，应保持 telemetry 关闭。
3. 要求两个相互独立的显式 opt-in：`captureContent: true` 用于原始 body，`includeAnonymousUserId: true` 用于持久的 Harness home Resource 身份。base bundle 只有在环境变量精确等于 `true` 时才启用对应选项；`mode` 仍默认为 `DISABLED`。
4. 持久会话事件继续保持提供方中立。分层的 session/turn/step/model-attempt/tool Span 转换、不稳定的 OTel GenAI 语义约定名称、金额成本计算，以及 exporter 队列/丢弃健康度都留作独立增量。本地诊断必须在没有 collector 或云凭据时可用。

共享的 `session-telemetry/record` waterfall 继续保持透传机制。隐私下限属于随附的 exporter 边界，并位于部署规则之后；因此，自定义后端仍保留 seam 约定，更严格的部署规则也不会被削弱。这不是重新引入启发式 secret 匹配：策略有明确命名，采用正向结构选择，并对未知事件类型 fail-closed。

## 考虑过的替代方案

**在共享 waterfall 中增加基于 pattern 的 secret 擦除。** 否决。Pattern 覆盖会制造虚假信心，仍会遗漏任意内容，并可能因误报破坏值。结构化 metadata allowlist 的字段集合可评审，也能在不猜测的前提下保证新增事件类型安全。

**继续导出原始记录，只保留默认禁用遥测。** 否决。默认禁用只保护从不启用可观测性的部署；它没有为真正需要可观测性的部署提供安全路径。

**在同一增量中实现分层 OTel Span。** 推迟。正确的 attempt Span 需要理解重试的 parentage、中断修复规则，以及明确的语义约定版本边界。本地 projection 与隐私下限不依赖该映射，且已解决当前的诊断与数据边界问题。

**只按 token 用量估算金额成本。** 推迟。可信值需要提供方/模型价格表、cache read/write 处理、币种、生效日期/版本，以及缺失价格策略。带有虚假精度的成本数字不如现有的精确 token bucket。

## 后果

新建或恢复的本地会话现在会通过现有 projection 载体与 Web 统计条暴露完整生命周期和可靠性聚合，不需要新增服务、账号或凭据。OTel 上传仍使用 SDK 的尽力而为队列与传输语义；metadata-only 模式限制内容暴露，但不会让投递具备持久性。运维人员无需读取提示词或工具输出，即可区分工作计数、完整生命周期耗时、模型完成耗时、重试等待、工具失败和 turn 终止原因。

原始内容导出与稳定的跨进程用户关联现在都是明确的例外配置。未来新增事件类型在 OTel 后端增加 allowlist 分支和测试之前，不会提供事件专有元数据；这期间仍可看到事件身份与 body 大小。成本归因、分层 trace 和队列/丢弃插桩被明确记录为延后事项，而不是由新计数器暗示已经具备。

## 验证

受控时间戳 projection 测试覆盖生命周期耗时、重试等待、工具结果、所有 turn 结束类型、负时钟偏移、畸形或重复的生命周期记录、由 provider 生成的原型属性名，以及崩溃式孤立结果；客户端测试覆盖全会话 Web 展示与 fixture 对齐；纯隐私测试包含 fixture secret、自然语言形态的标识符、不透明的调用 id 与未知事件类型；真实 OTel SDK/HTTP collector 测试覆盖默认不含内容和显式内容/身份 opt-in；base bundle 解析测试固定环境变量必须精确等于 `true`。仓库 typecheck、lint、constraints、doc-sync、定向测试和 Web 工件构建仍是发布门禁。
