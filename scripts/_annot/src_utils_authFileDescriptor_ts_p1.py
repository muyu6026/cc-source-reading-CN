# -*- coding: utf-8 -*-
slug = 'src_utils_authFileDescriptor_ts'
ANNOTATIONS = [
    (13, 'after', '''文件总述：在 CCR（远程 Claude）容器里，把通过文件描述符传入的 OAuth token 与 API key 落地到已知位置，供子进程按路径读取；管道 FD 无法跨 exec/tmux 边界，所以需要落盘兜底。'''),
    (23, 'after', '''三个已知位置的 token 文件路径常量：OAuth token、API key、session ingress token，统一放在 /home/claude/.claude/remote 下。'''),
    (37, 'after', '''非 CCR 环境直接返回：没有 /home/claude 目录，也没有理由把本想用 FD 避开的 token 写到磁盘上。'''),
    (43, 'after', '''同步写盘：CCR 启动期一次性写入，调用方处于同步上下文（eslint 例外已注明），目录权限 0700、文件权限 0600。'''),
    (50, 'after', '''maybePersistTokenForSubprocesses：仅当 CLAUDE_CODE_REMOTE 为真才把 token 写到已知位置，供无法继承 FD 的子进程读取。'''),
    (82, 'after', '''readTokenFromWellKnownFile：已知文件兜底读取；ENOENT 在非 CCR 环境是预期结果，静默返回 null，其它错误才记调试日志。'''),
    (97, 'after', '''getCredentialFromFd 入口：统一按「FD 优先、已知文件兜底」的顺序读取凭证，结果缓存到全局状态。'''),
    (122, 'after', '''无 FD 环境变量时（非 CCR，或子进程剥离了无用的 FD 变量）回退读已知文件。'''),
    (132, 'after', '''FD 编号非法（非数字）则报错并缓存 null，避免后续重复解析。'''),
    (166, 'after', '''getCredentialFromFd 收尾：FD 读到非空 token 则缓存并落到已知文件；读取失败也回退到已知文件兜底。'''),
    (181, 'after', '''getOAuthTokenFromFileDescriptor：OAuth token 读取入口，对应环境变量 CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR。'''),
    (196, 'after', '''getApiKeyFromFileDescriptor：API key 读取入口，对应环境变量 CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR。'''),
]
