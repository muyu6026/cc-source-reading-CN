ANNOTATIONS = [
    (31, 'after', '''向操作系统注册 claude-cli:// 自定义 URI 协议，使浏览器或任意应用点击该链接即可唤起 claude --handle-uri。'''),
    (52, 'after', '''各平台路径常量：macOS 应用目录与符号链接、Linux desktop 文件路径、Windows 注册表协议键与命令键。'''),
    (61, 'after', '''windowsCommandValue：生成注册表命令值，把 claude 路径与 %1 占位符拼成打开协议的处理命令。'''),
    (138, 'after', '''registerMacos：先清旧应用包，写入 Info.plist 注册 URL 方案，再符号链接已签名 claude 二进制，最后用 lsregister 重新注册。'''),
    (180, 'after', '''registerLinux：写 .desktop 条目并用 xdg-mime 注册为默认处理器；无图形环境时跳过重注册仍视为成功。'''),
    (209, 'after', '''registerWindows：用 reg add 写入协议键、URL Protocol 标记与命令键，任一失败即抛出并带错误码。'''),
    (233, 'after', '''registerProtocolHandler：按 process.platform 分派到 macOS/Linux/Windows 三套注册实现，未知平台报错。'''),
    (250, 'after', '''resolveClaudePath：优先取原生安装器的稳定符号链接，缺失时回退到 process.execPath，以承受自动更新。'''),
    (290, 'after', '''isProtocolHandlerCurrent：直接读注册产物（符号链接目标/.desktop 行/注册表值）判断是否需要重注册，避免缓存标志跨机失效。'''),
    (348, 'after', '''ensureDeepLinkProtocolRegistered：后台幂等自动注册，依功能开关与禁用设置短路；EACCES/ENOSPC 等确定性失败按 24 小时退避。'''),
]
