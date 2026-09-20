# Agent Note: 悬停卡片按指针离开关闭，而不只依赖边界事件

Status: implemented

[English](2026-09-18-hover-card-departure-tracking.md) | 中文

## Problem

侧边栏会话与工作区悬停卡片（ui-primitives 中的 `HoverCard`）只在三种信号下关闭：锚点包装元素上的 React `pointerleave`、锚点内的按下、以及所有者把 `disabled` 置为 true。凡是不产生边界事件的离开都会把卡片遗留在屏幕上：指针静止时行在下方滚动或重排（Chromium 在滚动结束前不更新 hover 状态，因此滚动中触发的停留计时器会在一个无人指向的行旁打开卡片）、侧边栏在指针下方折叠、或焦点切到其他窗口。用户看到的现象是鼠标离开后卡片仍然存在。此外卡片在两种主题下都绘制固定的 `#2C2C2E` 表面与白色文字——照搬的 Figma 值——在浅色主题里就是白色侧边栏旁的一块深色板。

## Decision

`HoverCard` 跟踪指针，而不只信任边界事件：

- 包装元素从 `pointerenter` 与 `pointermove` 记录最近的指针位置。停留计时器触发时，只有该位置仍在锚点矩形内（`inRect`，含边缘）才打开卡片，因此停留期间滚走的锚点不会打开任何东西。
- 打开期间在 `document` 上挂捕获阶段的 `pointermove` 监听，检查事件 `composedPath()` 是否包含包装元素或 portal 出去的卡片：在内则取消待定的离开关闭，在外则布防一次。每次离开只布防一次（`awayRef`），因此持续在外移动不会无限推迟宽限关闭。
- 既有的捕获阶段 `scroll`/`resize` 监听同时用静止位置与移动后的锚点和卡片矩形复核：都不包含时在宽限后关闭，无关面板滚动时保留卡片。
- 窗口 `blur` 立即关闭。

表面跟随主题：`--dsw-specific-menu` 背景、菜单卡片的 `--dsw-elevation-prominent` 投影与 `--dsw-alias-border-l1` 发丝描边；`Rows.module.css` 中的正文使用 `--dsw-alias-label-primary`/`-secondary`/`-tertiary`，复制成功文案使用 `--dsw-alias-label-primary`。

## Alternatives considered

**任何滚动都无条件关闭。** 捕获阶段监听会看到所有滚动，包括流式输出时对话面板的自动滚动，那会关掉用户正在阅读的卡片。静止位置复核区分了锚点移动与无关面板移动。

**用 `document.elementFromPoint` 做命中测试。** 可以替代矩形计算，但 jsdom 未实现它，而矩形复核只需要组件已经在测量的两个矩形。

**保留设计稿中的固定深色表面。** Figma 值在两种主题下相同，但产品现在把它渲染在主题化的菜单与提示旁；浅色主题上的深色板读起来是缺陷而非设计。

## Consequences

- 指针移到卡片之外的任何位置后，悬停卡片不再被遗留；锚点消失后完全静止的指针会在下一次移动、下一次滚动或窗口失焦时关闭。
- `HoverCard` 的规范用带坐标的 `pointerenter` 进入桩化的锚点矩形（`enter` 辅助函数），因为停留计时器现在会校验位置；jsdom 默认的全零矩形仍接受 (0,0) 处无坐标的 `pointerenter`，其他包的行规范不受影响。
- 提供悬停卡片正文样式的消费者应使用 label 令牌；固定颜色在两种主题之一中将不再与表面匹配。
