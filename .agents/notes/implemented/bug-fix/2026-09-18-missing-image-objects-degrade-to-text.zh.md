# Agent Note: 缺失的图片对象降级为请求文本

Status: implemented

[English](2026-09-18-missing-image-objects-degrade-to-text.md) | 中文

## Problem

会话日志按内容地址引用上传的图片；字节存放在 `DSH_HOME/attachments/v1` 下。用户重装操作系统或删除 `.dsh` 后，会话日志仍在，对象却丢失了。这类会话之后的每一轮都会在提供方适配器内部调用 `readImageRequest`，它抛出 `AttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND')` 并成为终止失败分片。即使新一轮请求不含任何图片，该会话也永远无法再运行。

## Decision

`LlmRuntime.adapterStream` 中的请求组装把对象缺失当作纯文本模型投影与文件投影之外的又一种确定性图片投影。向支持图片的路由分发前，它收集每个不同的 `ImageBlock` 引用（含嵌套工具结果），对每个引用调用已挂载的 `AttachmentStore.imageAvailable(ref, signal)`，并把缺失引用的所有出现替换为 `missingImageText(ref)`，该文本指出该附件并请用户重新附上。持久会话消息绝不改写；仍然存在的图片原样到达适配器。

`imageAvailable` 是 `AttachmentStore` 的非抽象方法。默认实现读取并校验对象，只把 `ATTACHMENT_NOT_FOUND` 映射为 `false`；损坏与存储失败仍然传播，因此该路径不会掩盖受损的存储。`LocalAttachmentStore` 用 `imageFileExists` 覆盖它，每个不同图片一次 `access()`，普通请求不产生任何读取开销。

这实现了拟议[附件读取隔离](../../proposed/bug-fix/2026-08-20-attachment-read-quarantine.zh.md)中对象缺失的部分，但不含其持久 `attachment/quarantine` 事件、损坏与读取失败类别以及经校验的恢复；该提案对这些部分仍然有效。[可重建请求](../architecture/2026-07-05-reconstructable-requests.zh.md)的限制列表记录了收窄后的 fail-loud 范围。

## Alternatives considered

**在每个适配器内捕获 `ATTACHMENT_NOT_FOUND`。** `llm-deepseek` 与 `llm-pi-ai` 都要重复该替换及其占位符文本，未来的适配器也必须记得这样做。运行时已经拥有与路由无关的图片投影。

**在失败与降级之间加一个配置开关。** 没有消费方希望会话永远无法运行；占位符对模型可见并指出恢复动作，因此没有任何东西被静默跳过。Web 图片预览与导出使用的 `readImage` 路径保持不变，仍然会失败。

**对损坏对象采用同样处理。** 摘要不匹配表示存储故障而非被删除的 home，必须保持响亮。

## Consequences

附件对象已被删除的会话可以继续；模型在每个丢失图片的位置看到 `[image unavailable: its stored copy is missing from this harness installation; "name" (sha256:…). Ask the user to attach it again if its content is needed.]`。在本地后端上，每个含图片历史的请求为每个不同图片付出一次存在性探测。生成的 Cordis API 目录与 `docs/subsystems/attachment.md` 列出了新方法。

## Verification

`packages/llm/llm/tests/service.spec.ts` 用桩附件服务驱动运行时，断言按不同引用探测、直接与嵌套替换、持久消息不变，以及所有对象都存在或未挂载附件服务时分发不变。`packages/llm/llm/tests/content.spec.ts` 固定占位符文本与保持身份的投影。`packages/attachment/attachment/tests/index.spec.ts` 覆盖默认探测的三种结果；`packages/attachment/attachment-local/tests/store.spec.ts` 覆盖存在、缺失、路径被阻塞、引用无效与已取消的探测。
