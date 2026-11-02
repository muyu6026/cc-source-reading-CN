ANNOTATIONS = [
    (1, 'before', """Git worktree 路径探测：调用 git worktree list 找出仓库所有工作树，并按「当前工作树优先、其余按字母序」返回。"""),
    (6, 'after', """模块文档：本版本带埋点统计并使用 CLI 的 gitExe() 解析器；若要脱离 CLI 依赖的便携版，请用 getWorktreePathsPortable()。"""),
    (18, 'before', """主函数：从 cwd 跑 git worktree list --porcelain，非 git 环境、不在仓库或只有一个工作树时返回空数组。"""),
    (28, 'after', """拿到 porcelain 输出的 stdout 与退出码；preserveOutputOnError 关掉以免错误时也缓存输出。"""),
    (53, 'after', """把 porcelain 输出按行过滤出以「worktree 」开头的路径行，并做 NFC 归一化，得到原始工作树路径列表。"""),
    (64, 'after', """定位「当前工作树」：cwd 等于某路径或以该路径加分隔符开头者即为当前；其余按 locale 排序。"""),
    (69, 'after', """返回排序后的路径：当前工作树排在最前，其余按字母序；找不到当前时只返回其余列表。"""),
]
