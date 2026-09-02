# Agent Note: 汇总卡片高度上限与侧栏揭示外部打开的会话

Status: implemented

[English](2026-09-03-inbox-card-cap-and-sidebar-reveal.md) | 中文

## 问题

汇总面板（`@deepseek-ai/dsh-client-ui-digest`）有两个缺陷让分诊变得令人困惑。

汇总网格让每张卡片按内容自然撑高。一张带有很长收尾回答的卡片会越过面板底部，同一网格行里的其他卡片被拉伸到相同高度，**打开会话** 所在的操作行落到可视区之下。面板主体虽然可以滚动，但要触达某一张卡片的操作，就得滚过整屏文字。

从卡片打开会话只调用 `ctx.sessions.open(id)`，别的什么都不做。会话在中栏打开了，但会话浏览器（`@deepseek-ai/dsh-client-ui-workspace`）只会自动展开没有显式展开状态的工作区分组；用户手动折叠过的分组保持折叠，位于 **显示更多** 截断之后的行保持隐藏，折叠分支下的嵌套分叉子会话也保持隐藏。开启多选时，用户上次点击的行仍带着更强的 `.multiSelected` 强调色，而刚打开的会话即便可见也只有更淡的 `.selected` 底色——浏览器看起来像是选中了一个用户从未打开的会话。

## 决定

**卡片上限。** `DigestPanel.module.css` 中的 `.body` 是尺寸查询容器（`container-type: size`；这个盒子的尺寸由 flex 列而非内容决定）。`.card` 采用 `box-sizing: border-box`，`max-height: calc(100cqh - 36px)`——主体可见内容高度减去网格上方的分区标签。`InboxCard` 渲染三个 flex 子元素：固定的头部（`.cardHead`，`flex: none`）、滚动的中部（`.cardBody`，`flex: 1 1 auto; min-height: 0; overflow-y: auto`，带 `data-card-body` 与 l2 滚动条令牌，因为它在 layer-1 卡片表面上滚动）、固定的操作行（`.cardActions`，`flex: none`）。网格行里被拉伸的卡片仍把操作行留在底部，因为中部吸收了多余高度。

**侧栏揭示。** `WorkspaceBrowser.tsx` 中的 `SessionTree` 把列表 `ready` 之后 `current` 的变化视为一次导航并记录为 `pendingReveal`；加载时恢复的会话只用来初始化引用，不触发揭示。第二个 effect 每次渲染只解开一层，因为折叠的分组不派生任何行，截断与分支只有在分组展开后才能读到：它把分组的显式展开状态置为 true，当 `locateSession`（`tree.ts`）把该行定位到 `collapsedLimit` 或之后时把分组加入临时的全部展开列表，从 `collapsedBranches` 中移除该行的祖先，最后用 `block: 'nearest'` 把该行（每个会话行都带 `data-session-id`）滚动到可见区域。每一步展开都有守卫，树无法显示的行会静止下来而不会循环。

**选区跟随导航。** `WorkspaceBrowser` 根组件把同一次 `current` 变化——`ready` 之后、多选开启、非归档视图——当作普通单击那样的选择手势，把选区替换为 `{ selected: [current], anchor: current, lead: current }`，除非选区已经恰好是该行（普通单击路径在同一批次里设置选区并打开，因此在那里是空操作）。切换与范围手势从不改变 `current`，因此不受影响。

## 后果

- 每张卡片的操作行都在屏幕上；长回答在卡片内部滚动，主体在分区之间滚动。
- 从汇总、待办、搜索结果或分叉打开的会话在树中可见且被高亮，之前点击的行失去强调色。
- 揭示会写入分组的持久化展开状态（`setGroupExpanded(key, true)`），因此打开某个分组内的会话会撤销用户对该分组的折叠；临时的全部展开与分支状态只在本次会话内有效。
- `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx` 固定了重新展开折叠并滚动、撤销截断、展开分支、加载时不动折叠、选区移动这些行为；`tree.client.spec.ts` 固定了 `locateSession`；`packages/client/ui-digest/tests/panel.client.spec.tsx` 固定了头部 / 主体 / 操作行的拆分。

## 考虑过的替代方案

- **相对视口的 `max-height`（`100vh` 减去面板外框）**——否决：外框高度随工作区标签行与错误条变化，每次改头部这个数字都会漂移；卡片上限依赖的事实是主体自身的内容高度，容器查询单位直接读到它。
- **导航时清空多选而不是移动它**——否决：开启多选时普通单击会让打开的行保留强调色，清空选区会让外部打开的会话看起来与点击打开的不同；移动选区让两条路径渲染一致。
- **由汇总插件通过一个新的 ui-workspace 座位来揭示**——否决：每个外部打开方（待办、时间线、搜索、分叉、子代理目录）都得调用它，漏掉一个调用方就会重现缺陷；以运行时的 `current` 事实为键进行揭示，无需跨插件 API 就覆盖了所有打开方。
- **对每个 `current` 值都揭示，包括加载时恢复的那个**——否决：`current` 随列表 `pending → ready` 的边沿到达，恢复会在每次页面加载时撤销所有持久化的折叠。
