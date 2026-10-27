# -*- coding: utf-8 -*-
# src/utils/permissions/PermissionUpdate.ts（389 行）批注数据
ANNOTATIONS = [
    (3, 'after', '''权限类型抽取到 `src/types/permissions.ts` 以打破导入循环。'''),

    (28, 'after', '''为向后兼容重新导出附加工作目录相关类型。'''),

    (43, 'after', '''`extractRules` 把更新列表拍平成规则数组，非 addRules 类型返回空。'''),

    (47, 'after', '''`hasRules` 是判断是否存在规则的一层简单封装。'''),

    (55, 'after', '''`applyPermissionUpdate` 把一个权限更新不可变地套用到上下文上。'''),

    (67, 'after', '''`setMode` 分支返回带新模式的上下文。'''),

    (74, 'after', '''记录 addRules 操作的调试日志，含规则数与目标。'''),

    (95, 'after', '''`addRules` 按行为并入 alwaysAllow/alwaysDeny/alwaysAsk 对应集合。'''),

    (120, 'after', '''`replaceRules` 直接覆盖该目标下的全部规则。'''),

    (137, 'after', '''`addDirectories` 把目录写入 `additionalWorkingDirectories` 映射。'''),

    (169, 'after', '''`removeRules` 过滤掉指定的规则集合。'''),

    (183, 'after', '''`removeDirectories` 从映射中删除指定目录。'''),

    (187, 'after', '''未知类型直接返回原上下文，不做改动。'''),

    (196, 'after', '''`applyPermissionUpdates` 顺序折叠多个更新到同一上下文。'''),

    (206, 'after', '''返回最终合并后的权限上下文。'''),

    (208, 'after', '''`supportsPersistence` 决定哪些目标可持久化。'''),

    (216, 'after', '''只有 local/user/project 三类设置是可编辑的持久化来源。'''),

    (222, 'after', '''`persistPermissionUpdate` 把单个更新写入对应设置来源。'''),

    (234, 'after', '''addRules 通过 `addPermissionRulesToSettings` 持久化。'''),

    (248, 'after', '''先读现有目录，过滤掉重复项再保存。'''),

    (265, 'after', '''addDirectories 在去重后才写入，避免重复目录。'''),

    (280, 'after', '''规则经 parse→serialize 归一化，使 `Bash(*)` 与 `Bash` 能正确匹配。'''),

    (295, 'after', '''removeRules 用归一化后的字符串做精确比较后过滤。'''),

    (307, 'after', '''removeDirectories 过滤目录后持久化。'''),

    (321, 'after', '''setMode 持久化默认模式。'''),

    (334, 'after', '''replaceRules 持久化整组替换后的规则。'''),

    (342, 'after', '''persist 分支结束。'''),

    (349, 'after', '''`persistPermissionUpdates` 循环调用单个持久化函数。'''),

    (353, 'after', '''循环结束。'''),

    (361, 'after', '''`createReadRuleSuggestion` 为某目录构造一条 Read 规则建议。'''),

    (366, 'after', '''路径转 POSIX 格式以便模式匹配（内部兼容 Windows）。'''),

    (371, 'after', '''根目录范围过宽，不适合作为权限目标，返回 undefined。'''),

    (376, 'after', '''绝对路径前补一条斜杠形成 `//path/**` 模式。'''),

    (388, 'after', '''返回构造好的 `PermissionUpdate` 对象。'''),
]
