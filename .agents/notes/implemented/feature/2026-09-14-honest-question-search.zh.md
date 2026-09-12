# Agent Note：诚实的提问搜索

Status: implemented

[English](2026-09-14-honest-question-search.md) | 中文

## 问题

问题导航器的搜索框过滤的是 `questions`——已加载事件窗口内的提问。该窗口只是会话的一个后缀：它持有最新一页，外加读者已翻入的更早页面。只存在于更早页面的文本会得到一个空列表。

空列表是一个答案。不加限定地渲染出来，它读作"没有匹配的提问"，且与真正不含匹配的会话产生的空列表毫无区别。这个功能不只是弱，而是**以读者无法察觉的方式给出错误答案**。这正是本 Note 要处理的缺陷，也是"缩小范围"从来不是可接受解法的原因——一个范围更窄但仍在撒谎的搜索，还是同一个 bug。

面板里的 `onLoadAll` 并未修复这一点。尽管名字如此，它只拉取一页：

```tsx
onLoadAll={() => { if (hasMore && !loadingOlder) loadOlder() }}
```

面板每次打开还会调用它一次，于是打开面板本身就会静默地把窗口扩大一页，改变同一个查询的答案。反复点击按钮的读者最终确实能加载完会话，代价却正是原始需求明确拒绝的：把整份转录——消息体、工具调用、图片——常驻浏览器，只为回答一个关于提问文本的问题。

## 决策

在 host 上搜索整个会话，只传输提问文本与跳转地址，并让每个答案都说明自己的覆盖范围。

### 复用：`searchEvents` 本身就是那个轻量提问索引

需求提出的是新增一个只返回提问文本的 host 接口。在设计之前，我们先核对了 `SessionQueryEngine` 已经暴露了什么，结果该能力完整存在——`packages/session-query/session-query/src/index.ts:124`，"Search events within one live-preferred logical session"：

| 需求 | 既有能力 |
| --- | --- |
| 限定为用户提问 | `SessionEventMetadataFilter` 接受 `{ kind: 'type', values: ['user/message'] }` 与 `{ kind: 'surface', values: ['current'] }` |
| 跳转目标 | `SessionEventSearchHit extends SessionEventRecord`，携带 `seq`、`time`、`type`、`surface` |
| 不含消息体的文本 | `snippet`，长度受限的纯文本摘要 |
| 结果不完整的信号 | `nextCursor`，仅在最后一页缺席 |
| 会话范围限定 | `SessionEventSearchRequest.sessionId` |

`extraction.ts` 决定了 `user/message` 贡献什么：对其 content 块执行 `contentText`，其中 `blockText` 对 `reasoning` 返回 `[]`，并把 `tool-call` 归约为名称与参数。用户提问的 text 块恰好就是索引所持有的内容。SQLite 后端已完整实现该方法，含 cursor 代次与 `snippetChars` 上限（默认 240）。

因此**没有新增任何服务方法**。按 `packages/AGENTS.md`（"Require evidence for public choices"，以及"公开方法只有一个内部调用者"这一反向气味），新增方法需要证据表明既有方法无法服务此消费者，而它能。缺口从来不在能力本身——而在于 `searchEvents` 没有 wire 出口，浏览器侧的消费者够不到它。

### 诚实性保证不依赖 wire

`ChatViewInjected.searchQuestions` 是可选的，而它的缺席**不是一个被降级的静默状态**——它就是 `window-only` 状态，会明确告诉读者只搜索了已加载的提问。**无论传输层是否存在，视图都不能在没有全会话搜索的情况下断言全会话的否定结论。**

本次变更在那六个 wire 文件仍承载着另一个 agent 未提交工作时，就交付了契约、客户端消费与该保证，因为 `git add <路径>` 无法只选取文件的一部分。传输层在这些文件落定后单独落地——见[接通提问索引](2026-09-14-question-search-wire.zh.md)——而正是这个可选 prop 让两者能以任意顺序抵达。

复用跨会话的 `session.search` 是基于实质理由否决的，而不只是因为文件冲突：它的请求载荷是 `{ query }`，没有会话 id；结果是 `{ sessionId, snippet }`，没有 `seq`。它既不能限定会话，也无法定址跳转。

### 诚实性是状态区分，不是一句免责声明

屏幕上的列表绝不独自代表整个会话。`chat/question-search.ts` 把各种结局区分开，因为空列表在每种情形下含义不同：

| 状态 | 告知读者的内容 |
| --- | --- |
| `resolved`，完整，空 | 整个会话中没有匹配的提问——**唯一敢于断言否定的状态** |
| `resolved`，不完整 | 结果不完整；请缩小关键词 |
| `searching` | 全会话搜索进行中 |
| `failed` | 未能查询整个会话；可能存在其他匹配 |
| `window-only` | 只搜索了已加载的提问 |

被拒绝的搜索归约为 `failed`，绝不归约为空的 `resolved`。这是日后最可能被"简化"成空列表的一个分支，而那样做会悄悄复原最初的缺陷；组件测试 `reports a failed search instead of showing an empty list` 的存在就是为了在那一刻失败。

### 不加载整个会话也能跳转

