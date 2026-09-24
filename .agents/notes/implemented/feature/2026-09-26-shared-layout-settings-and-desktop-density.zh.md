# Agent Note：共享布局设置与桌面密度

Status: implemented

[English](2026-09-26-shared-layout-settings-and-desktop-density.md) | 中文

## Problem

布局偏好分散在「通用设置」和由可选 ui-session-files 插件持有的会话专用页面中。桌面用户无法选择手机端已有的大、中、小间距密度，不含会话文件功能的组合也没有稳定的通用「布局」页面持有方。

## Decision

设置外壳在「通用设置」旁持有平级的「布局」页面，并声明 `settings.layout.item`。功能插件贡献布局行而不持有页面：ui-theme 贡献桌面密度、手机密度与字号和纯净 UI；ui-session-files 贡献文件可见性与行内 diff 展开方式。「通用设置」保留配色外观与桌面对话字号。

主题设置将 `desktopLayout` 与 `mobileLayout` 分别持久化；两者都接受 `large`、`medium` 或 `small`，默认值均为 `medium`。AppFrame 只在桌面发布 `data-desktop-layout`，只在手机发布 `data-mobile-layout`。桌面密度通过继承的间距变量调整三栏侧边栏、会话顶部栏与标签，以及输入区。它不会发布手机导航 owner 参数，也不会选择手机结构。

## Alternatives considered

**继续由 ui-session-files 持有「布局」页面。** 拒绝，因为通用设置入口不应在可选文件功能缺席时消失，主题设置行也不应依赖另一个功能插件的实现包。

**在所有视口复用 `mobileLayout`。** 拒绝，因为手机和桌面密度是不同的用户选择；复用一个持久字段会让一端的修改覆盖另一端。

**按视口阈值自动改变桌面密度。** 拒绝，因为需求中的大、中、小是明确偏好。宽度仍在 768px 选择桌面或手机结构，但不替用户选择桌面密度。

## Verification

设置外壳、ui-theme、ui-session-files、ui-layout 与 ui-sidebar 的定向测试覆盖页面注册与释放、独立持久化、无障碍控件、根节点属性，以及不变的桌面结构。受影响的 Client TypeScript 项目与插件 bundle 均构建成功。

## Consequences

`settings.layout.item` slot 归 ui-settings 所有，因此每个贡献方继续保持可选并感知声明生命周期。既有手机偏好保留原键与行为。新的桌面字段为持久化 `ui-theme` 命名空间和 memory 模式浏览器展示存储各增加一个值。密度只改变展示，不新增 Session 事件或模型可见输入。
