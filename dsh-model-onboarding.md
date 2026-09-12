---
name: dsh-model-onboarding
layer: harness-framework
description: DSH 新模型接入操作手册；覆盖目录声明、GPT 长上下文、自动压缩阈值、默认模型切换与在线验收
---

# DSH 新模型接入

**新增、升级或切换 DSH 模型前，先读本文并按顺序执行。** 本文适用于模型尚未进入 DSH 内置 catalog，或当前提供方在 `$DSH_HOME/settings.yaml` 中显式维护 `models` 列表的情况。

## 1. 先确定四项事实

从模型官方文档或已验证的上游配置中取得：

1. 提供方与精确模型 ID，例如 `openai/gpt-6-astra`。
2. 上下文窗口 `contextWindow`。
3. 最大输出 `maxTokens`。
4. 输入模态和推理档位。

如果 DSH 通过代理访问模型，再确认代理实际接受该模型 ID。先做一次最小调用；调用成功只证明路由可用，不代表 DSH 已有正确的容量元数据。

不得把 API 密钥、Bearer Token 或凭据文件内容写入仓库。DSH 配置只引用 `apiKeyEnv`；沿用已有提供方时，不新增凭据。

## 2. 识别现有集成方式

读取 `$DSH_HOME/settings.yaml`，找到 `llm-pi-ai.providers.<provider>`。

- 提供方已有显式 `models` 列表：在该列表追加模型。这个列表会替换内置 catalog，不要为了新增一个模型删除旧条目。
- 提供方没有 `models` 列表，且新模型已在内置 catalog：优先直接使用 catalog，不复制模型元数据。
- 提供方没有该模型且需要手工声明：可在模型设置页添加自定义提供方，或为现有提供方补完整 `models` 列表。补列表前先保留当前仍需使用的全部模型。

现有手工模型是模板，不是可整段复制的协议契约。只复制通用字段；`compat` 属于协议和端点，必须逐项判断。例如 Anthropic 模型的 `forceAdaptiveThinking` 不能复制给 OpenAI Responses 模型。

## 3. 添加模型元数据

手工模型至少声明 ID、名称和容量。视觉或推理能力也必须显式声明，否则 DSH 会把未知模型当作纯文本、无推理档位模型。

```yaml
llm-pi-ai:
  providers:
    openai:
      apiKeyEnv: OPENAI_API_KEY
      models:
        - id: MODEL_ID
          name: DISPLAY_NAME
          contextWindow: CONTEXT_WINDOW
          maxTokens: MAX_OUTPUT_TOKENS
          input:
            - text
            - image
          reasoningEfforts:
            low: low
            medium: medium
            high: high
            xhigh: xhigh
            max: max
```

只声明端点实际支持的模态和推理档位。模型不支持关闭推理时，不添加 `off`。OpenAI 的工具型 GPT 模型优先使用现有 `openai` catalog 路由，使 DSH 继续采用 `openai-responses`；不要因为模型较新就退回 Chat Completions。

## 4. 配置 GPT 长上下文与自动压缩

GPT/Codex 的以下两个配置含义不同：

```toml
model_context_window = 1000000
model_auto_compact_token_limit = 300000
```

在 DSH 中：

- `model_context_window` 对应模型的 `contextWindow`。
- `model_auto_compact_token_limit` 不对应 `maxTokens`。`maxTokens` 是单次模型输出上限。
- `compaction-basic` 使用 `floor(contextWindow × thresholdRatio)` 作为自动压缩阈值。

换算公式：

```text
thresholdRatio = model_auto_compact_token_limit / model_context_window
```

例如 `300000 / 1000000 = 0.3`。为避免影响其他模型，在 Agent preset 中添加精确模型策略：

```yaml
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'
      config:
        modelPolicies:
          - provider: openai
            model: MODEL_ID
            thresholdRatio: 0.3
```

`retainRatio` 默认为 `0.16`，必须小于 `thresholdRatio`。若新阈值不大于 `0.16`，同时为该模型设置更小的 `retainRatio` 或合法的 `retainTokens`。

Web 模式的压缩插件位于 Agent preset 内，不在 host 顶层。需要专属阈值时，复制当前 preset 到 `$DSH_HOME/.agent-presets/<new-id>/`，只修改副本，然后通过 `agent-presets.default` 设为新会话默认值。不要修改安装目录中的 shipped preset；升级会覆盖它。

```yaml
agent-presets:
  default: NEW_PRESET_ID
```

## 5. 切换默认模型

在 `$DSH_HOME/settings.yaml` 设置新会话默认值：

```yaml
agent-default-model:
  provider: openai
  model: MODEL_ID
  reasoningEffort: max
```

模型与默认 preset 设置可热加载，并作用于随后创建的会话。已有会话保留其模型选择和创建时挂载的 preset；需要立即使用新模型时，在当前会话的模型选择器中切换。需要新压缩策略时，创建使用新 preset 的会话。

## 6. 验收

按以下顺序验证，前一步失败时先停止，不要把未验证模型设为默认值：

1. 解析 `$DSH_HOME/settings.yaml` 和新 preset 的 YAML。预期结果：无语法错误。
2. 对上游发起最小模型调用。预期结果：响应明确显示目标模型 ID，且返回正常内容。
3. 读取 DSH 的模型目录。预期结果：提供方下存在新模型、推理档位正确、`failures` 为空。
4. 创建一个临时空会话并挂载新 preset。预期结果：创建成功，当前模型是目标模型；验证后删除临时会话。
5. 将当前会话切到新模型，或创建新会话发送最小提示。预期结果：`request/header` 记录目标 provider/model，`request/context.contextWindow` 等于配置值。
6. 检查新 preset 的 `thresholdRatio × contextWindow`。预期结果：计算值等于目标自动压缩阈值。

至少保留旧模型条目作为回退，直到 DSH 真实请求通过。上游调用成功但提示「model metadata not found」时，说明路由可用但客户端 catalog 未更新；DSH 仍需手工声明 `contextWindow`、`maxTokens`、输入模态和推理档位。

## 7. 常见失败

| 现象 | 判断与处理 |
|---|---|
| `UNKNOWN_MODEL` | 新模型未进入当前 provider 的有效模型列表；检查显式 `models` 是否覆盖了 catalog。 |
| 模型可调用，但 DSH 显示无图片或无推理档位 | 手工模型缺少 `input` 或 `reasoningEfforts`。 |
| GPT 工具调用失败 | 确认路由采用 `openai-responses`；新工具型 GPT 不应默认按 Chat Completions 接入。 |
| 自动压缩在错误位置触发 | 重新计算 `thresholdRatio`；不要把自动压缩阈值写入 `maxTokens`。 |
| 修改压缩配置后旧会话无变化 | 旧会话已挂载原 preset；创建使用新 preset 的会话。 |
| 新 preset 无法挂载 | 检查 `modelPolicies` 的 provider/model 是否精确匹配，并确认 `retainRatio < thresholdRatio`。 |
| CLI 调用成功但警告缺少模型元数据 | 客户端 catalog 落后；调用成功不等于上下文窗口和压缩阈值正确。 |

## 完成条件

只有同时满足以下条件，才算完成一次新模型接入：上游最小调用成功；DSH 模型目录无失败；新会话解析到正确 provider/model、上下文窗口和推理档位；专属自动压缩阈值换算正确；旧模型仍可作为回退；仓库中没有新增凭据。
