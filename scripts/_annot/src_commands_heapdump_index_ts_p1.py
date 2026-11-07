# 批注数据：source/src/commands/heapdump/index.ts
ANNOTATIONS = [
    (1, 'before', '''本文件定义 `heapdump` 命令：把 JS 堆内存快照导出到桌面。
与前面的本地 JSX 命令不同，这里 `type` 是 `local`（无界面、后台执行）。'''),
    (4, 'after', '''`type: 'local'` 表示命令在本地直接运行、不渲染界面，
适合这种一次性导出动作。'''),
    (7, 'after', '''`isHidden: true` 让命令不出现在帮助列表里，属于排查用的隐藏命令。'''),
    (8, 'after', '''`supportsNonInteractive` 为真表示命令可在非交互（管道/脚本）模式下运行。'''),
    (9, 'after', '''`load` 用动态 `import()` 懒加载真正的实现，平时不占用主包体积。'''),
]
