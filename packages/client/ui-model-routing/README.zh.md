---
description: "Web GUI 的模型路由开关：模型座位旁的 composer chip 与「模型」设置页下方的一行，用于开关自动分配模型；面向按提示词路由的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-model-routing

[English](README.md) | 中文

## 概述

本包在 Web GUI 中把模型路由开关渲染两次：composer 工具行里模型座位旁的一个 chip，以及「模型」设置页提供方列表下方的一行。两者展示同一事实——已挂载的路由器是否可以为每条提示词挑选另一个已配置的模型或推理强度——点一下就立即写入 `model-routing.enabled` 设置。关闭后始终使用会话中选定的模型作答；停留在被路由模型上的会话会在下一条提示词时回到它。未挂载路由器时什么都不渲染。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本插件与 `ui-conversation`、`ui-settings-models` 一起挂载，并在 Host 上挂载一个 `dsh-model-router` 提供方；Host 一提供 `model-routing` 设置 namespace，chip 与行就会出现。

### chip 展示什么

chip 位于 composer 工具行模型座位之前，路由开启时显示**自动分配模型**，关闭时显示**固定模型**；tooltip 解释当前状态。点击它会为整个部署翻转该设置，并在 Host 应答前禁用 chip。「模型」页的行展示同一个开关，附完整描述与当前状态的提示。

### 失败

Host 未接受的写入——只读文档、传输故障，或 Host 确认却未重新发布值——会在「模型」页的行上自报，两个表面都保持显示已保存的值。两个表面都不暂存草稿；没有什么需要保存或放弃。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

一个 `ModelRoutingController` 通过 `ctx.settingsScope` 绑定 `model-routing` scope，并发布一个快照 store，两个注册都把它注入为 `useModelRouting`；行注册到「模型」页的 `settings.models.footer` 席位，chip 以 order −10 注册到 composer 的 `conversation.input.right` 席位。`available` 即 scope 的 `ready` 状态：有路由器提供该 namespace，否则不渲染。`enabled` 把缺省值读作开启，与 Host schema 默认一致。`toggle` 执行一次 `scope.set('enabled', next)`，在途期间忽略后续切换，写入抛错或重新发布的值与所写不同时标记 `failed`。node 半边是空的 apply（名单行）。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当开关本身不够用时阅读这些页面。它们从表面走向路由接缝与它编辑的设置。

- [dsh-model-router](../../llm/model-router/README.zh.md)——路由接缝、它提供的 `model-routing` 设置，以及开关关闭时会发生什么。
- [dsh-model-router-llm](../../llm/model-router-llm/README.zh.md)——询问会话自己的模型应由哪个已配置选项作答的提供方。
- [ui-settings-models](../ui-settings-models/README.zh.md)——声明行所填充的 `settings.models.footer` 席位。
- [ui-conversation](../ui-conversation/README.zh.md)——声明 chip 所填充的 composer `conversation.input.right` 席位。
- [Client 包地图](../README.zh.md)——相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

通过开关写入的 `model-routing.enabled` 设置间接影响：Session controller 在每条提示词前读取它，路由器与请求组装拥有全部模型可见效果。

#### KV Cache 影响

关闭路由会让被路由的 Session 在下一条提示词时回到基线路由，这会改变一次请求路由；开关本身不增加任何提示词内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义了当前的开关。它们是当前包的约束，不是任务积压。

- **一个部署级开关**——chip 为所有 Session 切换 `model-routing.enabled`；按 Session 的 Auto/固定状态随路由接缝一起推迟。
- **没有裁决预览**——chip 显示路由是否开启，而不是路由器会为草稿挑哪个模型；实际应用的路由在请求落地后出现在模型座位中。
- **chip 属于默认 composer**——待处理的整 composer 交互会暂时替换工具行及其 chip。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

None.

</details>

**运行时 invariant：** 不发布伴随插件。设置的语义由 dsh-model-router 拥有，两个表面都是 slot effect，其声明、注册与卸载由本包测试覆盖。
