ANNOTATIONS = [
    (19, 'after', '''SessionStatus 描述会话的运行状态：忙碌、空闲或等待中，供 `claude ps` 实时展示。'''),
    (23, 'after', '''getSessionsDir 返回会话 PID 文件的存放目录，位于 Claude 配置主目录下的 `sessions` 子目录。'''),
    (37, 'after', '''envSessionKind 从环境变量读取会话种类，仅当 `BG_SESSIONS` 特性开启且值为合法种类时返回，否则返回 undefined。'''),
    (46, 'after', '''isBgSession 判断当前 REPL 是否运行在 `claude --bg` 的 tmux 会话内，用于决定退出时分离客户端而非杀掉进程。'''),
    (59, 'before', '''registerSession 为顶层会话写入 PID 文件并注册清理逻辑，覆盖交互 CLI、SDK、后台与守护进程，唯独跳过队友子智能体以免污染并发统计。'''),
    (109, 'after', '''registerSession 收尾：返回是否成功注册，失败时只记录调试日志而不抛出，保证调用方不被中断。'''),
    (129, 'after', '''updatePidFile 以最佳实践方式更新本会话的 PID 注册文件，遇到文件缺失或读写失败时静默跳过。'''),
    (136, 'after', '''updateSessionName 仅在本会话 PID 文件写入会话名，供 ListPeers 在 peer 枚举里展示，名为空时直接返回。'''),
    (148, 'after', '''updateSessionBridgeId 记录远端控制会话 ID 用于去重，避免同一会话经 UDS 与桥接两种方式被重复列出，桥接销毁时清空以防残留。'''),
    (161, 'after', '''updateSessionActivity 向 `claude ps` 推送实时活动状态，属即发即弃；仅在 `BG_SESSIONS` 特性开启时生效。'''),
    (168, 'before', '''countConcurrentSessions 统计存活的并发 CLI 会话，过滤并删除崩溃残留的 PID 文件，任何异常都保守返回 0。'''),
    (204, 'after', '''countConcurrentSessions 收尾：遍历目录中形如 `<pid>.json` 的文件，对存活进程计数，WSL 下因无法探测 Windows PID 而保留疑似存活文件不删除。'''),
]
