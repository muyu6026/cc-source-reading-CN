# -*- coding: utf-8 -*-
ANNOTATIONS = [
    (1, 'before', '''导入 lodash 的 memoize（记忆化）与路径 join；本文件负责「新项目引导」流程的状态判定'''),
    (11, 'after', '''引导步骤结构：每步含唯一 key、展示文本、是否已完成 / 可完成 / 启用'''),
    (19, 'after', '''getSteps：依据当前工作区状态算出应展示的引导步骤（共两步）'''),
    (20, 'after', '''探测工作区根目录是否存在 CLAUDE.md'''),
    (23, 'after', '''探测当前工作区目录是否为空'''),
    (27, 'after', '''第一步 workspace：目录为空时启用，提示让 Claude 创建应用或克隆仓库'''),
    (33, 'after', '''第二步 claudemd：目录非空时启用，提示跑 /init 生成 CLAUDE.md'''),
    (43, 'after', '''isProjectOnboardingComplete：所有「可完成且启用」的步骤都已 complete 才算完成'''),
    (49, 'after', '''maybeMarkProjectOnboardingComplete：先查配置缓存短路，避免每次回车都读盘'''),
    (52, 'after', '''缓存已标记完成时直接返回，不再调用耗时的文件系统判定'''),
    (55, 'after', '''确已完成则把 hasCompletedProjectOnboarding 写回项目配置'''),
    (63, 'after', '''shouldShowProjectOnboarding：memoize 记忆化，首屏渲染前也先走缓存短路'''),
    (67, 'after', '''已标记完成、已展示≥4 次、或处于演示环境都不会再展示引导'''),
    (75, 'after', '''其余情况按「引导未完成」展示引导面板'''),
    (78, 'after', '''incrementProjectOnboardingSeenCount：累加展示次数，用于上面的 seenCount 上限'''),
]
