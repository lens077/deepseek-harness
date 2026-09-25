# Agent Note: 会话阅读宽限期与监看保留

Status: implemented

[English](2026-09-26-session-reading-grace-research.md) | 中文

## 问题

导航不能证明用户读过回答或完成了工作审阅。误开即消耗关注状态会丢失提醒；打开运行中会话就移除它，会丢失监看入口。未读内容接触、监看列表成员资格与任务完成需要分别决定。

## 决策

通过点击或快捷键[打开置顶区行](../../../../packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx)只执行导航，既不移除自动成员，也不改变手动置顶。明确取消置顶仍沿用原有移除语义。[已完成成员](../../../../packages/client/ui-digest/src/client/select.ts)在现有审阅时间窗内同时包含未读与已读未处理的工作；标为已查看不等于已处理或取消置顶。

`ui-digest` 的[设置](../../../../packages/client/ui-digest/src/nav-settings.ts)拥有 `readAcknowledgement`（默认 `automatic`，也可选 `manual`）与 `readGraceSeconds`（1–60 的整数，默认 **5 秒**）。五秒是防误开的产品启发式规则，不是由论文推导的阅读时长。自动确认要求权威设置和收件箱状态都已就绪；设置加载中或不可用时，绝不启用默认自动确认。当前会话标题栏在两种模式下都为未读的已完成回答提供**标记已查看**；只要收件箱已就绪，该动作就不依赖设置是否可用。

`ui-chat` 发布只读的 `chatReplyExposure` 可观察源，内容为 `{sessionId, seq}` 或 `null`。只有最新轮次中已落定的最终回答才符合条件，且该轮次必须已完成。[内容接触测量](../../../../packages/client/ui-chat/src/client/chat/reply-exposure.ts)要求文档可见、浏览器有焦点，且回答在裁剪祖先范围内露出可读片段，采样点命中该回答而非应用内覆盖层。仅思考内容或裁剪后的细小边缘不符合条件。静态阅读不需要持续移动鼠标或滚动，也不要求整篇回答同时出现在屏幕上。

[ReadingGrace](../../../../packages/client/ui-digest/src/client/reading-grace.ts)为所选未读回答计算一次连续区间。切换所选会话、失去焦点、切到后台、不再满足内容接触条件、待处理交互、回答不同，或确认模式、时长、就绪状态变化都会取消或重置计时；短暂访问不会累计。[确认写入器](../../../../packages/client/ui-digest/src/client/index.ts)在推进持久化的 `lastSeenSeq` 前重新检查具体的已完成回答序列。持久化的已查看或已处理标记会消耗匹配的临时完成提醒，包括来自另一浏览器的确认。

[会话选择](../../../../packages/api/session-controller/src/client/sessions/manager.ts)保留临时提醒。每次观测到从运行变为空闲都会设置提醒，包括当前选中的会话；`acknowledgeCompletion` 立即移除提醒，并在微任务中批量通知订阅方。此行为不引入模型输入、会话日志事件或持久收件箱 schema 迁移。

每次 Host `api-session/status` 状态变化都必须携带完整的通用投影基线。配套 Client 在应用运行状态和设置提醒之前，按较高序列优先规则载入基线，避免延迟的控制消息把空闲状态与较旧的已查看回答组合在一起，进而消耗新提醒。这项传输要求不改变会话日志格式。

## 证据

以下一手研究探讨相关问题，并未优化未读宽限期。前两项总结依据发表页面或作者摘要，第三项依据作者手稿全文。来源核查日期为 2026-09-26。

