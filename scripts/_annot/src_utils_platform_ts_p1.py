# 数据文件：src/utils/platform.ts
SOURCE_PATH = 'src/utils/platform.ts'

ANNOTATIONS = [
    (6, 'after', '''本模块负责平台与环境探测：解析当前操作系统、WSL 版本、Linux 发行版信息，并识别代码仓库所用的版本控制系统。'''),
    (7, 'after', '''Platform 类型：macos / windows / wsl / linux / unknown 五值联合。'''),
    (9, 'after', '''SUPPORTED_PLATFORMS：Claude Desktop 集成仅支持 macOS 与 WSL 两类平台。'''),
    (49, 'after', '''getPlatform：记忆化探测平台；Linux 下读取 /proc/version 判断是否 WSL，任何异常都退回 unknown。'''),
    (79, 'after', '''getWslVersion：从 /proc/version 提取 WSL 版本号，无显式标记时按含 Microsoft 字样退回 WSL1。'''),
    (116, 'after', '''getLinuxDistroInfo：读取 /etc/os-release 解析发行版 ID 与版本，并附带内核版本。'''),
    (127, 'after', '''VCS_MARKERS：常见版本控制系统的目录/文件标记表（git、hg、svn、perforce、tfs、jj、sl 等）。'''),
    (150, 'after', '''detectVcs：综合环境变量与目录标记，返回当前路径检测到的版本控制系统列表。'''),
]
