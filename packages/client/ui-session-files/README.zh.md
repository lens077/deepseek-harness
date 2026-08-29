# @deepseek-ai/dsh-client-ui-session-files

[English](README.md) | 中文

会话文件侧栏：本会话读过和改过的文件。Node 半边只注册一个持久化 section——内联 diff 的展开偏好——除此之外什么都不做，因为侧栏展示的每个事实都已在 session log 里。浏览器半边占据 [`dsh-client-ui-conversation`](../ui-conversation/README.zh.md) 声明的两个座位：`conversation.session.tabs.leading` 承载视图标签行首的控件，`conversation.session.rail` 承载活动视图旁的常驻面板。只有随附的 Web patch 会加载本包；移除它那一条 cordis.yml 条目即可移除两处surface，标签行与视图区回到无占位时的形状。

`deriveSessionFiles` 把一份会话快照折叠成两个座位共读的模型，`sessionFilesOf` 以快照为键做记忆化，使一个跑到几百步的会话按快照走一遍而不是按每次 selector 调用走一遍。词汇取自工具自身的 render intent，与 [`dsh-client-ui-deliverables`](../ui-deliverables/README.zh.md) 读的是同一来源：`card: 'diff'` 视图，或 `kind` 为 `edit` 的 `card: 'generic'` 视图，是一次修改；`kind` 为 `read` 的 `card: 'generic'` 视图是一次读取。搜索两者都不是——它产出的是命中列表，不是 agent 打开过的文件。失败调用与删除不计入，而仍在飞行中的调用以带写入标记的形式贡献其路径。

已修改文件按最早在上排列，以首次记录改动的 seq 为键，于是一个文件再次被编辑时仍保持原位，而最新被触及的文件落在最下方。每个条目携带本会话对该文件的累积 hunks，按发生顺序排列，每段标注其轮次与工具。这个排序是已记录数据支持得起的极限：整文件 before/after 从不离开宿主进程（`ToolResult` 只携带 `content`、`isError` 和 `meta`），而 `computeHunkDiffs` 丢弃了 `structuredPatch` 的行号，于是 hunks 不带任何可用来按文件位置排序、或在重叠处合并的锚点。

读取列表回答的是 agent 此刻在做什么，因此它在 agent 运行期间保留最近二十条读取，空闲时为空——这是对 `running` 的推导，不是定时器，也不是一份存下来的清单。选中一个文件会调用 `revealFile`，滚动到最后一个以 `data-file` 携带该路径的工具行；在已加载窗口之外被修改的文件没有对应行，也就没有匹配。当快照报告 `hasMore` 时，侧栏声明该清单不完整并提供 `加载全部`，逐次分页拉取剩余历史。

子代理在自己的会话里工作，父会话日志只记录委派调用及其结果，因此一个把工作委派出去的回合对本地推导毫无贡献。`SessionTreeController` 直接读取后代来补上这个缺口：`subagent.list` 走持久化的子会话目录，`subagent.history` 把每个子会话的转录——无论活跃还是冷——读成 `{ event, view }` 对，其携带的 render intent 与本地快照持有的是同一批，因此 `deriveTreeFiles` 不需要对「何为改动」作第二次定义，只需要一次不同的遍历。两种深度、一个开关：打开面板读取第一层已完成的子会话，每个一页——树可能很宽，而一个打开的面板不该扇出；`加载全部` 递归整棵树、把每个后代分页读完，并在同一个动作里补全本地历史。

`mergeTreeChanges` 把这些折叠进本地模型：无论由谁记录，每个文件一行——文件是读者审查的单位，因此两个 agent 都碰过的文件仍是一行，作者改由每段的标签承载（`reviewer · 第 3 轮 · edit`）。行内的段按墙钟时间排序，这是离开自身会话后唯一还成立的排序；行本身保持本地顺序，并把仅后代改过的文件追加在其后，因为跨会话混排行序会在每次后代读取落地时重新洗牌整个列表。

`SessionFilesRailController` 把侧栏的开合状态与宽度放在浏览器级的单个 `localStorage` 条目里，而不是按会话存：关掉侧栏的读者希望它处处关闭，而拖出来的宽度是其窗口的属性。宽度钳制在 240–560px，初始 300px；侧栏首次使用时打开，此后尊重已持久化的选择。

diff 刻意不在侧栏内渲染。在这个宽度下两栏代码无法阅读，而同一内容的第二套更窄的渲染意味着第二个需要同步维护的东西——阅读surface是转录区，那里有完整列宽和 [`SideBySideDiff`](../ui-primitives/README.zh.md)。

同一份推导以本包提供的可选 `chatFileDiffs` service 抵达那个surface：给定一个会话和一个路径，它返回已记录的 hunks，每段标注做出该改动的轮次与工具（`第 3 轮 · Edit`），由 [`dsh-client-ui-deliverables`](../ui-deliverables/README.zh.md) 画在读者展开的那个 chip 之下。该 service 经 `ctx.get` 获取，因此把本包组合掉会让那些 chip 回到它存在之前的打开行为。

一个回合有多少内容不经询问就展开，作为响应式偏好搭同一个 service 传递，因此改动会抵达已经渲染在屏幕上的转录。`DiffExpansionPolicy` 拥有它：默认**全部展开**——写入文件的 diff 正是读者要看的东西——另有**仅单个文件时展开**与**全部收起**两个选项，从本包贡献给「通用」设置的*文件改动的对比*一行中选取。存在 settings provider 时该值经 `settingsScope` 持久化，否则退化为进程内偏好，与 composer 的 busy-Enter 偏好是同一套安排。读取按构造不在这个词汇表里：一个只被读过的文件没有可展开的对比。

## Model Experience

无。本包为人渲染客户端推导出的状态，不触及任何 prompt、消息、schema、流或工具结果。促使模型点名其已改文件的引导语仍归 [`dsh-client-ui-deliverables`](../ui-deliverables/README.zh.md) 所有。

#### KV Cache effect

无；本包从不组装或发送 provider 请求。

## Known Limitations and Deferred Work

- **仅后代改过的文件在转录区没有 diff。** 侧栏会列出它、合并后的模型也持有它的段，但内联surface挂在某个回合的产出文件 chips 上，而只被子代理碰过的文件从不出现在其中。把它展开在父会话的委派行之下，是[文件面板 Agent Note](../../../.agents/notes/implemented/feature/2026-08-26-web-session-file-panel.zh.md) 第二阶段剩下的一半；在那之前，在侧栏选中这样一行是无反应的。
- **活跃后代的改动在它结束时出现，而不是在它工作期间。** 每当目录镜像里运行中的子代理数下降，侧栏就重读整棵树，因此一个跑完的子代理无需刷新即可落地；它中间的每一步则不会。后代采用读取而非订阅，是因为 `events.mux` 是 runtime 独占的单条聚合流，第二个消费者会被拒绝。
- **在侧栏选中本地文件滚动到的是其工具行，不是那个展开的 chip。** `revealFile` 通过 `data-file` 寻址工具行；要让侧栏驱动 turn-tail 的展开，需要一条两个包目前都没有的通道。
- **内联 diff 没有高度上限。** 它的高度随改动而定，因此一次整文件创建会渲染每一行。`DiffBlock` 把工具行封在十六行加一个展开控件之后；这个surface没有。
- **清单只覆盖已加载的历史**，直到使用 `加载全部`。侧栏会声明这一点，而不是把一份不完整的清单当作完整的呈现。
