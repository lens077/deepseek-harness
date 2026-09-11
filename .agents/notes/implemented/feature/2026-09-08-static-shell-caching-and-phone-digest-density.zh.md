# Agent Note: Static shell caching and phone digest density

Status: implemented

[English](2026-09-08-static-shell-caching-and-phone-digest-density.md) | 中文

## Problem

手机经隧道访问公网 `dsh web` 部署时，每次刷新都要完整下载壳：`dsh-host-frontend-static` 提供 Vite 输出时不带 `Cache-Control`、`ETag` 或 `Last-Modified`，浏览器对 1.2 MB 的 `index` 与 `vendor` chunk 既没有新鲜期也没有验证器，而旁边的插件 combo 脚本早已是 immutable。同一部手机上，digest 面板的待办行高度翻倍，因为每个行内操作都继承了 44px 的 chrome 控件尺寸；小布局的底栏隐藏了标签，总览与待处理两个入口却画着同一个清单图标。

## Decision

`serveStatic` 对每个 200 响应分类。文件名匹配 Vite 的 `-<8 位 base64url 哈希>.<ext>` 命名的文件为 `public, max-age=31536000, immutable` 且不带验证器：URL 就是内容身份，刷新永远不再询问它。渲染后的 index 为 `private, no-cache`，其余未哈希文件为 `no-cache`；两者都带强 `ETag`（响应字节的 sha1，base64url），`If-None-Match` 匹配时（弱或强、列表中任一成员）对 GET 与 HEAD 回答空 304。Index 的 tag 在注入渲染与转换器之后计算，因此改变启动图的 Host 重启会让页面失效，而哈希后的壳资产保持缓存。真实组合测试以 gzip 开启、阈值 0 运行 webserver，证明验证器能穿过交付组合包使用的压缩中间件。

Digest 面板的手机媒体查询给行内操作（`.action`、`.openSession`）单独的 `--dsh-digest-action-size`（36px，小布局 32px），而不是标签页、chip 与关闭按钮保留的 44px `--dsh-mobile-control-size`；待办行降为 6/8px 的上下内边距，文本行与换行后的操作行之间用布局的行间距。手机底栏的总览入口改用 `IconGaugeOutline16`；待处理入口保留宽侧栏入口所用的 `IconChecklistOutline14`，面板 spec 断言两个图标不同。

## Alternatives considered

**带 precache 或 stale-while-revalidate 的 service worker。** 它还能覆盖离线打开，但会引入第二套安装与更新生命周期，需要构建期生成所有资产的 manifest，还要和已认证的 index 与 HMR 版本化的插件图打交道。正确的 HTTP 缓存已经把一次刷新压缩为 index 的一个 304 加每个未哈希文件的一个条件请求，这就是手机需要的增量更新。

**基于 stat 的弱验证器（`Last-Modified`、size+mtime ETag）。** 它们省去 304 前读取并哈希正文，但渲染后的 index 没有文件身份，隧道前置的部署也可能经过改写弱 tag 的代理。未哈希集合只有四个小文件；逐请求哈希它们的代价小于移动链路上多一次往返。

**启动时哈希插件 combo 版本，让那些 URL 也能跨重启存活。** 批次 URL 已经按内容寻址；只有例外的单插件 URL 使用进程 nonce，且[装载模型笔记](../architecture/2026-07-23-client-plugin-loading-model.zh.md)刻意保持启动期不哈希。

**在小布局缩小 `--dsh-mobile-control-size`。** 那会缩短每个手机控件，包括标签栏、关闭按钮与每行一个、受益于更大目标的 chip。只有位于用户已读文本之下的操作需要更短的尺寸。

**在小布局图标下显示标签。** 小布局存在的意义是把高度还给会话；不同的图标保住了这份预算。

## Consequences

回访的手机只重新下载字节变化的文件；新构建会改变哈希 URL 与 index 的 tag，因此不会复用任何过期内容。Index 与未哈希文件在每次请求（包括 304 路径）都会被读取并哈希。手机上的待办与收件箱行内操作短于 44px 的平台目标；标签栏与 chip 保留它。frontend-static 的真实组合测试负责缓存头、条件 GET／HEAD 的 304、字节变化后的重新打 tag 与 gzip 交互；digest 面板 spec 负责底栏图标的区分。

## Related

`/plugins` 下的插件 combo 路由在[插件 bundle 重验证的实体标签](../bug-fix/2026-08-25-plugin-bundle-revalidation-etag.zh.md)中对自己的字节做了同样的重验证选择；本笔记覆盖回退席位提供的 Vite 壳文件。
