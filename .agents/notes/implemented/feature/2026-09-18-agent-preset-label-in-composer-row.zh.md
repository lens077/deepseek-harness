# Agent Note: agent preset 标签移入 composer 工具行

Status: implemented

[English](2026-09-18-agent-preset-label-in-composer-row.md) | 中文

> 修订 [按会话的 agent preset](../architecture/2026-08-03-per-session-agent-presets.zh.md) 中的一处位置：说明运行中会话在跑什么的那个只读标签。该记录的各项决策——暂存式的新建会话 chip、写入日志的 preset id、宿主拒绝切换已开始的会话——均不改变，只有标签所在的位置不同。

## Problem

只读 preset 标签原本位于会话标题栏，紧跟标题之后的 `conversation.session.header.actions` 带。这个座位带来两项代价。标题自身的规则把它限制在 220px，所以超过约十四个汉字的标题即使在宽窗口下也会被省略，而旁边的带里只有一枚 chip 和空白。此外，标题栏聚集的是会话的**导航**事实——谱系、标签页、会话日志——而 preset 是**运行**事实，与已经显示在 composer 工具行的访问模式和模型同类。

## Decision

**标签注册进 `conversation.input.right`**，即 composer 工具行的尾部分组，`order: -10` 使其领先于该组：preset、模型、发送依次排列。它的尺寸与旁边的模型触发器一致（28px chip，13/20 中等字重次级色，在该行的 inline-size 容器下 `max-width: min(360px, 45cqw)`），使整行读起来是同一条带；它仍是静态装饰：没有按钮、没有菜单、`title` 提示与此前相同。

**会话为空时标签隐藏。** composer 在新建会话界面上同样处于挂载状态，而那里的 hero chip 已经写明暂存的 preset，也是唯一可以修改它的地方；工具行里再来一份，会被读成一个并非控件的控件。标签从携带 preset 的同一份会话摘要读取 `blank`，两项事实不会错位。

**当前标题占用标题栏现有的宽度。** 祖先面包屑保留 220px 上限，深层谱系不会挤掉当前段；`.crumbCurrent` 设为 `max-width: none`，祖先段设为 `flex: none`，于是当前标题按全文伸展，只有在整行比全文还窄时才省略。没有任何 JavaScript 参与测量。

## Alternatives considered

- **把标题上限改成一个更大的常量。** 任何常量在某个窗口宽度下都是错的；上面的 flex 规则是无常量版本，只花三条声明。
- **标签留在标题栏并缩小。** 标题栏仍在为一个运行事实花费宽度，标题仍要与它竞争。
- **空会话上也显示标签。** chip 与标签会并排写出同一个 preset，一个是控件，一个不是。

## Verification

- `packages/client/ui-agent-preset` 的测试：apply 测试在 `conversation.input.right` 下注册并销毁该条目；组件测试覆盖空会话隐藏，以及随之而来的不读名单。
- `apps/web/tests/agent-preset-selection.e2e.ts`：标题栏 golden 不再包含 preset；新增 `composer.expected.md` golden 捕获尾部分组，标签位于模型选择器与发送按钮之前，并断言它不是按钮。
- 在本检出临时启动的 `dsh web` 上驱动验证：34 字的标题在 760px 下完整显示，600px 下省略；空会话 hero 只显示 chip。

## Consequences

- 任何注册进 `conversation.session.header.actions` 且预期排在 preset 之后的条目（今天是 jobs 操作）现在领先于该带。
- composer 尾部分组多了一个宽度随行伸缩的占位者；用户自定义的长 preset 名称在自己的 chip 内省略，不会推挤模型触发器。
