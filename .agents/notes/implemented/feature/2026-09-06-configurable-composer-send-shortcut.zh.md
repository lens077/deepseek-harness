# Agent Note: 可配置的 composer 发送快捷键

Status: implemented

[English](2026-09-06-configurable-composer-send-shortcut.md) | 中文

## 问题

编写多行提示词的用户需要用 Enter 换行而不提交内容，也需要两种固定预设之外的发送组合键。发送按键偏好必须独立于会话运行时 Queue 与 Steer 的选择。

## 决策

Host 支持的 `ui-conversation.sendShortcut` 设置接受 `enter`、`mod-enter` 或 `Ctrl+Alt+S` 等规范形式的显式组合键。它默认为 `enter`，并在设置 > 通用中提供预设和需要显式保存的录制器。[Composer README](../../../../packages/client/ui-conversation/README.zh.md#shell-and-standard-props) 定义键盘行为与录制操作。

该偏好选择发送手势，而不是投递方式。`enter` 模式下，Enter 使用首选的繁忙态投递方式，Ctrl/Cmd+Enter 使用另一种方式。`mod-enter` 模式下，Enter 换行，Ctrl/Cmd+Enter 使用首选投递方式。显式组合键仅在完全匹配时使用首选投递方式发送，所有修饰键都必须匹配；Ctrl 与 Meta 不等价。自定义模式下的普通 Enter，以及不带其他修饰键的 Shift+Enter 用于换行。IME 输入组合期间不提交。空草稿 Ctrl/Cmd+Enter 全部插话仅限两种具名模式；自定义组合键绝不会在草稿为空时将队列全部插话发送。指针操作保持独立。

[共享快捷键校验](../../../../packages/client/ui-conversation/src/send-shortcut.ts)供 Host schema、录制器和匹配器使用。显式组合键必须包含 Ctrl、Meta 或 Alt，以及一个受支持的按键；修饰键顺序固定。校验器拒绝保留的编辑与浏览器快捷键，而不是允许录制与这些操作冲突的组合键。录制结果在保存前只是候选值；取消不会改变持久化偏好。

[Queue/Steer 决策](2026-07-30-web-queue-steer-action.zh.md) 继续定义排队行的严格 steering（中途引导）和 composer 的尽力而为投递；本偏好只选择请求该投递的键盘手势。

## 考虑过的替代方案

**将发送限制为两种固定预设。** 这无法满足因键盘或工作流程而需要其他组合键的用户。

**所有模式都让 Ctrl/Cmd+Enter 执行另一种投递方式。** 在 `mod-enter` 模式下，这会使唯一的发送手势绕过用户首选的繁忙态投递方式。

## 影响

默认值保持 Enter 发送行为，已存储的 `mod-enter` 偏好保持原有含义。其他模式没有独立的另一种投递方式发送组合键；现有 Queue 与 Steer 控件仍然可用。该偏好使用 Host 设置而非浏览器本地副本，因此共享同一设置文档的客户端共享此选择。已接受的组合键仍可能被操作系统或浏览器拦截；校验无法保证按键事件送达。

[提交策略测试](../../../../packages/client/ui-conversation/tests/submission-policy.client.spec.ts)与 [InputBar 测试](../../../../packages/client/ui-conversation/tests/input-bar.client.spec.tsx)负责快捷键匹配、投递方式选择、换行与 IME 保护，以及空草稿行为。无密钥的[设置浏览器场景](../../../../apps/web/tests/settings-chrome.e2e.ts)负责验证选择在重新加载后的持久化。
