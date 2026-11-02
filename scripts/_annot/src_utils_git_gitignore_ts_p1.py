# 批注数据：src/utils/git/gitignore.ts
ANNOTATIONS = [
    (1, 'after', '''本文件封装 git check-ignore 与全局 gitignore 写入，供敏感文件自动忽略使用。'''),
    (23, 'after', '''调 git check-ignore 判断路径是否被忽略：退出码 0 表示已忽略、1 表示未忽略、128 表示不在仓库；128 时返回 false（仓库外放行）。'''),
    (43, 'after', '''返回全局 gitignore 路径（位于用户配置目录下的 git/ignore）。'''),
    (53, 'after', '''把某文件名加入全局 gitignore（用 **/文件名 兜底所有子目录），前提是仓库内且尚未被任何 gitignore 覆盖。'''),
    (68, 'after', '''若已被现有规则忽略则直接返回，不重复添加。'''),
    (81, 'after', '''确保全局 gitignore 所在目录存在后再追加条目。'''),
]
