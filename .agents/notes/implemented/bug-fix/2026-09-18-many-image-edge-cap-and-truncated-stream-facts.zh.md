# Agent Note：限制请求图片单边并指出截断流背后的响应

Status: implemented

[English](2026-09-18-many-image-edge-cap-and-truncated-stream-facts.md) | 中文

## 问题

Anthropic 接受单边最多 8000 像素的图片，但一次请求携带超过 20 张图片后，每张图片都必须落在 2000×2000 像素内（[视觉限制](https://platform.claude.com/docs/en/build-with-claude/vision)）。pi-ai 路由只按 2048×2048 的总像素预算缩放内联请求图片，因此一张 2374×1698 的截图（4.03 MP）原样发出。图片在会话中只增不减并随每次请求重发，所以第 21 张图片之后的第一次请求被拒绝，错误为 `At least one of the image dimensions exceed max allowed size for many-image requests: 2000 pixels`，此后该路由上的每次请求都以同样方式被拒绝：压缩只遮蔽文本而不移除图片，切换到没有这条规则的提供方是唯一的恢复手段。

这个拒绝是不可见的。用户的网关把上游 4xx 包装成 HTTP 200 加空体或裸 JSON 体返回；pi-ai 通过 SDK 读取响应体，既没有看到协议事件也没有看到 `event: error` 行，于是丢弃响应并报告 `Anthropic stream ended without a stop reason`。`dsh-llm-pi-ai` 把这段文本归类为 `TRANSPORT`，重试层因此每轮把同一个请求重发五次；十天内的会话日志记录了 194 次这样的失败，没有任何状态码、媒体类型或响应体可以解释它们。

第二个分类缺口在 OpenAI 路由上叠加了影响：流内 `error` 事件到达 pi-ai 时是一个没有状态码、只带提供方句子（`Our servers are currently overloaded. Please try again later.`）的 SDK 错误，它不匹配任何模式而成为不可重试的 `PI_AI_ERROR`；64 轮在第一次这样的事件上直接结束，没有重试。

## 决定

[`requestImageDimensions`](../../../../packages/attachment/attachment/src/request-projection.ts) 在总像素预算之外接受可选的单边上限并返回同时满足两者的尺寸；上限按精确整数施加，因为用 `cap / edge` 缩放长边会因浮点舍入少一个像素。[`ImageRequestPolicy`](../../../../packages/attachment/attachment/src/types.ts) 以 `maxDimension` 携带它；[`readRequestImageFile`](../../../../packages/attachment/attachment-local/src/request-image.ts) 校验它、仅在存在时把它计入变体身份以便既有缓存版本保留原 id，并在其下投影。pi-ai 配置把它暴露为 `requestImageMaxDimension`，默认 2000，因此默认路由满足 Anthropic 的多图规则，部署可以把它降到 Anthropic 推荐的 1568 像素边长，或为没有这条规则的提供方调高。规范化保留自己的长边上限（8192），因为它约束的是存储的附件而不是路由。

[`createResponseProbe`](../../../../packages/llm/llm-pi-ai/src/response-probe.ts) 为一次请求包装交给 pi-ai 的 `fetch`，通过一个透传 `TransformStream` 记录响应状态、`content-type`、字节数和响应体前 `responseProbeHeadBytes`（默认 512）字节，并在调用时解析全局 `fetch`，使进程级代理分发器仍然生效。`annotateTruncatedFinish` 把失败文本为 pi-ai 截断措辞（`stream ended before|without …`）的 finish 改写为指出这些事实并设置 `failure.status`。当响应体开头是裸 JSON 对象时，它就是提供方自己的错误，`classifyPiAiError` 据其文字重新路由失败，所以网关包装的 `"status":400` 变为 `INVALID_REQUEST` 且不再重试；SSE 开头保留传输代码，因为协议事件同样包含数字。

`classifyPiAiError` 把 `overloaded`、`overloaded_error`、`api_error` 和 `internal server error` 路由到默认重试策略会重试的 `SERVER`，把 `authentication_error` 或 `permission_error` 路由到 `AUTH`。文本中的 HTTP 状态码仍然优先：`OpenAI API error (400): {"message":"Internal server error"}` 保持 `INVALID_REQUEST`，因为网关声明了请求无效。

## 曾考虑的替代方案

**降低像素预算直到没有任何边能超过 2000。** 拒绝：预算约束的是面积而不是边长；8000×400 落在 2048² 内仍会失败，而把预算压到足够小会让每个提供方的普通截图都劣化。

**请求超过 20 张图片时丢弃最旧的图片。** 拒绝：路由已经按字节预算卸载图片，而模型无论如何都会失去这些图片；缩放让每张图片保持可见，并且在 Anthropic 上没有代价，它本来就会对超过 1568 像素的图片降采样。

**修改 pi-ai 使其报告响应。** 推迟：pi-ai 在适配器看到之前就把捕获的错误压平为消息，SDK 拥有的响应无法从事件流触及；`fetch` 选项是 pi-ai 提供的唯一接缝，探针让适配器除了分类已经依赖的截断正则之外不依赖 pi-ai 的内部措辞。

**把每个截断流都视为 `INVALID_REQUEST`。** 拒绝：真正的响应中途套接字断开是瞬时的并且必须重试；只有裸错误体才能证明提供方拒绝了请求。

## 影响

pi-ai Anthropic 路由上图片密集的会话在超过 20 张图片后仍能完成请求。截断流失败会指出响应（`… (upstream response: HTTP 200 text/event-stream, empty body)`）、携带 `status`，并在网关包含上游错误时据其分类且不再重试。无状态码的过载事件按提供方策略重试。每次 pi-ai 请求在 SDK 读取之外最多额外持有 `responseProbeHeadBytes` 字节的响应体。[投影](../../../../packages/attachment/attachment/tests/request-projection.spec.ts)、[请求图片](../../../../packages/attachment/attachment-local/tests/request-image.spec.ts)、[探针](../../../../packages/llm/llm-pi-ai/tests/response-probe.spec.ts)、[适配器](../../../../packages/llm/llm-pi-ai/tests/adapter.spec.ts)和[分类](../../../../packages/llm/llm-pi-ai/tests/convert.spec.ts)规格固定了单边上限、无上限时不变的变体 id、经本地 HTTP 服务器验证的空体与裸 JSON 注解，以及新的失败代码。
