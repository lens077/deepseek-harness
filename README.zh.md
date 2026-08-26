# DeepSeek Harness

[English](README.md) | 中文

## 关于这个 fork

这是 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的个人 fork。上游是该项目的真相源；本仓库与 DeepSeek AI 无关联，也不承诺任何支持。

**为什么存在。** Web 客户端只在文件改动发生的地方展示它——`edit`/`write` 工具行各自一张 diff 卡片，外加收尾回合的产出文件 chips。于是要审查一个会话对工作区做了什么，就得滚完整条转录并在脑子里按文件重建过程，而长会话会把答案埋在几百步之下。此前没有任何地方显示 agent 此刻正在动哪些文件，也没有任何地方把同一个文件的多次修改收拢到一处。

**它加了什么。** 转录区旁边一条会话文件侧栏，列出本会话读过和改过的文件；以及一份内联左右对照 diff——左为修改前、右为修改后，逐行配对——默认展开，并由「通用」设置里的一项控制。后代子代理会话经持久化的子会话目录读取并合并进来，每个文件一行，每段标注做出该改动的 agent、轮次与工具。设计本身、被否决的替代方案与已知限制记录在[文件面板 Agent Note](.agents/notes/proposed/feature/2026-08-26-web-session-file-panel.zh.md)。

视图标签行首的 `Files` 控件打开侧栏；改写行出现时其改动已经展开：

![转录区旁的会话文件侧栏，写入行出现时即已展开](docs/user/guide/session-file-rail.png)

展开一个产出文件即可对比它修改前后的内容——每次记录的改动一段，标注做出该改动的轮次与工具，于是一个「写一次、改两次」的文件读起来就是这三步：

![内联左右对照 diff，左侧为删除行、右侧为新增行，逐行对齐](docs/user/guide/session-file-diff.png)

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