窗口内的命中按索引跳转。窗口外的命中以 `seq` 定址，并沿既有机制回翻：`ChatView` 记录请求的 seq，驱动既有的 `loadOlder` 直到窗口覆盖它，然后跳转。**没有引入第二套滚动路径。** `hasMore` 为假时停止翻页——够不到的命中会结束尝试，而不是无限旋转，因为永不停止的加载动画本身就是另一种虚假陈述。

### 量化：这避免了传输什么

一条命中是 `{ seq: number, time: number, snippet: string }`，摘要上限 240 码点。一条 40 个汉字的现实提问摘要约 120 字节 UTF-8，加上约 40 字节的 JSON 外壳与数字：**每条约 160 字节**，在摘要上限处硬上界约 760 字节。一页 20 条为**典型约 3 KB，最坏不足 16 KB**——由页大小界定，与会话长度无关。

替代方案——也就是 `onLoadAll` 所暗示的行为——传输的是会话事件。单个回合的原始事件（用户消息、助手消息、带参数的工具调用、工具结果）从个位数 KB 到数百 KB 不等，当结果携带文件内容时更甚，图片则再高若干数量级。对于千轮会话，把整份日志翻入浏览器、在前端过滤提问文本，意味着传输并保留数十至数百 MB，还要让每个已渲染节点的状态常驻内存，只为回答一个答案总量仅几 KB 的查询。用户对内存与 CPU 的担忧是成立的；这里的比例大约是三到五个数量级。

上限在完整结果已知处施加，符合 `packages/AGENTS.md`（"Apply bounds to the complete result"）：页大小界定条目数，`snippetChars` 界定每条摘要，因此发出的值在两个维度上都有界，而非只有单条有界。

### 入口是它自己的按钮

此前搜索只能通过从刻度条打开面板抵达，这使它成为一个靠探索才能发现的模式。现在它是导航箭头旁的常驻按钮，无需 hover 即可见，符合需求的明确要求。在这条线上刻度条本身已不存在——[轨道精简为步进](2026-09-02-question-rail-reduced-to-stepping.zh.md)删除了所有重绘提问索引的表面，并点名常驻入口按钮是把搜索带回来的方式——因此这个入口是轨道上除箭头外唯一的控件，它打开的面板只在被请求时列出提问。

`onLoadAll` 与 `chat.questions.loadAll` 当时是被移除而非修复的：有了全会话搜索，找到某个提问不需要加载全部提问。后来一个明确的全历史加载作为独立操作回归——为了阅读，而非查找——见[提问面板提供加载全部历史](2026-09-18-question-panel-load-all-history.zh.md)。

## 备选方案

**按需求字面所述，新增一个只返回提问文本的 host 方法** —— 否决，因为 `SessionQueryEngine.searchEvents` 在 `type`/`surface` 过滤下返回的正是这个。按 `packages/AGENTS.md`，新增公开方法需要证据表明既有方法无法服务该消费者，而上文的表格正是"它可以"的证据。第二个方法还会把会话内搜索拆到两个入口，而它们必须对"什么是提问"保持一致。

**复用既有的 `session.search` wire 操作**以避开有争议的文件 —— 在冲突成为因素之前就已基于实质理由否决。它的载荷是 `{ query }`，没有会话 id；结果是 `{ sessionId, snippet }`，没有 `seq`，因此既不能限定会话，也无法定址跳转。扩宽它还会改变侧边栏跨会话搜索的返回内容。

**让 `onLoadAll` 名副其实——带进度与可中断地翻完整个会话** —— 作为主要修复方案否决，该按钮被直接移除。它正是本设计要避免的内存代价（见上文量化），而在有了全会话搜索之后它一无所值：读者想找到某个提问，而不是持有全部提问。保留一个诚实但仍是错误操作的按钮，等于保留该缺陷的形态。

**在 wire 落地前，客户端先禁用搜索** —— 否决，因为这是用一个不可见的限制换掉一个可见的限制。`window-only` 会展示它能找到的匹配，并说明它没搜什么；而隐藏入口会让读者以为该功能不存在，一个静默过滤窗口的入口则就是最初那个 bug。

**搜索失败时回退为过滤已加载窗口** —— 否决，因为该回退与成功无法区分。读者会看到一个看似合理的短列表，却完全没有迹象表明整个会话从未被查询——而这恰恰是本 Note 要消除的错误类别。

## 后果

- 导航器不再能报告一个它未曾验证的全会话否定结论。九条组件测试钉住这些状态区分。
- `QuestionNavigator` 的 props 发生变化：`onLoadAll` 与 `loadingOlder` 移除，由 `onSelectSeq` 与可选的 `searchQuestions` 取代。
- 未组合 `searchQuestions` 的部署运行在 `window-only`：搜索结果来自已加载窗口，并如实说明。这是一个**可见且诚实**的限制，而非静默的限制。
- `.questionLoadAll` 一度失去渲染方，直到明确的全历史加载重新使用它（[笔记](2026-09-18-question-panel-load-all-history.zh.md)）。

## 后续工作

本记录推迟的 wire 绑定已按所述落地，本设计未作任何改动：[接通提问索引](2026-09-14-question-search-wire.zh.md)。
