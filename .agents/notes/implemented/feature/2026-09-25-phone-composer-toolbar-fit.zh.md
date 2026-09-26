# Agent Note：手机 composer 工具栏容纳全部控件

Status: implemented

[English](2026-09-25-phone-composer-toolbar-fit.md) | 中文

## Problem

手机 composer 工具栏把所有控件保持在一行且不换行（[手机紧凑布局 note](2026-09-20-mobile-compact-and-pure-ui.zh.md)）。之后插件芯片陆续加入尾侧组：模型路由开关、图片模型芯片、上下文用量环和发送手势芯片。这些芯片的标签不会收缩，而尾侧组用 `justify-content: flex-end` 靠右排列，溢出部分因此向左延伸，右侧芯片画在指令、附件和权限按钮之上。模型名只剩一两个字符。

## Decision

手机工具栏的芯片只显示图标，模型名是唯一的文字标签。权限芯片去掉标签和下拉箭头，由图标占满 36px 触控方块。路由芯片和图片模型芯片在权限芯片已有的 composer 行 460px 容器断点处去掉标签，因此窄的桌面面板也以同样方式收起。未配置的图片模型芯片在手机上隐藏，因为它的说明只存在于悬停提示中。发送手势芯片在手机上隐藏。同一选项仍在设置中，手机用按钮发送。

放得下时工具栏保持一行，放不下时换行，而不是溢出。手机上模型芯片为 `width: 0`，`min-width` 为 64px，因此尾侧组的固有宽度是固定控件加上这一下限，而不是完整模型名。只有左侧组与该下限无法同处一行时才换行，此时尾侧组独占完整的第二行。在显示路由开关、上下文用量环和停止按钮时，360px 和 390px 屏幕保持一行，320px 屏幕换行。

## Alternatives considered

**把芯片放进一条横向滚动栏。** 否决：权限菜单和繁忙 Enter 菜单在工具栏内部定位，横向滚动容器会在纵向裁剪它们。让每个芯片菜单都经 portal 渲染，会为了手机布局改变桌面行为。

**保持不换行并使用 `justify-content: safe flex-end`。** 否决：safe 对齐把溢出移到末端，发送按钮会被推出卡片边缘，重叠问题并未解决。

**把次要控件移入溢出菜单。** 否决：slot 贡献自行渲染控件，移入菜单需要为菜单行新增 slot 约定。只显示图标的芯片和换行兜底只需要 CSS。

## Consequences

这项变更只影响呈现；不新增 Session 事件、模型可见输入、设置项或 slot。手机用户在设置中更改发送手势。换行兜底也让将来插件再加芯片时工具栏仍然可用。

## Verification

在本地用 Playwright 截取所服务 GUI 在 320px、360px、390px 和 1280px 下的画面：360px 和 390px 保持一行且无重叠，320px 干净地换成两行，桌面工具栏不变。ui-conversation 的 input-bar 和 skeleton 测试，以及 ui-model-selection、ui-model-routing 和 ui-image-gen 测试通过。
