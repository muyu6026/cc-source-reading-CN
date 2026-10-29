# 数据文件：src/utils/envDynamic.ts
SOURCE_PATH = 'src/utils/envDynamic.ts'

ANNOTATIONS = [
    (8, 'after', '''本模块在静态 env 之上补充需运行时探测的动态属性：Docker 检测、JetBrains 终端识别、musl 探测等，最终汇成 envDynamic 导出。'''),
    (16, 'after', '''getIsDocker：通过探测根目录下的 /.dockerenv 文件判断是否在 Docker 容器内（仅 Linux）。'''),
    (59, 'after', '''isMuslEnvironment：原生构建用编译期特性标志判定 musl/glibc；普通 node 构建回退到模块加载时预填的运行时探测缓存。'''),
    (96, 'after', '''detectJetBrainsIDEFromParentProcessAsync：沿父进程命令行查找 JetBrains IDE 关键字（macOS 走 bundle ID 旁路），结果记忆化。'''),
    (110, 'after', '''getTerminalWithJetBrainsDetectionAsync：检测到 JetBrains 终端模拟器时返回具体 IDE 或 pycharm，否则回退 env.terminal。'''),
    (129, 'after', '''同步版 getTerminalWithJetBrainsDetection：返回缓存值或回退 pycharm，供尚未初始化异步缓存的调用方使用。'''),
    (140, 'after', '''initJetBrainsDetection：在应用启动早期调用以预填检测缓存，使同步/异步判定一致。'''),
    (151, 'after', '''envDynamic：展开静态 env 并附加动态求值项（terminal 及多个探测函数），供全局统一读取。'''),
]
