# DeepSeek Harness

[English](README.md) | 中文

## 关于这个 fork

这是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的个人 fork。上游是该项目的真相源；本仓库与 DeepSeek AI 无关联，也不承诺任何支持。

**为什么存在。** Web 客户端只在文件改动发生的地方展示它——`edit`/`write` 工具行各自一张 diff 卡片，外加收尾回合的产出文件 chips。于是要审查一个会话对工作区做了什么，就得滚完整条转录并在脑子里按文件重建过程，而长会话会把答案埋在几百步之下。此前没有任何地方显示 agent 此刻正在动哪些文件，也没有任何地方把同一个文件的多次修改收拢到一处。

**它加了什么。** 转录区旁边一条会话文件侧栏，列出本会话读过和改过的文件；以及一份内联左右对照 diff——左为修改前、右为修改后，逐行配对——默认展开，并由「通用」设置里的一项控制。后代子代理会话经持久化的子会话目录读取并合并进来，每个文件一行，每段标注做出该改动的 agent、轮次与工具。设计本身、被否决的替代方案与已知限制记录在[文件面板 Agent Note](.agents/notes/implemented/feature/2026-08-26-web-session-file-panel.zh.md)。

视图标签行首的 `Files` 控件打开侧栏；改写行出现时其改动已经展开：

![转录区旁的会话文件侧栏，写入行出现时即已展开](docs/user/guide/session-file-rail.png)

展开一个产出文件即可对比它修改前后的内容——每次记录的改动一段，标注做出该改动的轮次与工具，于是一个「写一次、改两次」的文件读起来就是这三步：

![内联左右对照 diff，左侧为删除行、右侧为新增行，逐行对齐](docs/user/guide/session-file-diff.png)

**按文件的行数统计。** 侧栏每一行都在文件名旁写明这次改动的规模——新增行为绿色、删除行为红色，按该文件已记录的 hunk 汇总。合并后代会话的改动时，总数由合并后的片段重新计算，而不是把合并前的数字直接沿用过来。

![会话文件侧栏列出四个改动过的文件，每个都带新增与删除行数](docs/user/guide/session-file-line-stats.png)

**提问导航。** 长会话会把自己的提问埋掉，而分页历史意味着「只索引可见部分」会漏掉最早的那些提问。于是 Chat 视图从已定稿的 `user` Chat Node 推导出一份提问索引，并由一组粘性控件驱动它——这组控件与回到底部按钮共用同一个基于输入框高度的锚点：相邻跳转、当前提问的紧凑标记，以及一份可搜索的完整列表。跳转会把目标行对齐到顶部，尊重「减少动态效果」偏好，并把该行高亮两秒；若要跳到已加载头部之前，会先请求上一页再定位目标，于是分页仍只有一个权威来源。该特性不新增任何会话事件，也不改变模型可见的历史。

![历史提问面板，其中每条提问的正文已打码](docs/user/guide/question-navigation-panel.png)

**提问快捷键。** 导航在 macOS 上绑定 Command 加方向键，其他平台绑定 Control。「通用」设置里的这一行可以录制任意非修饰键，对不带修饰键的单键要求显式确认，拒绝只按修饰键，阻止上一个/下一个绑定重复，并提供三种触发范围策略；默认策略在表单控件与可编辑区域内不触发快捷键。

![提问导航快捷键设置行，含两个绑定与三种触发范围策略](docs/user/guide/question-navigation-shortcuts.png)

**可配置的工作区会话数。** 折叠的工作区此前固定显示五个会话，这在大屏上浪费高度，在密集侧栏上又藏掉太多上下文。现在这个数量是 5 到 20 的整数或 `auto`，默认仍是五，且工作区视图选项菜单与「通用」设置两处都能改。自适应会观测分组树的高度，扣掉分组标题的装饰后估算每组的行数预算，并夹紧到同一区间。显式展开的分组仍然显示全部会话；单列表模式忽略这项偏好，因为它没有按工作区折叠的控件。

![「通用」设置里控制每个折叠工作区默认显示会话数的一行](docs/user/guide/workspace-session-count.png)

**终端就绪判定。** 后端以 `PS1='dsh> '` 拉起 bash，并把快速判定就绪的条件设为看到这段文本，而常驻 bash 工具在启动后又把 `PS1` 改成了自己那个抗冲突的标记——于是提示符永远匹配不上，每条命令都退回到按静默时长判定。Linux 靠精确的 stdin 探测掩盖了这份代价；而在 macOS 上 `isStdinWaiting` 是个恒返回 `false` 的桩，于是那里每条命令都要付 `idleSilenceMs + handoffGraceMs`。现在提示符是每个会话各自的值、由 spawn 请求声明，并拒绝空提示符与多行提示符，因为这两者都无法与终端输出匹配。在 darwin 上对真实 bash PTY 实测：改动前每条命令 3506 毫秒，改动后 56 毫秒。

**被委派的子会话 id。** subagent 工具调用现在会记录它派生出的子会话。父会话日志里没有别的东西能标识它——Session 摘要只带 `parentSessionId`——所以没有这条记录，调用与其子会话事后就关联不起来。目前还没有客户端读取它——文件侧栏仍经子会话目录触达后代——但它解除了「把后代的 diff 画在派生它的那次调用之下」的唯一阻塞。

**状态。** 跟随上游的进行中工作。这里的分支可能包含若干条并行工作的半成品；不承诺任何东西稳定，改动也不会自动回流上游。MIT 许可证与全部上游声明原样继承——见 [LICENSE](LICENSE)。

---

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

<a id="run"></a>

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
