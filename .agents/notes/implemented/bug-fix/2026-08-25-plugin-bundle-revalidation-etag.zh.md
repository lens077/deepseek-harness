# Agent Note: 插件产物重校验的实体标签

Status: implemented

[English](2026-08-25-plugin-bundle-revalidation-etag.md) | 中文

## 问题

插件产物路由此前以 `cache-control: no-cache` 且不带任何校验器，在 `/plugins` 下提供每个 `dsh.client` 产物及其 sourcemap。`no-cache` 要求复用前必须重校验，而在既无实体标签也无最后修改时间的情况下，每次重校验都是一次完整重下，该响应头的实际效果等同于 `no-store`。

Web GUI 首次加载约有 3.1 MB 插件 JavaScript，分布在约三十个产物中，每次刷新页面都会把它们全部重传一遍。经环回地址访问时这一成本不可见；而经实测到浏览器约 2.8 Mbit/s 的隧道式反向代理访问时，它占据每次刷新约两秒。

每个 URL 中已有的 rev 是构建产物的内容哈希（`shortHash`，同时也是模块图的 rev），但它无法承载长期缓存：`serveBundle` 只解析 pathname 而忽略 query，因此过期的 `?rev=` 仍会返回当前字节——而 HMR 恰恰依赖这一点，因为重新构建后加载器缓存的模块图 rev 会过期，预取仍须抵达宿主。

## 决策

产物与 sourcemap 响应保持 `no-cache`，并额外携带一个按所提供字节哈希得出的实体标签（`packages/client/modules/src/index.ts:561`）。`if-none-match` 与该标签匹配的请求会收到无响应体的 304，其中携带相同的 `cache-control` 与 `etag`（`:562-565`）；其余请求照旧收到完整的 200，标签与既有响应头并列。重新构建会改变字节，标签随之改变，下一次重校验即传输新产物。

该校验器按请求从处理器已读入的缓冲区计算，因此该路由不引入缓存、不引入失效状态，也不依赖注册表的 rev 记账。

## 后果

- 重复加载传输的是 304 响应头而非约 3.1 MB；首次加载不受影响。
- HMR 语义不变：每次加载仍然重校验，过期的 `?rev=` 仍然抵达宿主，重新构建的产物仍然返回 200。
- 在会压缩响应的反向代理之后，标签随源站响应一同传递，由代理协商编码，因此浏览器针对该标签存储一份已编码副本，其重校验仍以 304 结束。
- 每次重校验在宿主侧多付一次对产物的 sha1，换取它所替代的那次传输。
- `packages/client/modules/tests/node-half.client.spec.ts` 钉住全部三个分支：200 携带确切标签、匹配的 `if-none-match` 得到无响应体的 304、重新构建改变标签并重新发送响应体。

## 考虑过的替代方案

- **以 URL 中已有的内容哈希 rev 为键，配合长 `max-age` 使用 `immutable`**——否决：`serveBundle` 忽略 query，对任何 rev 都提供当前文件，而这正是 HMR 得以从过期模块图 rev 中恢复的机制。遵守 `immutable` 的浏览器会持续从缓存重放重新构建之前的产物，破坏热替换。
- **使用 `last-modified` 配合 `if-modified-since`**——否决：修改时间比字节更粗糙，且在「重新构建后内容完全相同」或「检出重写时间戳」的情况下并不可靠，而产物哈希已经是本仓库对客户端产物的身份标识。
- **复用预先算好的模块图 rev 作为标签，而非按请求哈希**——否决：该 rev 由 HMR 监视钩子刷新，可能滞后于磁盘上的文件，而 sourcemap 根本没有 rev；对刚读入的字节做哈希对两种响应都是精确的。

## 相关

同一次调查还度量并否决了一项更大的载荷削减，参见[从 session.history 页面中过滤已被取代的 assistant 分片](../../rejected/architecture/2026-08-25-history-page-chunk-filtering.zh.md)。
