# Agent Note：对话中的文件点击在所选桌面应用中打开

Status: implemented

[English](2026-09-13-chat-file-clicks-open-in-chosen-application.md) | 中文

## 问题

对话中的每次文件点击——产出文件标签、行内代码提及、工具行路径——都在右侧 Sidebar 的文本预览中打开，这是自[右侧 Sidebar](2026-09-04-right-sidebar-docking-infrastructure.zh.md) 取代[工作区文件链接](2026-07-31-web-workspace-file-links.zh.md)的 Host 桌面打开器以来唯一的路径。在编辑器旁工作的用户希望文件在那个编辑器里打开，没有编辑器的用户希望文件在访达或文件资源管理器中被选中，而偏好侧栏预览的用户仍要保留它。会话头部已经带着 [open-in-app](2026-08-25-promote-open-anywhere-plugin.zh.md) 分体按钮与记住的应用，但它只打开 workspace 目录。

## 决定

头部记住的条目决定文件点击的去向。`ui-chat` 声明一个可选的 `chatFileOpener` 服务（`active()`、`open(absolutePath)`）并在每次点击时查询它；`ui-open-in-app` 从其页面生命周期的 controller 提供该服务。尚未选择时，由主机提供的第一个应用接手点击——目录把平台文件管理器排在最前，因此 macOS 上的访达与 Windows 上的文件资源管理器是默认值；两者随操作系统一起提供，总能解析成功。菜单新增一个**侧栏预览**条目（`sidebar`，不是目录 id），它让点击留在 Sidebar，并把头部按钮变成 Sidebar 文件树的打开入口。[ui-open-in-app README](../../../../packages/client/ui-open-in-app/README.zh.md) 拥有面向用户的行为描述。

记住的应用不再被主机提供时，是一个警告而不是回退。controller 的 `fileTarget()` 把它命名为 `not-installed`；服务用词典措辞后拒绝，Chat 已有的打开失败对话框显示这句话。头部按钮对 workspace 目录仍像以前那样回退到第一个可用应用；只有文件点击会拒绝，因为静默落入访达的点击会把卸载这件事对选择了编辑器的用户隐藏起来。

主机的 open 路由除目录外也接受文件。`shell-open` 启动器（文件管理器）通过 `dsh-native-command` 新增的 `revealNativePath` 在所在文件夹中选中文件（`open -R`；经 `Start-Process` 调用的 Explorer `/select,`，因为 `explorer.exe` 即便已弹出窗口也会以非零码退出；桌面 Linux 没有可移植的选中动词，故用 `xdg-open` 打开父目录）。`argv` 启动器原样收到文件，只有标记为 `directoryOnly` 的目录条目——终端与 Git GUI——收到文件的父目录，因此终端在文件旁边打开而不是执行它。

## 考虑过的替代方案

**为文件点击单独设一个设置项。** 两个都点名应用的控件会漂移；头部菜单已经是用户表达“我指的是哪个应用”的唯一地方，且其选择跨会话持久化。

**记住的编辑器不在时回退到文件管理器。** 对文件点击拒绝采用：用户选的是编辑器，取而代之的访达窗口读起来像一个 bug。头部目录按钮保留回退，因为它的标签点名了将要打开的应用。

**把行号转交给编辑器（`code --goto file:line`）。** 参数语法因编辑器而异，目录也没有按应用记录文件参数语法；侧栏预览保留行定位，编辑器从文件开头打开。推迟。

**在 Windows 上直接 spawn `explorer.exe /select,`。** 共享 runner 拒绝非零退出码，而 Explorer 弹出窗口后以 1 退出；`Start-Process` 返回 0 并脱离。

## 后果

在 macOS 或 Windows 主机上点击文件，现在会在访达或文件资源管理器中选中它，直到用户选择编辑器或侧栏；没有启动器的主机（SSH、无头 Linux）保持 Sidebar 行为不变，因为服务的 `active()` 对空目录回答 false。Web 脚手架除非测试要求，否则禁用 open-in-app 行，因此现有浏览器 e2e 的文件预览 golden 不受影响。

[controller spec](../../../../packages/client/ui-open-in-app/tests/controller.client.spec.ts) 拥有 `fileTarget()` 与 `openFile`；[插件 spec](../../../../packages/client/ui-open-in-app/tests/browser-plugin.client.spec.ts) 拥有提供的服务及其措辞；[action spec](../../../../packages/client/ui-open-in-app/tests/open-in-app-action.client.spec.tsx) 拥有侧栏条目；[Chat apply spec](../../../../packages/client/ui-chat/tests/apply-inject.client.spec.tsx) 拥有路由；[主机路由 spec](../../../../packages/host/open-in-app/tests/host-routes.spec.ts) 拥有按应用种类的文件启动；[path-opener spec](../../../../packages/util/native-command/tests/path-opener.spec.ts) 拥有 `revealNativePath`。
