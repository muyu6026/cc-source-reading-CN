ANNOTATIONS = [
    (26, 'after', """DEFAULT_BUNDLE_MAX_BYTES：默认打包上限 100MB，可由特性开关 tengu_ccr_bundle_max_bytes 覆盖。"""),
    (50, 'before', """_bundleWithFallback：创建 git bundle 的兜底链，依次尝试 --all、HEAD、压缩为单父提交根，逐级缩小体积。"""),
    (66, 'after', """先尝试最完整的 --all 打包，把 stash 引用一并纳入以保证可恢复工作区。"""),
    (84, 'after', """--all 超限时退而求其次打 HEAD，丢弃旁支与标签但保留当前分支完整历史。"""),
    (104, 'after', """最后手段是把工作区树（有 WIP 则用 stash 树）压成无父单提交，只剩快照不含历史。"""),
    (152, 'before', """createAndUploadGitBundle：把仓库打包并上传到文件接口，返回 file_id 供种子 bundle 使用，同样走三级兜底。"""),
    (164, 'after', """开始前先清理上次崩溃残留的 seed 引用，避免被 --all 一并打包。"""),
    (174, 'after', """检查是否存在任意引用（不只 HEAD），空仓库直接返回 empty_repo。"""),
    (193, 'after', """用 stash create 生成游离提交保存未提交改动，不触碰工作区，未跟踪文件有意排除。"""),
    (215, 'after', """生成临时 bundle 路径，git 在非 0 退出时会残留部分文件，故用 finally 清理。"""),
    (248, 'after', """把最终 bundle 以固定相对名上传，便于 CCR 侧按文件名定位。"""),
]
