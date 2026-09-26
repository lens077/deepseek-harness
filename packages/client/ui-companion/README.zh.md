---
description: "说明休息小助手的交互控件、响应式布局、本地状态与内置图片，供部署方选择是否启用浏览器小助手。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-companion

[English](README.md) | 中文

## 概述

让蓝色小鲸鱼停靠在导航旁，或将它移动到自行选择的位置。点击角色可以打招呼、让它休息或叫醒它；需要减少干扰时，可以暂停动效或收起角色。打开**用量速览**，无需离开对话即可查看今天、本周或本月的用量。手机和折叠导航栏显示静止、可点击的角色，并提供同一用量入口。小助手不调用模型，页面重新加载后会重置交互状态。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

休息小助手适用于由用户控制的可选装饰，不用于显示任务进度或提醒休息。

### 启用方式

[web-app 组合配置](../../bundle/web-app/cordis.patch.yml)包含 `ui-companion` Cordis 配置项，其 `disabled` 值为 `true`。部署方通过该配置项的 `disabled` 元数据选择启用，而不是设置包配置字段。此包没有配置字段；浏览器中的注册内容依赖语言服务和侧边栏 slot 声明。

### 交互与位置

每次点击角色都会按 `idle → greeting → sleeping → idle` 推进状态；状态不会定时自动切换。在展开布局中，**暂停动效**和**开启动效**控制动画，不改变角色状态。**收起小助手**将展开区域替换为紧凑按钮；点击该按钮可以恢复展开区域。

在手机和折叠导航栏中，紧凑角色用于循环切换角色状态，而不是展开区域。紧凑布局、隐藏页面和拖动期间会暂停动效；操作系统的减少动态效果偏好会禁用动画。在同一插件实例内，角色状态、收起状态、手动动效偏好和位置会跨响应式重新挂载保留。页面重新加载后，小助手恢复为空闲、展开、未暂停且停靠在导航中的状态。

高度不超过 600px 的窗口使用静止的矮行，并保留动效与收起控件。小助手初始停靠在桌面端设置入口上方预留的 `sidebar.footer.action` 空间。侧边栏在手机顶部栏渲染同一 slot，并传入 `wide: false`。停靠位置不会遮挡对话或输入区。

### 用量速览

独立的**用量速览**按钮直接打开紧凑的非模态浮层，提供**今天**、**本周**和**本月**选项 pill。浮层显示已发现会话的 token、上报用量的请求数和估算费用，无需选中会话。预览展示记账时区与日期范围；历史缺失和用量不完整会明确披露，不会变成虚构的零值或完整费用。

在浮层外操作指针、按 Escape 或点击关闭均可收起浮层，不会使应用背景 inert，也不会限制 Tab 焦点范围。浮层宽高适配视口，在桌面与手机布局之间切换时保留已打开的视图。**查看详情**以「全部会话」范围打开 [Chat 拥有的用量抽屉](../ui-chat/README.zh.md#session-usage-and-cost)；选中会话后也可选择「本会话」和「会话树」。关闭抽屉后，焦点回到持续存在的用量按钮。未加载用量提供方时，预览会说明面板不可用，而不是显示虚构的总量。

### 移动与归位

使用鼠标主键、笔或触摸拖动角色。移动至少 6 个 CSS 像素后，角色脱离停靠区域，悬浮在相对于视口的位置；结束拖动不会触发角色的点击动作。普通点击仍用于状态循环或恢复展开。角色获得焦点时，方向键每次移动 16 个 CSS 像素，**Home** 键将角色放回导航；这些快捷键不处理与 Alt、Ctrl 或 Meta 的组合。

移动后，以及视口或小助手尺寸变化后，悬浮位置会被限制在视口范围内。悬浮时始终提供**归位**按钮，紧凑布局也不例外；该按钮可恢复导航中的位置。用户选择的位置可能遮挡对话内容或输入区；再次移动或归位即可移开遮挡。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[浏览器入口](src/client/index.ts)拥有一个[交互状态存储](src/client/store.ts)、本地化文案和页面可见性观测。感知 slot 声明的注册方式让侧边栏负责布局尺寸，[组件](src/client/Companion.tsx)负责渲染控件。插件 dispose（资源释放）会移除其注册内容、语言字典和可见性监听器。

小助手声明 `companion.usage.panel` 子 slot，其基数为 `single`、作用域为 `session-maybe`。[Owner props](src/client/index.ts)传递所需日历周期或详细范围、范围切换回调与关闭回调。小助手仅在用量视图打开时渲染该 slot，并负责锚定浮层。[ui-chat](../ui-chat/README.zh.md#session-usage-and-cost)提供私有适配器，负责日历汇总、预览内容、详细抽屉和警告；两个功能包都不导入对方的运行时值。

[打包配置](tsdown.config.ts)将 [awake.webp](src/client/assets/awake.webp) 和 [sleeping.webp](src/client/assets/sleeping.webp) 嵌入为 data URL。渲染不会向外部请求图片。

此包不发布不变量配套插件：交互状态由单一本地展示状态存储拥有，不存在需要核对的独立观测关系。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下相关文档说明位置、启用方式和决策。

- [侧边栏](../ui-sidebar/README.zh.md) — 桌面和手机导航预留的 slot。
- [Web-app 组合包](../../bundle/web-app/README.zh.md) — 部署组合配置。
- [休息小助手 Agent Note](../../../.agents/notes/implemented/feature/2026-09-26-rest-companion.zh.md) — 理由与备选方案。
- [可拖动小助手 Agent Note](../../../.agents/notes/implemented/feature/2026-09-26-draggable-rest-companion.zh.md) — 用户控制位置与归位。
- [日历用量 Agent Note](../../../.agents/notes/implemented/feature/2026-09-26-companion-calendar-usage.zh.md) — 直接预览、日历记账与详细抽屉所有权。

-----

<a id="model-experience"></a>
## 模型体验

无，因为小助手仅改变浏览器展示，不添加模型输入、模型调用或会话事件。

#### KV Cache 影响

无；小助手既不改变模型输入 token，也不改变提供方请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

角色仍为本地装饰；用量是由其提供方拥有的只读视图。

- 不提供声音、休息计时器、通知、随会话状态自动变化的行为或持久化偏好存储。
- 用量需要面板提供方；缺少提供方时显示不可用提示，不显示用量总计。提供方用于日期更新的分钟时钟仅在日历预览挂载时运行。
- 内置图片由用户提供的蓝色 Q 版女仆鲸鱼参考图在本地处理而成。该来源说明不代表已取得上游角色授权；再分发前需要单独核实相关权利。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
