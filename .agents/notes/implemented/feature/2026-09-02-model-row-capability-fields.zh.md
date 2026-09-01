# Agent Note：模型行的能力字段

状态：implemented

[English](2026-09-02-model-row-capability-fields.md) | 中文

## 问题

模型页添加 pi-ai 模型时只写 `id`、`name`、`contextWindow`、`maxTokens`。其余一切由适配器从已安装目录解析，而目录未描述的模型——比已安装 pi-ai 更新的版本，或公司网关上的模型——会被解析为纯文本、不推理。用户看到的是两个看似无关的症状：在输入框粘贴图片会退化成 `@` 文件引用，因为输入框读取的是 `inputModalities`；模型选择器不提供思考档位，因为适配器不报告 `reasoning`。两者的修复都是 `settings.yaml` 里的一行（`input: [text, image]`、`reasoningEfforts: { high: high }`），用户指南也这么写，但创建该条目的表单没有任何迹象表明需要这一行。`dsh-llm-pi-ai` 的 README 还写着输入模态不可配置，而适配器早已不是如此。

另一方面，插件贡献到设置面板的每个分区都画通用设置的齿轮，已安装视觉工具包的页面与 ui-session-files 的对话布局页只能靠文字区分。

## 决定

模型行的展开区改名为**高级**，在容量旁放两个控件。**图片输入**是一个下拉框，选项为跟随目录默认（字段缺席）、文本 + 图片（`['text', 'image']`）、仅文本（`['text']`）；下拉框无法表达的已存列表——只有 image、有重复、含未知模态——通过一个禁用选项显示为*按 settings.yaml 所写*，在用户选择真正的选项之前绝不改写。**推理**是一个下拉框，选项为跟随目录默认（缺席）、不推理（`false`）与自定义可选档位，后者按 pi-ai 的顺序展示每个档位的复选框。勾选一个档位写入其规范名称（`high: high`；`off` 不带值，即适配器的「支持，但什么都不发」），取消勾选删除该键，已有的名称保留，因此手写的 `max: ultra` 在编辑该行后仍然存在。切换到自定义档位时默认勾选 `low`、`medium`、`high`。

校验放在 `model-capabilities.ts` 并并入共享的行检查器，因此错误字段会按行点名并像错误容量一样阻止应用：`text`/`image` 以外的模态、既非 `false` 也非字典的推理值、未知档位、`off` 以外却没有名称的档位，以及只剩 `off` 的字典——与 `resolveModelReasoning` 在加载时的拒绝一致。`compat` 与改写的名称仍留在 `settings.yaml`，行内提示会说明这一点。

设置外壳再把两个注册 id 映射到图标：`vision-toolkit` 对应新增的 `IconEyeOutline16`，`conversation-layout` 对应 `IconPanelLeftOutline16`。映射保留在外壳里按 id 键控，而不是成为注册选项，因为槽位注册只携带可序列化数据，且已发布分区本就用这张 id 表。

## 考虑过的替代方案

**单个「视觉」复选框**：否决，因为 `input` 有三种含义而非两种：缺席意味着继承目录，仅文本则是收窄网关丢弃图片的目录模型的方式。复选框无法表达「继承」。

**单个「推理」复选框写入全部档位**：否决，因为手动录入的模型很少七档全有，`xhigh` 与 `max` 因模型而异，端点拒绝的档位会让请求以 `UNSUPPORTED_REASONING_EFFORT` 失败。逐档复选框让提供的集合明确可见。

**在行上编辑发送名称与 `compat`**：推迟。两者都是网关词汇，用户指南已在 `settings.yaml` 下记载；为罕见的改名给每档加一个文本框会挤满该行。

**给 `settings.section` 注册加 `icon` 选项**：暂时否决：为两行而扩大槽位注册 API，且外壳的 id 表已是既定位置。

## 验证

`provider-form.client.spec.tsx` 通过真实卡片驱动下拉框与复选框：以适配器字段值写入 `input` 与 `reasoningEfforts`，把两者恢复为缺席，如实显示手写列表，并在字典只剩 `off` 时阻止应用。`model-capabilities.client.spec.ts` 固定分类、档位切换与每一种拒绝。`settings-root.client.spec.tsx` 断言两个新 id 各画各的图标，未知 id 仍画齿轮。[配置模型](../../../../docs/user/guide/providers.zh.md#图片输入)中的截图取自构建后的 Web UI。

## 后果

自定义提供方上的视觉或推理模型在创建它的地方完成配置。设置文档的含义不变：表单写入的正是 `dsh-llm-pi-ai` 记载的字段，手工编辑的 `settings.yaml` 会读回同样的控件。行检查器在客户端复制了适配器的推理拒绝规则，这与已把 `normalizeApiKey` 镜像到客户端的源码平面切分是同一回事。
