# Agent Note：composer 上方的模型快速切换

状态：已实现

[English](2026-09-23-composer-quick-model-switch.md) | 中文

## 问题

在 composer 的模型位切换会话模型要按三次——打开触发器、进入 Model 面板、选中一行——为同一任务在两三个模型间来回切换的读者每次都要付这三次。`/model` 弹窗也不更短：输入命令、等目录行出现、再选一行。屏幕上没有任何东西记得读者实际用过哪些模型，于是每次切换都从整个按提供方分组的目录开始。

## 决定

**一条由最近使用模型组成的切换条紧贴 composer 卡片上方，** 由 `ui-model-selection` 以最高 order 注册进 `conversation.input.dock`，使其成为卡片之前的最后一个 dock 入口，并靠右聚拢，让药丸正好立在它们所捷径的模型位上方。所有药丸保持在一行且不换行；超出可用宽度时，切换条横向滚动并隐藏滚动条，使每条路由仍可到达并选择。每条记忆路由一枚药丸，当前路由呈按下态且不可点；按任一其他药丸即经座位与弹窗共用的那份会话级 `ModelDirectory` 提交该路由，三个入口因此保持一份状态。

**该列表是持久化的用户偏好，不是会话事实。** 宿主设置文档中的 `ui-model-selection.recentModels` 至多保存五条路由，最新在前。宿主经三个入口中任一接受的每次选择都由 `rememberRecentModel` 折叠进去：所选路由移到最前，被它替换的路由紧随其后，因此第一次切换就已提供回退之路；每条路由只保留一个条目，携带上次使用的推理强度。被拒绝的选择不记录任何东西。列表被所有会话共享，且不改变任何运行中会话的模型——选择仍经 `session.selectModel` 按会话进行。

**药丸在渲染时对照实时目录解析。** `quickModelChips` 用目录显示名命名每条记忆路由，并丢弃已加载分组不再公布的路由，因此切换条绝不会提供宿主会拒绝的模型；模型不再提供的记忆推理强度被丢弃，药丸改为提交模型默认值。所有药丸都是当前路由的切换条不渲染任何内容。

**切换条是通用设置中的开关，默认开启。** `ui-model-selection.quickSwitch` 只控制渲染；切换条关闭期间最近列表仍在累积，因此重新开启时显示的是读者的真实历史。`QuickSwitchPolicy` 仿照 `TranscriptViewPolicy`：在持久化落定前即发布显式选择，并采纳宿主段而不回写。

**插件获得宿主半边。** 其原本为空的 node 侧 `apply` 现在仿照 `ui-chat` 注册设置命名空间；共享的 `model-selection-settings.ts` 模块承载 schema 与折叠函数，使两个半边校验同一段。

## 考虑过的替代方案

**把药丸渲染在模型位内部、触发器上方。** 否决：该座位是 composer 工具行中的一个控件，工具行对其控件垂直居中；两行高的座位会把发送按钮和模式芯片推到更高一行的中部，而且工具行属于 `ui-conversation`，本插件不得伸进其骨架。dock 条是 composer 已为卡片上方入口声明的组合路径。

**按会话记忆列表，取自 Session 的 `lastUsed` 投影。** 否决：新会话将一无所有，而读者的习惯跨会话。会话级投影保持其本来含义——运行中的路由——跨会话记忆则与其他浏览器偏好放在一起。

**让读者固定路由，而不是记录近期使用。** 延期：固定需要编辑器、顺序以及安放两者的位置；近期记录什么都不需要，且已覆盖促成切换条的"在两个模型间来回"场景。README 把固定记为延期工作。

**把列表存进 `localStorage` 以免去宿主半边。** 否决：本 GUI 的其他浏览器偏好都经 `ctx.settingsScope` 走宿主设置文档，列表因此随读者跨浏览器，并与开关一起出现在设置编辑器中。

## 测试

`packages/client/ui-model-selection/tests/model-selection-settings.client.spec.ts` 经真实 `SettingsProvider` 注册命名空间、拒绝非布尔开关与畸形路由，并覆盖折叠：所选在前、被替换者在后，每条路由一个条目且携带最新推理强度，仅推理强度变化，引用不变的情形，以及超限淘汰。`quick-switch.client.spec.ts` 覆盖策略的默认值、乐观发布、宿主采纳与相同段短路，以及 `quickModelChips` 解析名称、标记当前路由、丢弃已下架路由与推理强度。`quick-model-switch.client.spec.tsx` 渲染纯切换条与 dock 适配器：按下且不可点的当前药丸、锁定与忙碌态、空条规则、拒绝提示，以及适配器的隐藏规则。`quick-switch-row.client.spec.tsx` 覆盖设置行。`browser-plugin.client.spec.ts` 新增 `settingsScope` 伪件，断言 dock 与设置注册、座位／弹窗／切换条的选择落入同一最近列表、新页面上的宿主采纳，以及拒绝消息。

## 影响

- `ui-model-selection` 现在依赖 `dsh-settings`（宿主，仅开发）与 `dsh-client-ui-settings`（浏览器，仅开发），并为 schema 打包 `schemastery`；其 `inject` 新增 `settingsScope`。
- dock order `50` 是栈中最高值。之后必须位于切换条之下的 dock 入口需要更高的 order；必须位于其上的取任何低于 50 的值。
- 最近列表上限为五条且不可配置；该上限是 schema 旁的常量，宽度理由写在旁边。
- 切换条的药丸按下除目录状态外没有自己的回读：拒绝经锚定在切换条上的瞬时提示显示，座位的内联错误条仍是目录加载的表面。
