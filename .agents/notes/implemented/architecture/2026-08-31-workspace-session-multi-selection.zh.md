# Agent Note: Session 行的连选与多选

Status: implemented

[English](2026-08-31-workspace-session-multi-selection.md) | 中文

## Problem

Workspace 浏览器的 Session 行此前没有自己的选择概念。单击即「打开」，唯一高亮的行是当前打开的 Session，由 `currentId` 派生。习惯了文件管理器的用户期望 `Shift` 选中一段连续的行、`Ctrl` 逐个挑选，实际得到的却是一连串会话切换。

## Decision

选区是与「当前打开的 Session」并存的视图集合，不取代后者。`selection.ts` 中的纯模型持有全部状态转移——普通、切换、区间、切换+区间、全选、方向键移动与剪枝——以可见行序列上的函数形式表达，因此语义无需 DOM 即可单测。

每个列表体传入自己实际渲染的行 id，按渲染顺序排列。展开的嵌套子会话紧随父会话；折叠的 Workspace 或嵌套分支以及 **展开其余** 截断之后的行都不参与。这使区间能够跨越 Workspace 分组和嵌套分支，同时只触及用户看得见的内容。分组树、平铺列表和搜索结果各自绑定自己的序列。

Apple 平台把切换修饰键映射到 `Cmd`。该平台上 `Ctrl`+单击是系统次级点击，永远不会作为普通单击抵达，也就无法承载切换语义。

选区存放在自己的非持久化 store 中，而不是既有的 Workspace 视图 store。快照 store 的持久化是整值的，任何加入持久化 store 的字段都会跨刷新存活；恢复出来的选区会高亮用户在本次访问中从未选过的行。启用开关本身是真正的设置项，确实存放在持久化 store 中，其 key 因新增字段而递增。由于一次 register 只声明一个 store，而该席位已被持久化的视图 store 占用，选区通过保留的 `hooks` inject 隔间抵达组件——这是注册方私有响应式事实的规范通道。

只有 Session 行参与选择。Workspace 标题行保持其展开/折叠语义。

## Verification

`pnpm run test:gui`、ui-workspace 包测试（含纯模型套件与装配后的浏览器交互套件），以及该包的 TypeScript 构建。

## Alternatives considered

**把选区放进既有的视图 store** — 否决，因为该 store 按整值持久化。要屏蔽单个字段，需要引擎有意不提供的 partialize 路径（手写持久化的存在恰恰是因为 zustand 中间件会破坏整值状态）。

**基于派生数据顺序计算区间** — 否决，因为渲染顺序并非数据顺序：Workspace 和嵌套分支会折叠，溢出截断会隐藏行。按数据顺序取区间会静默选中用户看不见、也无从核对的行。

**把区间限制在单个 Workspace 分组内** — 否决，因为资源管理器的区间跨越文件夹边界，而浏览器本就把分组呈现为一条连续的滚动列表。跨分组区间也让平铺列表与分组树行为一致。

**把批量操作耦合进选择模型**——拒绝。纯选择模型继续与所有操作保持独立；[感知选择范围的操作层](../feature/2026-09-02-selection-aware-session-actions.zh.md)在 UI 边缘解析当前选择范围、进度、失败和剪枝。

**为设置行新增共享的 `Switch` 基础组件** — 暂时否决，因为 `ui-primitives` 目前不导出开关组件，新增公开组件需要签核。该行复用同级会话数设置行的 `Menu` 选择器，使通用设置区保持统一的控件范式。

## Consequences

选区始终是浏览器本地的视图状态：没有 Host 设置 schema，没有 session event，也没有任何模型可见内容。行激活现在携带手势的修饰键标志，因此 `SessionNodeItem` 与 `SearchResultItem` 上报 `(id, event)` 而非 `(id)`。带修饰键的按下会抑制重排拖拽，存在多选时会抑制行悬浮卡片。关闭该设置会清空当前选区，因为所有清除手势本身都受该设置控制。
