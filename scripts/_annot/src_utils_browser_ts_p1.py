ANNOTATIONS = [
    (1, 'before', """本文件负责用系统默认处理器打开文件/文件夹，以及用系统默认浏览器打开 URL。内部依赖 `execFileNoThrow` 调用平台命令。"""),
    (3, 'before', """`validateUrl` 校验 URL 字符串是否合法：先尝试 `new URL` 解析，再强制协议只能是 `http:` 或 `https:`，否则抛错。"""),
    (24, 'before', """`openPath` 用系统默认程序打开本地路径：Windows 调 `explorer`，macOS 调 `open`，Linux 调 `xdg-open`；任一命令失败或被异常拦截都返回 `false`。"""),
    (39, 'before', """`openBrowser` 在已校验 URL 后用默认浏览器打开：Windows 优先用 `BROWSER` 环境变量（需经 shell 否则被当成 `file:///` 路径），否则回退 `rundll32`；其余平台用 `BROWSER` 或 `open`/`xdg-open`。"""),
]
