ANNOTATIONS = [
    (1, 'after', """Git 可用性探测模块：git 是安装 GitHub 系市场的先决条件，本模块提供带记忆化的检查，判断系统里能否找到 git。"""),
    (11, 'after', """命令可用性检查文档：用 which 找到真实可执行文件而不执行它，是不执行任意代码的安全实践，避免在不受信任目录里跑命令。"""),
    (21, 'before', """内部函数：用 which 查命令是否存在，任何异常都视作不可用，返回布尔。"""),
    (29, 'after', """git 可用性检查文档：用 memoize 记忆化，单次会话内重复调用直接返回缓存；只查 PATH 不真正执行 git。macOS 上 /usr/bin/git 的 xcrun 垫片即使没装 Xcode CLT 也会通过，若执行时真撞上 xcrun 报错应调 markGitUnavailable()。"""),
    (42, 'before', """对外的记忆化检查：首次调用实际跑 which git，之后整个会话走缓存。"""),
    (59, 'before', """强制让本会话余下时间都返回 false：当 git 存在于 PATH 却跑不起来（典型是 macOS xcrun 垫片）时调用，使下游按 git 缺失干净跳过，而不是反复撞同一执行错误。"""),
    (67, 'before', """清空可用性缓存，主要给测试用。"""),
    (69, 'after', """模块收尾：三个导出（检查 / 强制不可用 / 清缓存）配合 lodash memoize 的缓存键 undefined，实现会话级一次性探测与可测试复位。"""),
]
