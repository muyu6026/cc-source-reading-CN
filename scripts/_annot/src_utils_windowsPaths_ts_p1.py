# 批注数据：src/utils/windowsPaths.ts

ANNOTATIONS = [
    (8, 'after', '''引入 memoize、path 与 path/win32、当前目录、调试日志、废弃 execSync 封装、LRU memoize 与平台判断。'''),
    (10, 'after', '''checkPathExists 用 dir 命令判断 Windows 上某路径是否存在，失败视为不存在。'''),
    (22, 'after', '''checkPathExists 收尾：仅以退出码判定，异常吞掉返回假。'''),
    (24, 'after', '''findExecutable 用 where 命令查找可执行文件，git 优先检查若干常见安装位置。'''),
    (80, 'after', '''findExecutable 收尾：过滤掉当前目录的结果以防执行恶意脚本，返回首个安全路径。'''),
    (82, 'after', '''setShellIfWindows 在 Windows 上把 SHELL 环境变量指向 git-bash，供 Bash 工具与 Shell 使用。'''),
    (93, 'after', '''setShellIfWindows 收尾：仅 Windows 生效，COMSPEC 保持不动以服务系统进程。'''),
    (95, 'after', '''findGitBashPath 定位 git-bash 自带的 bash.exe，找不到则报错并退出进程。'''),
    (125, 'after', '''findGitBashPath 收尾：优先用覆盖变量，否则依 git 路径回推 bin 下的 bash.exe。'''),
    (127, 'after', '''windowsPathToPosixPath 用纯 JS 把 Windows 路径转 POSIX：UNC 与盘符分别处理，其余只翻斜杠。'''),
    (145, 'after', '''windowsPathToPosixPath 收尾：以 LRU 缓存避免重复计算。'''),
    (147, 'after', '''posixPathToWindowsPath 是上面的逆向：处理 UNC、cygdrive 与盘符三种形式，其余只翻斜杠。'''),
    (173, 'after', '''posixPathToWindowsPath 收尾：同样以 LRU 缓存，返回 Windows 风格路径。'''),
]
