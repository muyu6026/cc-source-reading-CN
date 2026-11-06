ANNOTATIONS = [
    (1, 'after', """`/version` 命令：打印当前会话运行版本（区分构建时间与下载版本），仅内部员工会话启用。"""),
    (3, 'after', """`call` 实现：依据构建时间宏决定输出「版本（构建于某时）」还是仅版本号。"""),
    (12, 'after', """命令元数据：类型 `local`、描述文案，并仅在 `USER_TYPE=ant` 时启用。"""),
]
ANNOTATIONS.sort(key=lambda a: a[0])