- **Kim 等，2014，《Modeling Dwell Time to Predict Click-level Satisfaction》（WSDM）。** 页面主题、内容长度和可读性会影响与满意度相关的停留时长。论文明确质疑不考虑页面特征的单一阈值。其中的 **30 秒或更久**是对既有搜索启发式规则的描述，不是经过验证的邮件或聊天阅读延迟。[机构发表页面与摘要](https://www.microsoft.com/en-us/research/publication/modeling-dwell-time-to-predict-click-level-satsifaction/)。
- **Duggan 与 Payne，2009，《Text skimming: The process and effectiveness of foraging through text under time pressure》（Journal of Experimental Psychology: Applied）。** 在只够阅读**半篇文档**的时间内，实验 1 发现，相比阅读半篇文本，略读提高了对重要观点的记忆，却没有提高对次要细节或推论的记忆。获取大意与记住细节是不同结果。这些是说明性文本实验，不是中文、代码审阅或已读回执测试。[大学发表记录与接收稿链接](https://researchportal.bath.ac.uk/en/publications/text-skimming-the-process-and-effectiveness-of-foraging-through-t/)及 [Europe PMC 收录的作者摘要](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:19751073%20AND%20SRC:MED&format=json&resultType=core)。
- **Sarrafzadeh 等，2019，《Characterizing and Predicting Email Deferral Behavior》（WSDM）。** 研究结合了 **15 人的工作场所访谈**（部分采用情境调查），以及 **40,000 名企业用户**在**两周**内的约 **300 万次** Outlook 日志动作。用户会主动把已看过的邮件标回未读，以提醒自己还有待办工作。按日志定义，工作日中 **12% 的邮件分诊会话**、**16% 的日活跃用户**存在延期处理邮件。该定义要求在后续会话中回复、回复全部或转发，因此漏掉了仅阅读和线下跟进。样本来自企业邮件，访谈来自同一家公司，不能代表所有用户。[作者手稿全文，第 2–3 节](https://arxiv.org/html/1901.04375v1)。

## 局限

这些来源中未发现直接确定最佳未读宽限阈值的实验。它们没有验证通用的 3 秒、5 秒或 10 秒分界。停留时长可以表示接触内容的机会，不能表示注意、理解、认同或完成：前台打开的页面仍可能无人关注。滚动也不是阅读证明，包括自动滚动到底部。不能把英文散文阅读速度直接换算成中文字符或代码阅读公式。

## 考虑过的替代方案

**打开即已读并移除。** 分诊快，但导航失误会消耗提醒状态并隐藏监看工作，混淆了不同的用户意图。

**按长度计算阅读时间，或强制滚动到底部。** 两者都不能证明理解；代码、混合语言回答、自动滚动、辅助技术与选择性阅读都会使这些完成判断失准。

**所有人都只能手动确认。** 意图更明确，但给每次普通阅读增加操作。手动模式保留为选项，而非要求。

## 后果

导航后仍能访问运行监看和未完成审阅。延迟可能让快读者厌烦，也仍可能为分心用户确认已查看。共享的持久已查看标记会影响其他浏览器；明确的置顶、已处理、待办与稍后提醒动作保持独立。自动化测试没有完成针对中文、代码、长短回答、辅助技术和多窗口阅读的用户校准。相关评估结果仍是误已读、漏跟进与分诊成本，而不只是徽标减少量。

## 验证

[宽限期测试](../../../../packages/client/ui-digest/tests/reading-grace.client.spec.ts)覆盖连续计时、中断、回答或时长变化以及资源释放；[内容接触测试](../../../../packages/client/ui-chat/tests/reply-exposure.client.spec.ts)覆盖裁剪、焦点、可见性、覆盖层、排除思考内容以及观测器清理。[汇总集成测试](../../../../packages/client/ui-digest/tests/browser-plugin.client.spec.ts)、[工作区浏览器测试](../../../../packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx)与[会话管理器测试](../../../../packages/api/session-controller/tests/manager.client.spec.ts)覆盖设置就绪、具体回答确认、保留点击或快捷键目标以及临时提醒生命周期。[无需密钥的浏览器场景](../../../../apps/web/tests/session-reading-grace.e2e.ts)定义了完整组合下的延迟渲染、导航或覆盖层、手动模式以及已读未处理用例。五个[状态观测回归测试](../../../../packages/api/session-controller/tests/status-observation.client.spec.ts)覆盖控制消息延迟、保留更新的投影、陈旧列表刷新，以及区分旧回答确认与当前回答。这些具名回归测试不能证明通用的阅读时长，也不代表完整 GUI 测试全部通过。

## 相关

本决策拥有导航保留与基于内容接触的确认规则。[持久会话收件箱](2026-09-17-durable-session-inbox.zh.md)、[自动置顶](2026-09-21-pinned-area-fold-menu-and-auto-pin.zh.md)与[位置快捷键](2026-09-22-pinned-area-position-shortcuts.zh.md)记录仍分别保留存储、成员资格与移除策略、键盘绑定的设计理由；三者均仅被部分取代。
