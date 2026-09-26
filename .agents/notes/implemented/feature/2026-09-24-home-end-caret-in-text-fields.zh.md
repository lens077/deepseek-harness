# Agent Note：Home/End 在 composer 与其它文本输入框中移动光标

Status: implemented

[English](2026-09-24-home-end-caret-in-text-fields.md) | 中文

## Problem

macOS 把 Home 与 End 绑定为 `scrollToBeginningOfDocument:` / `scrollToEndOfDocument:`，而 Chrome 与 Safari 即使在文本框或 `contenteditable` 聚焦时也沿用该绑定。用户在 composer 里输入时按下 Home，看到的是转录区跳到最早的提问，而不是光标移到行首。GUI 本身没有绑定这两个键；这完全是浏览器默认行为。

## Decision

composer 收下 Home 与 End 用于移动光标。Home 移到光标所在行的行首，End 移到行尾；按住 Ctrl 或 Meta 则扩展到整份草稿；Shift 从选区的固定端扩展，因此向左的选区保持向左。Alt 组合不受影响，因为 Alt+Home 属于工作区固定项快捷键。绑定到 Home 或 End 的发送快捷键仍然发送：用户配置的手势优先，移动光标只是兜底。

移动量由 EditorState 计算，而不是由 DOM 计算。[`caret-motion.ts`](../../../../packages/client/ui-conversation/src/client/input/editor/caret-motion.ts) 通过既有的 composer 投影把选区折算为 detect 偏移，在其中取行边界，再经保留方向的 `$selectDetectPoints` 应用结果。Lexical 的 `RangeSelection.modify` 是显而易见的替代方案，其被否决的理由见下。

“行”指逻辑行，即换行符之间的文本，因此软换行的段落算一行。折行几何只存在于渲染盒中，而 composer 自身的文本足够短，真正有用的是移到该行的实际两端。引用芯片在 detect 坐标中占一个位置，因此行边界绝不会落在芯片内部。

GUI 中其它 `<input>` 与 `<textarea>` 由同一个文档级监听器提供相同手势，并受 Host 持久化的 `ui-conversation.homeEndInTextFields` 设置管辖（默认 `true`，可在设置 > 通用中选择）。监听器运行在冒泡阶段，遇到已被处理的按键即返回，因此 composer keymap、digest 面板与快捷键录制器都保留自己占用的按键。焦点不在文本框时仍由浏览器滚动，而这正是 Home 与 End 在阅读长转录时的用处。

监听器覆盖公开文本选区的 input 类型（`text`、`search`、`url`、`tel`、`password`）和全部 textarea，并跳过只读与禁用的字段。`email`、`number` 与日期系列返回空选区并拒绝 `setSelectionRange`，因此交给浏览器。

## Alternatives considered

**调用 `RangeSelection.modify(alter, isBackward, 'lineboundary')`。** 否决：它委托给非标准的 `Selection.modify`，jsdom 并未实现，因此只能对 mock 而非编辑器断言行为，逐文件覆盖率门禁只会被一个虚构满足。基于模型的计算可以通过 composer 其余部分使用的同一投影来测试。

**让 composer 的行为也可配置。** 否决：它替换掉的平台绑定对任何正在输入的人都是缺陷，而不是偏好。该设置存在，是为了 conversation 插件并不拥有的那些输入框，在那里用户可能更想要浏览器默认行为。

**让 Home 移到整份草稿的开头。** 否决：这个 composer 中多行草稿很常见，无法定位单行的手势会迫使用户用方向键挪动。Ctrl/Cmd 保留了整份草稿的到达能力。

**由 shell 包而不是 `ui-conversation` 安装监听器。** 暂时否决：conversation 插件已经拥有 GUI 的文本输入键盘偏好（发送快捷键、繁忙 Enter、提问导航触发范围），再加一个所有者会把同一份键盘策略拆到两个包里。未来若出现应用外壳的键盘所有者，应当把两者一并接管。

## Consequences

无论在 macOS 还是其它平台，文本框聚焦时 Home 与 End 不再滚动转录区。依赖输入时滚动的用户可以把 `homeEndInTextFields` 设为 `false` 以恢复周边输入框的浏览器行为；composer 两种设置下都保持移动光标。

持久化的 `ui-conversation` 段新增一个布尔字段。它默认为 `true`，因此既有设置文档在读取时直接采用新行为，无需迁移。

[Home/End 测试](../../../../packages/client/ui-conversation/tests/home-end-caret.client.spec.tsx) 拥有行边界、EditorState 移动、keymap 手势、文档监听器、偏好策略与设置行。
