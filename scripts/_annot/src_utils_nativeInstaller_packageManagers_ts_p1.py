ANNOTATIONS = [
    (10, 'after', '''检测 Claude 当前是由哪个包管理器安装的，用于在更新/卸载时走对应路径。'''),
    (43, 'after', '''getOsRelease：解析 /etc/os-release 取得发行版 ID 与 ID_LIKE 家族，不可读时返回 null 让调用方回退到命令探测。'''),
    (72, 'after', '''detectMise：检查可执行文件路径是否落在 mise 的 installs 目录下来判定。'''),
    (91, 'after', '''detectAsdf：检查可执行文件路径是否落在 asdf 的 installs 目录下来判定。'''),
    (122, 'after', '''detectHomebrew：仅 macOS/Linux/WSL 有效，专门匹配 Caskroom 目录以区别于 npm 全局安装。'''),
    (157, 'after', '''detectWinget：仅 Windows 有效，匹配 WinGet 的 Packages 与 Links 目录（兼容正斜杠与反斜杠）。'''),
    (192, 'after', '''detectPacman：先按 Arch 家族门控再查包数据库，避免 Ubuntu 等系统上 pacman 游戏误判。'''),
    (225, 'after', '''detectDeb：先按 Debian 家族门控再查 dpkg 文件归属。'''),
    (258, 'after', '''detectRpm：先按 Fedora/RHEL/SUSE 家族门控再查 rpm 文件归属。'''),
    (296, 'after', '''detectApk：先按 Alpine 家族门控再查 apk 包归属。'''),
    (336, 'after', '''getPackageManager：按固定优先级逐一尝试检测，全部失败则返回 unknown。'''),
]
