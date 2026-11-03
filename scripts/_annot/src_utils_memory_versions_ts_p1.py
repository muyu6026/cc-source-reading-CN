ANNOTATIONS = [
    (1, 'before', '''本文件提供一个同步工具 `projectIsInGitRepo`，用于判断给定目录是否处于某个 git 仓库之内。'''),
    (8, 'after', '''函数收尾：`projectIsInGitRepo` 同步调用 `findGitRoot` 沿目录向上查找 `.git`，找到即视为在仓库内；若需要异步检查应改用 `dirIsInGitRepo()`。'''),
]
