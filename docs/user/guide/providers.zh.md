# 配置模型

[English](providers.md) | 中文

本指南假定你已按照[根 README](../../../README.zh.md#run)启动 Web UI。模型变更会在下一次请求时生效，不需要重启服务器。

## 配置 DeepSeek

打开**设置 → 模型**。DeepSeek 卡片提供一个 API 密钥字段；输入密钥并保存。

![模型页：DeepSeek 卡片，以及添加提供方与添加自定义提供方两个入口](providers-models-page.zh.png)

密钥是只写的。保存后，页面只会收到脱敏描述符，永远不会收到明文密钥。密钥存储在 `$DSH_HOME/.credentials.yaml` 中，settings 只保留它的凭据引用。

## 添加内置提供方

选择**添加提供方**，选取 dsh 自带的提供方；列表显示的是提供方 id，例如 `anthropic`、`openai`、Kimi 对应的 `moonshotai`、GLM 对应的 `zai`。输入其 API 密钥并保存。已安装目录会提供端点、协议和模型列表。

通过 OAuth 登录的提供方（例如 Codex）暂不支持。

## 添加自定义提供方

对于公司网关、自建服务器或已安装目录中不存在的提供方，选择**添加自定义提供方**。提供小写 Provider ID、基础 URL、API 协议、凭据和至少一个模型。**API 协议**必须选网关实际使用的那一种，表单提供三种：`openai-completions` 对应 OpenAI Chat Completions，`openai-responses` 对应 OpenAI Responses API，`anthropic-messages` 对应 Anthropic Messages API。一个提供方只使用一种协议，网关同时提供两种时需要建两个提供方。

![自定义提供方表单：Provider ID、显示名称、API 地址、API 协议、API 密钥](providers-custom-form.zh.png)

Provider ID 是永久的，因为请求、已保存会话、模型默认值和凭据引用都会使用它。如需重命名提供方，请添加新提供方并删除旧提供方。显示名称、基础 URL、协议、凭据和模型仍可编辑。

### 探测模型

在**模型目录**中选择**获取可用模型**，即可询问端点它提供哪些模型。请求使用表单当前的 API 地址、协议和密钥，已保存的提供方则用已存储的密钥；响应会打开一个可搜索的选择框，搜索、勾选想要的模型，再点**添加所选**。保存或创建提供方之前不会存储任何内容。

探测读取的是常见网关公开的列表格式，但并非每个端点都用这些格式作答，所以它只是便利手段而非保证：探测失败或列表为空时，手动添加模型 ID 即可，效果完全一样。内置提供方一律由已安装目录作答，即使其 API 地址指向网关也是如此，要查看网关实际提供的模型，请通过自定义提供方探测。

## 选择模型

已配置的提供方会出现在模型选择器中。选择模型也会将其设为新会话的默认值。已发送过请求的会话会保留自身日志中记录的模型。

如果已保存默认值指向已删除的提供方，输入框会显示**选择模型**，并在选择其他模型前阻止输入。

## 进阶配置

自动生成的[插件配置目录](../../config-catalog.zh.md)列出每个插件的所有受支持字段与默认值；[`dsh-llm-pi-ai`](../../config-catalog.zh.md#deepseek-aidsh-llm-pi-ai) 就是本页所配置的那个提供方段落。[`dsh-llm-pi-ai`](../../../packages/llm/llm-pi-ai/README.zh.md) 和 [`dsh-llm-deepseek`](../../../packages/llm/llm-deepseek/README.zh.md) 参考文档负责直接 `settings.yaml` 配置、目录解析、推理控制、凭据与适配器错误。

::: tip 表单刻意保持精简
模型页只开放让一条路由得以存在的字段：API 密钥、显示名称、API 地址、API 协议，以及每个模型的 ID、显示名称、上下文窗口和最大输出 token 数。其余所有字段——推理等级、图片输入、请求兼容性开关、请求头、超时、重试策略——都在 `$DSH_HOME/settings.yaml` 中设置，也就是模型页写入的同一份文档。可以直接编辑它；浏览器与服务器在同一台机器时，也可以点击设置页顶部的**打开配置文件**打开它。适配器会在下一次请求时重新读取，无需重启任何东西。下面各小节介绍多数网关会用到的字段。
:::

<a id="image-input"></a>
### 图片输入

手动输入的模型在自己声明之前一律按纯文本对待，因为没有任何环节能去询问端点接受哪些模态。给这类模型附加图片，会在发送前就被拒绝，并点名该模型。

因此自定义提供方下的视觉模型需要加一行。表单没有对应字段；请在 `$DSH_HOME/settings.yaml` 中给该模型加上 `input`：

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: legacy-chat
        - id: vision-preview
          input: [text, image]
```

`input` 接受 `text` 和 `image`，且只作用于该模型，因此一条路由可以同时服务两类模型。省略它——或写成空列表，两者同义——则保留已安装目录为该模型记录的模态；目录未描述的模型则回退到该路由的 `defaultInput`。

如果你手动录入的模型全都接受图片，可以在路由上设置一次回退值，不必逐个模型写：

```yaml
llm-pi-ai:
  providers:
    vision-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://vision.example/v1
      defaultInput: [text, image]
      models:
        - id: first-model
        - id: second-model
```

`defaultInput` 是回退值而不是覆盖值，默认为 `[text]`：在内置提供方上，它只为其目录未描述的模型作答，因此绝不会把目录中本就具备图片能力的模型的该能力去掉。要收窄这类模型，请用它自己的 `input`。内置提供方没有可供填写的 `models` 列表，因此写在 `modelOverrides` 下，以模型 id 为键：

```yaml
llm-pi-ai:
  providers:
    anthropic:
      modelOverrides:
        claude-sonnet-4-5:
          input: [text]
```

除模型自身的列表外，每个列表都至少要写一项模态；模型自身的空列表与省略它同义。未知模态在任何位置写入都会被拒绝。

这两个字段都是对你端点的断言，而不是对它的检查。声明了端点并不提供的图片能力的模型不会在这里被拦下，改由提供方拒绝该请求。

### 推理等级

对于声明了推理等级的模型，模型选择器会提供**推理等级**菜单。内置提供方的模型从已安装目录继承其等级。手动录入的模型不声明任何等级，因此模型菜单里不会出现推理等级项，由端点自身的默认值决定模型是否思考。请在 `$DSH_HOME/settings.yaml` 中用 `reasoningEfforts` 声明等级：

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      reasoning: high
      models:
        - id: my-reasoner
          reasoningEfforts:
            off:
            high: high
            max: max
```

每个键都是菜单提供的一个等级，其值是在协议上以 `reasoning_effort` 发送的写法，因此 `max: xhigh` 可以为自有一套词汇的网关重命名某个等级。只有 `off` 可以留空，因为对多数端点来说，不思考就是不传该参数。路由的 `reasoning` 是会话尚未选择等级时采用的等级；在选择器中选定某个等级后，它会与模型一起保存为新会话的默认值。

留空的 `off` 什么都不发送，这只能让「按请求才思考」的模型停下来；给 `off` 一个值，则会把该值作为 `reasoning_effort` 发送。对于「不明确关闭就会思考」的模型——例如 OpenAI 兼容网关后面的 DeepSeek V4——需要 `compat.thinkingFormat: deepseek`：它让 `off` 发送 `thinking: {type: disabled}`，其他每个等级则在 effort 之外再发送 `thinking: {type: enabled}`：

```yaml
      models:
        - id: deepseek-v4-pro
          compat:
            thinkingFormat: deepseek
          reasoningEfforts:
            off:
            high: high
            max: max
```

网关并不提供推理能力的内置提供方模型，可在 `modelOverrides` 下用 `reasoningEfforts: false` 去掉其等级；之后再为它选择等级会被拒绝并报 `UNSUPPORTED_REASONING_EFFORT`。DeepSeek 自身的路由不需要以上任何配置：其模型已经提供 `off`、`low`、`high` 和 `max`，`llm-deepseek.reasoningEffort` 设置选择器的起始默认值：

```yaml
llm-deepseek:
  reasoningEffort: max
```

<a id="claude-model-onboarding"></a>
### Claude：添加 Anthropic 模型

Claude 原生路由使用 `anthropic-messages`，通常复用已有的 `anthropic` 提供方。通过代理接入时，先确认代理接受精确模型 ID，再从上游文档或已验证配置取得上下文窗口、输出上限、输入模态和推理档位。最小调用成功只能证明路由可用，不能证明容量元数据正确。

#### 1. 保留现有提供方和模型

读取 `$DSH_HOME/settings.yaml` 的 `llm-pi-ai.providers.anthropic`。如果已有显式 `models` 列表，就向原列表追加条目，保留仍需使用的旧模型；这个列表会替换内置目录，而不是追加到目录。没有显式列表且内置目录已包含目标模型时，直接使用目录；只调整已知模型时可用 `modelOverrides`，但它不能与 `models` 同时配置，也不能用于添加目录未知的模型。

沿用已有的 `baseURL` 和 `apiKeyEnv`。首次接入时，通过**设置 → 模型 → 添加提供方 → anthropic**配置凭据；自定义路由则选择 `anthropic-messages`。`apiKeyEnv: ANTHROPIC_API_KEY` 是凭据引用，不是密钥值，不要把密钥或 Bearer Token 写进文档、仓库或模型条目。

#### 2. 声明 Claude 模型能力

下面以 `claude-fable-5-1` 为例，假定端点支持 1M 上下文、128K 输出、图片输入以及列出的自适应推理档位。这些是示例配置，不是所有 Claude 模型的统一规格；应用前按端点能力调整。已有配置时只合并所需字段和模型条目，不要整段覆盖设置文件：

```yaml
llm-pi-ai:
  providers:
    anthropic:
      api: anthropic-messages
      apiKeyEnv: ANTHROPIC_API_KEY
      models:
        - id: claude-fable-5-1
          name: Claude Fable 5.1
          contextWindow: 1000000
          maxTokens: 128000
          input: [text, image]
          reasoningEfforts:
            low: low
            medium: medium
            high: high
            xhigh: xhigh
            max: max
          compat:
            forceAdaptiveThinking: true
```

只声明端点实际支持的能力；不支持关闭推理时，不添加 `off`。`forceAdaptiveThinking: true` 仅用于端点支持自适应推理、需要显式启用该协议行为的模型；它让选定推理等级的请求使用 `thinking.type: adaptive` 和 `output_config.effort`。不要给所有 Claude 模型一律添加它，也不要将这个 Anthropic 专属开关复制到 GPT 的 `openai-responses` 或 `openai-completions` 路由。

#### 3. 验证后再切换默认模型

先检查 YAML 可解析，再验证上游最小调用、DSH 中的模型条目、图片能力与推理档位。用新会话发送最小提示，并确认会话日志的 `request/header` 是目标 provider/model，`request/context.contextWindow` 与配置一致；如果使用图片或工具，还要验证相应请求成功。完成前保留旧模型作为回退，不要先切换默认值再排查失败。

验证通过后，可在模型选择器中选择 Claude 和所需推理等级，或合并以下新会话默认设置。`high` 只是此示例的选择；使用 `max` 前确认端点和模型声明都支持它：

```yaml
agent-default-model:
  provider: anthropic
  model: claude-fable-5-1
  reasoningEffort: high
```

模型配置会在下一次请求时重新读取；修改全局默认值不会替换已有会话的模型选择。在已有会话中需要使用 Claude 时，显式通过该会话的模型选择器切换。

#### 4. 单独核对自动压缩

`maxTokens` 是输出上限，不是自动压缩阈值。没有精确模型策略覆盖时，1M 窗口按后端默认 80% 在 800K 测量压力触发压缩；Astra 的 90% 策略不会自动套用到 Claude。需要专属阈值时，在自定义预设中为精确的 `anthropic/<模型 ID>` 配置 `thresholdRatio = 目标阈值 / contextWindow`，并保持 `retainRatio < thresholdRatio`；也可改用小于触发阈值的 `retainTokens`。

Web 的压缩引擎属于会话预设。自定义时先复制现有预设到用户预设目录 `$DSH_HOME/.agent-presets/`，再修改副本并创建使用该预设的新会话；不要直接修改安装目录中的随包预设，升级会覆盖它。预设的复制、默认选择和生效规则见[预设参考](../../../packages/preset/agent-presets/README.zh.md)。

<a id="astra-long-context"></a>
### GPT-6 Astra：1M 上下文与 900K 压缩阈值

DSH 使用自己的模型设置，不读取 Codex 的 `-c` 参数或 `config.toml`。如果端点支持 1,000,000 token 窗口和 `max` 推理等级，请将以下字段合并到 `$DSH_HOME/settings.yaml` 中已有的 `openai` 模型条目，保留端点、凭据引用、其他模型及额外推理等级：

```yaml
llm-pi-ai:
  providers:
    openai:
      models:
        - id: gpt-6-astra
          contextWindow: 1000000
          maxTokens: 128000
          input: [text, image]
          reasoningEfforts:
            high: high
            max: max
agent-default-model:
  provider: openai
  model: gpt-6-astra
  reasoningEffort: max
```

上下文仪表和模型请求准备从下一次请求开始使用 `contextWindow`。Responses API 发送 `reasoning.effort: max`；Chat Completions 发送 `reasoning_effort: max`。`maxTokens` 是输出上限，不是上下文窗口；适配器可能根据剩余容量降低输出上限。声明 1M 不会授予端点权限，也不能证明端点的实际容量。

[基础组合包](../../../packages/bundle/base/README.zh.md)和[标准、Cordis、PTC 预设](../../../packages/preset/agent-presets/README.zh.md)在 `compaction-basic.modelPolicies` 中为精确路由 `openai/gpt-6-astra` 设置 `thresholdRatio: 0.9`。窗口为 1M 时，`floor(1000000 * 0.9)` 得到 900,000 token 的测量压力触发阈值；其他路由保留默认 80%。这是该窗口下所需压缩限制的 DSH 对应配置，不是独立的绝对上限：修改窗口也会改变阈值。提供方确认上下文溢出时，恢复机制可以提前触发压缩。

预设策略变更对新组装的 agent 生效。已驻留的 agent 保留其预设代次；刷新浏览器或发送下一轮消息不会更新其压缩策略。重启 DSH 后重新打开已保存的会话即可重新组装，也可以新建会话。仅修改模型容量设置不需要重启。

### 请求兼容性

网关可能持有可用的密钥、地址也通得到，却仍然拒绝每一个请求。pi-ai 依据端点的 URL 决定请求的形状——系统提示词由哪个角色承载、输出上限写在哪个字段、思考级别如何传输——而对于它无法识别的地址，会当作 OpenAI 本身来对待。多数 OpenAI 兼容网关至少会拒绝 OpenAI 所接受的某一样东西。

其中两样占了绝大多数。声明了推理能力的模型，其系统提示词会以 `role: "developer"` 发出，很多网关直接拒绝；输出上限则写作 `max_completion_tokens`，只认 `max_tokens` 的服务端会拒绝。表单里没有这两个字段；请在 `$DSH_HOME/settings.yaml` 的路由上更正：

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      compat:
        supportsDeveloperRole: false
        maxTokensField: max_tokens
      models:
        - id: my-model
```

路由的 `compat` 是其模型的默认值，模型自身的则逐字段胜出，因此更正某一个模型无需重述整条路由：

```yaml
      models:
        - id: my-model
        - id: my-reasoner
          compat:
            thinkingFormat: deepseek
```

两者都未设置的字段，沿用已安装 catalog 为该模型记录的值；catalog 也未描述的，落到 pi-ai 的检测。凡是写下的开关都要给值：冒号后留空的键（`supportsDeveloperRole:`）会被拒绝而不是被忽略，因为空值会抹掉 catalog 已知的信息，却又没有给出任何替代。任何协议都不接受的名字同样会被拒绝，报错会列出可用的那些。

每个开关归属于声明了它的那些协议，因此在某个 `api` 上合法的开关，在另一个上可能被拒绝——报错会点名该协议实际提供哪些。与上面的 `input` 一样，开关陈述的是关于你的端点的一个断言，而不是对它的检查：设置一个网关其实并不需要的开关，只是发出一个不同的请求而已。

全部开关、各自接受的取值，以及接受它们的协议，都列在[生成的 `dsh-llm-pi-ai` 配置参考](../../config-catalog.zh.md#deepseek-aidsh-llm-pi-ai)的 `PiAiCompatProfile` 之下——该参考派生自源码，因此不会落后于适配器实际接受的内容。

## 排错

- **`MISSING_CREDENTIAL`**：通过模型页存储提供方密钥，或提供被引用的环境变量。
- **`UNKNOWN_MODEL`**：选择已配置的模型，或向自定义提供方添加缺失的模型。
- **获取可用模型返回 401**：检查密钥。模型发现会调用 OpenAI 兼容的 `GET /models` 端点；对于不提供该端点的服务，请手动输入模型。
- **获取可用模型提示既没有 `data` 数组也没有 `models` 对象**：端点返回的列表格式不在探测的读取范围内。请手动输入模型。
- **密钥与地址都正确，网关却拒绝每一个请求**：它的请求形状与 OpenAI 不同。先在路由上设 `compat.supportsDeveloperRole: false` 与 `compat.maxTokensField: max_tokens`。
- **只有推理模型失败**：pi-ai 把它们的系统提示词以 `developer` 角色发出，而网关拒绝该角色。设 `compat.supportsDeveloperRole: false`。
- **手动录入的模型没有推理等级菜单**：该模型没有声明任何等级。在 `settings.yaml` 中给该模型加上 `reasoningEfforts`。
- **`off` 无法让 DeepSeek 模型停止思考**：留空的 `off` 不发送任何推理字段，默认思考的端点就继续思考。请在模型或路由上设置 `compat.thinkingFormat: deepseek`。
- **某个 compat 开关因没有值而被拒绝**：冒号后什么都没写。给它一个值，或删掉该键以沿用已安装 catalog 的值。
- **图片在发送前被拒绝**：该模型未声明图片模态。请给自定义提供方的模型加上 `input: [text, image]`；在 DeepSeek 自身的路由上，请选择声明了图片能力的模型 `deepseek-v4-flash-vision-exp`。
- **提供方拒绝了带图片的请求**：该模型声明了其端点实际并不提供的图片能力。请从授予它图片能力的那个列表中移除 `image`——可能是模型的 `input`，也可能是路由的 `defaultInput`——然后开启新会话：附加的图片会留在会话日志里，因此在会话离开它之前，同一个请求会不断重复。
