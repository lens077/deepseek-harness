# Agent Note: 跨引擎识别原生构造器

Status: implemented

[English](2026-09-05-cross-engine-native-constructor-recognition.md) | 中文

## 问题

`snapshotJsonValue()` 接受来自任意 JavaScript realm 的内建 Object 与 Array 容器，同时拒绝 class 实例和伪造 prototype。内建检查通过 constructor 名称、prototype 身份与原生函数源码识别构造器。

不同 JavaScript 引擎会以不同格式输出原生函数源码。Chromium 输出 `function Object() { [native code] }`，Firefox 则在 `[native code]` 两侧加入换行与缩进。要求与 Chromium 字符串完全一致，会把 Firefox 的所有普通对象误判为非 JSON。

Session v2 的 Assistant settlement 把 raw stream chunk 作为 JSON 对象嵌入。在 Firefox 中，打开或分页读取包含这些记录的 Session 时，`session/page` 成功后会在 Conversation assembly 中抛错。subscriber 隔离会拦住异常，但 UI 收不到任何 Chat 行，因此 **加载更早** 看起来没有反应。

## 决定

`hasIntrinsicConstructor()` 保留 constructor 名称与 prototype 身份检查。它要求精确的 `function Object() {` 或 `function Array() {` 前缀、结尾右花括号，以及只在 `[native code]` 两侧包含可选空白的函数体。

该检查接受引擎产生的空白差异，但不接受用户编写的 constructor、子类、自定义 prototype 或伪造 constructor 名称。`snapshotJsonValue()` 保留现有的无损 JSON 规则、属性单次读取遍历、分离输出与跨 realm 支持。

## 考虑过的替代方案

**要求唯一的原生函数字符串。** 不予采纳，因为 ECMAScript 不要求引擎在原生函数体中使用 Chromium 的空白格式，而 Firefox 使用另一种有效输出。

**通过 `JSON.stringify()` 与 `JSON.parse()` 往返。** 不予采纳，因为该路径会调用序列化 hook、丢弃不受支持的成员，无法保留 validator 的单次读取保证，也不能区分所有被拒绝的容器。

**接受 constructor 名为 Object 或 Array 的任意 prototype。** 不予采纳，因为用户函数可以伪造名称和 prototype 连接；原生源码检查负责把自定义容器排除在可接受 JSON 集合之外。

## 后果

Firefox 与 Chromium 接受相同的普通及跨 realm JSON 容器，因此 embedded Assistant stream 可以完成 assembly，分页历史能够到达 Chat。exotic 容器与有损值仍会被拒绝。

focused regression 只在一个 `try/finally` 内替换原生函数空白，并立即恢复 process-global 方法。Assistant stream 测试继续拒绝格式错误的 raw chunk。针对 Web profile 的真实 Firefox 运行会打开一个 79-step Session，点击 **加载更早** 后渲染历史从 98 行增长到 156 行，`session/page` 返回 HTTP 200，console 没有错误。
