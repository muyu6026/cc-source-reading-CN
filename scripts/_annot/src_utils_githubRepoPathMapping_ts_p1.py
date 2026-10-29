# -*- coding: utf-8 -*-
SOURCE_PATH = 'src/utils/githubRepoPathMapping.ts'
ANNOTATIONS = [
    (11, 'after', '''GitHub 仓库路径映射：在全局配置里记录每个仓库对应的本地克隆路径，启动期无阻塞写入，便于后续快速定位。'''),
    (23, 'before', '''updateGithubRepoPathMapping 启动期调用，把当前仓库的 git 根（解析符号链接、标准化 NFC）记录到全局配置的映射表，并提到列表最前。'''),
    (76, 'after', '''updateGithubRepoPathMapping 结束：已在前排则跳过；否则去重后把当前路径前置，错误静默吞掉（非阻塞启动工作）。'''),
    (83, 'before', '''getKnownPathsForRepo 按 owner/repo 小写键查全局配置，返回该仓库已知的本地路径数组，无则空数组。'''),
    (87, 'after', '''getKnownPathsForRepo 结束。'''),
    (97, 'after', '''filterExistingPaths 并行用 pathExists 过滤掉不存在的路径，只保留仍在磁盘上的。'''),
    (125, 'after', '''validateRepoAtPath 读取目标路径的远端 URL 并解析出 owner/repo，与期望值做大小写不敏感比较，判断路径是否真的装着目标仓库。'''),
    (162, 'after', '''removePathFromRepo 从映射里删掉失效路径；若某仓库路径清空则连键一起删，保持配置整洁。'''),
]
