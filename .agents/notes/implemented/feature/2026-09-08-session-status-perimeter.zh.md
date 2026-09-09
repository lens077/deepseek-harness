# Agent Note: 低动态 Session 状态边框

Status: implemented

[English](2026-09-08-session-status-perimeter.md) | 中文

## Problem

侧边栏的紧凑状态点可以传达状态，但同时显示多个对话时容易被忽略。持续使用高亮或快速边框会带来新的问题：周边视觉中一直存在运动、对比度过高，并且无法提供合适的减少动态效果体验。新的呈现还必须保留[完成提醒与待处理交互状态点](../../../../packages/client/ui-workspace/README.zh.md#use-this-package)以及[后代活动](2026-07-27-web-subagent-conversations.zh.md)已有的语义区分。

## Decision

`ui-workspace` 为分组、平铺、归档和搜索界面的 Session 行添加装饰性边框。待处理交互会抑制边框。其他情况下，属主 Session 正在运行的状态优先；只有持久化的 `sessionDigest.outcome === 'error'` 表示运行出错；进程内的未查看完成提醒表示成功。`aborted`、`blocked`、`max-tokens` 和 `interrupted` 保留各自含义，不使用错误呈现。只有后代在运行时，原有状态点和读屏标签仍然显示，但不会出现代表属主正在运行的边框。

运行状态使用一条低透明度语义色轨道和一段每八秒旋转一周的长锥形渐变高光。覆盖层本身是环形 mask 和裁剪区域，其中只有一个居中的正方形渐变在旋转，因此高光沿行边缘移动且不会绘制到行外。完成和错误状态保持静态，因此终态行不会循环或闪烁。边框使用独立子元素，因为行的伪元素已用于拖拽插入标记。`prefers-reduced-motion: reduce` 会移除旋转高光并保留按状态着色的轨道。

持久化的 Workspace viewing store 通过通用设置提供三档模式：`animated` 为默认值；`static` 保留轨道但移除动画；`hidden` 只省略边框。所有模式都保留状态点和读屏标签。store 键改为 `dsh.workspace.view.v9`，因为持久化会恢复完整值，而旧值无法提供必填的模式字段。

## Consequences

此功能不添加 Host 状态、Session event 或 wire 字段。行投影只导入 `sessionDigest` 类型扩充，并把最新 outcome 转换为一个呈现布尔值。对于只保存了 v8 值的浏览器，v9 持久化键会让 viewing store 以默认值启动一次；之后的修改会正常持久化。

边框表示当前属主活动、未查看的完成提醒或最新失败 Turn，且不会改变点击、选择、悬浮、拖拽或状态点行为。自动化浏览器覆盖默认循环、减少动态效果、静态与隐藏选项、刷新后的持久化、从运行中到已完成的状态转换，以及只有后代运行时属主行不显示边框。

## Alternatives considered

- **为完成和失败状态添加动画。** 不采用，因为终态的重复动态效果会增加干扰，却不能表达仍在进行的工作。
- **把所有非 completed 的 Turn outcome 都视为失败。** 不采用，因为中止、中断、阻塞和 token 耗尽具有不同含义；只有 `error` 使用错误呈现。
- **复用行伪元素。** 不采用，因为伪元素已绘制拖拽插入目标；复用会让两个独立状态及其绘制顺序耦合。
- **随边框一起隐藏状态点。** 不采用，因为此偏好控制的是补充视觉效果，而不是语义与无障碍状态呈现。
