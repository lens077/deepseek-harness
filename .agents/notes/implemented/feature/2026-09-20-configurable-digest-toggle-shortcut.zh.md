# Agent Note：可配置的汇总面板开关快捷键

Status: implemented

[English](2026-09-20-configurable-digest-toggle-shortcut.md) | 中文

## 问题

侧栏汇总入口只用一个固定组合键 `Ctrl+1` 开关面板。某些平台上浏览器和窗口管理器会把 `Ctrl+数字` 用于切换标签页；已经用上[可自定义发送快捷键](2026-09-06-configurable-composer-send-shortcut.zh.md)的用户也期望键盘手势由自己决定；想把收件箱绑到一个功能键上的用户则无从表达。

## 决定

`ui-digest` 设置节新增 `toggleShortcut`，一个规范形式为 `[Ctrl+][Meta+][Alt+][Shift+]Key` 的字符串，默认 `Ctrl+1`，在 **汇总面板** 设置页的只读输入框里按下组合键即录制并立即保存。[开关快捷键库](../../../../packages/client/ui-digest/src/toggle-shortcut.ts)提供 Host 模式校验、录制器、匹配器与命令修饰键判断；[包 README](../../../../packages/client/ui-digest/README.zh.md) 负责面向用户的行为说明。

快捷键可以不含任何修饰键。这是它与发送快捷键的区别：发送快捷键住在输入框里，因此必须带 Ctrl、Meta 或 Alt；开关监听器挂在 document 上，所以单个按键或 Shift 组合也被接受，然后由面板单字母键盘环用的同一个判断在可编辑区域里保持沉默；而含 Ctrl、Meta 或 Alt 的组合键在任何位置都生效——这正是固定组合键原有的"打到一半也能打开收件箱"行为。设置页会说明当前快捷键属于哪一种。

支持的按键是字母、数字、F1–F12、方向键、Home、End、PageUp、PageDown；物理 `KeyX`/`DigitN` 编码优先于产生的字符，所以数字行被 Shift 改写的键盘布局仍能触达。录制器拒绝编辑键（Tab、Backspace、Delete、Enter、Space、Escape），以及在无 Alt 的 Ctrl 或 Meta 下属于编辑或浏览器的字母（剪贴板、撤销、全选、查找、标签页与窗口控制、文本样式切换）——一个在输入框里也会触发的组合键会劫持这些操作，而不只是遮住某个页面快捷键。Host 模式校验强制规范的修饰键顺序与按键集合；浏览器侧策略把录制器会拒绝的存储值按默认值读取，因此手改 `settings.yaml` 也无法绑上 `Ctrl+C`。

## 备选方案

**复用发送快捷键库。** 它的修饰键要求与旧预设是输入框的事实；汇总快捷键接受单键并在可编辑区域静默是 document 监听器的事实。共用意味着在两个功能插件之间导出运行时值，客户端导出规则禁止这样做。

**允许多个备选快捷键。** 没有使用方需要多于一个；单个字段让页面和 schema 都保持简单。以后可以用列表替换字符串字段，无需格式迁移。

**像发送快捷键一样要求修饰键。** 这会拒绝掉促成本次改动的单个功能键。

## 后果

没有该字段的存储文档按 `Ctrl+1` 读取；从不打开设置页的用户没有任何变化。面板的按键说明和入口的提示会显示配置的快捷键，而不是固定文案。无修饰键的快捷键在打字时不可触达，这是有意为之，页面会说明。与发送快捷键一样，操作系统或浏览器仍可能拦截一个已接受的组合键。

[开关快捷键测试](../../../../packages/client/ui-digest/tests/toggle-shortcut.client.spec.ts)负责模式、录制器与匹配器；[面板测试](../../../../packages/client/ui-digest/tests/panel.client.spec.tsx)负责入口跟随配置的快捷键与可编辑区域守卫；[设置页测试](../../../../packages/client/ui-digest/tests/digest-settings.client.spec.tsx)负责录制、拒绝与重置。
