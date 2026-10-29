# 数据文件：src/utils/sessionEnvironment.ts
SOURCE_PATH = 'src/utils/sessionEnvironment.ts'
ANNOTATIONS = [
    (7, 'after', """文件入口：会话级环境脚本（env 文件）的读写与聚合，供 shell 命令继承激活的虚拟环境等。"""),
    (13, 'after', """缓存状态三元组：undefined 未加载、null 已查无文件、string 已缓存。"""),
    (23, 'after', """getSessionEnvDirPath：创建并返回会话级 env 目录。"""),
    (31, 'after', """getHookEnvFilePath：按钩子事件类型与序号生成 .sh 文件名。"""),
    (53, 'after', """clearCwdEnvFiles：清空与 cwd 相关的钩子 env 文件内容。"""),
    (58, 'after', """invalidateSessionEnvCache：置 undefined，触发下次重新读盘。"""),
    (137, 'after', """无脚本时置 null 并缓存，避免重复读盘。"""),
    (144, 'after', """getSessionEnvironmentScript：聚合 CLAUDE_ENV_FILE 与各钩子 env 脚本，按优先级排序拼接。"""),
    (153, 'after', """HOOK_ENV_REGEX：匹配 setup / sessionstart / cwdchanged / filechanged 钩子的 env 文件名。"""),
    (166, 'after', """sortHookEnvFiles：按类型优先级加序号排序，保证拼接顺序确定性。"""),
]
