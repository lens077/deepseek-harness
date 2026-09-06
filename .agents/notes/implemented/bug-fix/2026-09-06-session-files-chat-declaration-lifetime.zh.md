# Agent Note: 会话文件控件跟随 Chat 声明生命周期

Status: implemented

[English](2026-09-06-session-files-chat-declaration-lifetime.md) | 中文

## 问题

会话文件按钮与文件栏消费 Chat hook，但它们所占据的对话 shell slot 可以在没有 Chat 时存在。仅依赖 shell slot 注册这些消费者，会让不含 `ui-chat` 的组合挂载缺少必需 hook 的组件。

## 决策

[会话文件插件](../../../../packages/client/ui-session-files/README.zh.md)将按钮与文件栏的注册嵌套在 `conversation.chat.node` 声明生命周期内。既有文件可见性偏好仍在该生命周期内控制两处注册。移除 Chat 会移除两个消费者；恢复 Chat 后，两者可以再次注册。它们的必需 hook 类型保持不变。

## 考虑过的替代方案

**Chat 缺失时提供虚假的 Chat hook。** 否决，因为回退数据会掩盖缺失的注册，也不会将消费者绑定到提供方的生命周期。可选功能不可用时，其 UI 座位应保持空置。

## 影响

对话 shell 可以在没有 Chat 时完成组合，而不挂载依赖 Chat 的文件控件。此规则改变注册可用性，不改变文件推导、持久化文件偏好或 Session 数据。既有[文件面板决策](../feature/2026-08-26-web-session-file-panel.zh.md)继续负责这些行为。

## 验证

包级回归测试覆盖 Chat 缺失、存在、再次缺失的过程，检查按钮与文件栏是否跟随声明生命周期，且不放宽其 hook 要求。
