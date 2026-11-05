ANNOTATIONS = [
    (1, 'before', '''文件级批注：`upstreamproxy.ts` 是 CCR 会话容器侧的代理接线模块。它读取会话令牌、屏蔽自身可被 dump、下载代理 CA 证书、启动本地 CONNECT 转 WebSocket 中继，并向所有子进程注入代理环境变量。每一步都「失败开放」，绝不让坏掉的代理配置中断正常会话。'''),
    (29, 'after', '''依赖引入：fs/promises、os、path，以及清理注册、调试日志、环境变量与错误工具，还有本地中继 `relay.js`。'''),
    (63, 'after', '''`NO_PROXY_LIST`：列出代理绝不拦截的地址（回环、RFC1918、IMDS、Anthropic API 与各包 registry），并用三种写法覆盖不同运行时的 NO_PROXY 解析差异。'''),
    (69, 'after', '''`UpstreamProxyState` 与模块级 `state`：记录代理是否启用、端口与 CA 包路径。'''),
    (153, 'after', '''`initUpstreamProxy`：初始化入口（从 `init.ts` 调用一次）。按环境变量逐层开关决定是否启用，读取会话令牌、屏蔽自身可 dump、下载 CA 并启动本地中继，最后删除令牌文件。'''),
    (199, 'after', '''`getUpstreamProxyEnv`：为所有子进程合并代理环境变量。禁用时若继承到父进程的 HTTPS_PROXY 与 SSL_CERT_FILE 则透传，否则一律返回空。'''),
    (218, 'after', '''`readToken`：读取并裁剪会话令牌文件，缺失时静默返回 `null`。'''),
    (252, 'after', '''`setNonDumpable`：通过 libc FFI 调用 `prctl(PR_SET_DUMPABLE,0)`，阻止同 UID 的 ptrace 抓取堆里的令牌；仅 Linux 加 Bun 生效。'''),
    (285, 'after', '''`downloadCaBundle`：下载 CCR 的 CA 证书并与系统 CA 包拼接写入本地，失败则记录警告并禁用代理。'''),
]
